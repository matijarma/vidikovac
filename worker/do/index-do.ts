// IndexDO: the singleton that answers "whose code is this?" in one lookup and
// keeps the screen registry the admin routes list. Codes arrive one batch per
// registration (BeaconDO auth, RoomDO share) and leave by the 5-minute purge
// alarm. Rows hold a code, a kind, an owner id and an expiry: nothing else.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { CODE_ALPHABET, CODE_LENGTH, type VenueType } from '../protocol';

export const INDEX_DO_NAME = 'global';
export const PURGE_INTERVAL_MS = 5 * 60 * 1000;

export type CodeKind = 'kiosk' | 'room';

export interface CodeRegistration {
  code: string;
  kind: CodeKind;
  ownerId: string;
  /** Unix ms after which the code can no longer be resolved. */
  expiresAt: number;
}

export interface BeaconRecord {
  beaconId: string;
  venueType: VenueType;
  area: string;
  operatorLabel: string;
  stopId: string | null;
  createdAt: number;
  revokedAt: number | null;
}

type CodeRow = { kind: string; owner_id: string };
type BeaconRow = {
  beacon_id: string;
  venue_type: string;
  area: string;
  operator_label: string;
  stop_id: string | null;
  created_at: number;
  revoked_at: number | null;
};

const CODE_SHAPE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const OWNER_MAX = 64;
const BATCH_MAX = 200;

export function indexStub(env: Env): DurableObjectStub<IndexDO> {
  const namespace = env.INDEX_DO as DurableObjectNamespace<IndexDO>;
  return namespace.get(namespace.idFromName(INDEX_DO_NAME));
}

export class IndexDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec(
        `CREATE TABLE IF NOT EXISTS codes (
           code TEXT PRIMARY KEY,
           kind TEXT NOT NULL,
           owner_id TEXT NOT NULL,
           expires_at INTEGER NOT NULL
         )`,
      );
      sql.exec(`CREATE INDEX IF NOT EXISTS codes_expires ON codes (expires_at)`);
      sql.exec(
        `CREATE TABLE IF NOT EXISTS beacons (
           beacon_id TEXT PRIMARY KEY,
           venue_type TEXT NOT NULL,
           area TEXT NOT NULL,
           operator_label TEXT NOT NULL,
           stop_id TEXT,
           created_at INTEGER NOT NULL,
           revoked_at INTEGER
         )`,
      );
    });
  }

  /** Wall clock; a method so tests can pin it with vi.spyOn. */
  now(): number {
    return Date.now();
  }

  /** One statement per code inside one transaction; malformed entries are skipped. A repeated code takes the newest owner. */
  async register(codes: CodeRegistration[]): Promise<{ accepted: number }> {
    if (!Array.isArray(codes) || codes.length === 0 || codes.length > BATCH_MAX) return { accepted: 0 };
    const sql = this.ctx.storage.sql;
    let accepted = 0;
    this.ctx.storage.transactionSync(() => {
      for (const entry of codes) {
        if (
          typeof entry?.code !== 'string' ||
          !CODE_SHAPE.test(entry.code) ||
          (entry.kind !== 'kiosk' && entry.kind !== 'room') ||
          typeof entry.ownerId !== 'string' ||
          entry.ownerId.length === 0 ||
          entry.ownerId.length > OWNER_MAX ||
          !Number.isFinite(entry.expiresAt)
        ) {
          continue;
        }
        sql.exec(
          `INSERT INTO codes (code, kind, owner_id, expires_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (code) DO UPDATE SET kind = excluded.kind, owner_id = excluded.owner_id, expires_at = excluded.expires_at`,
          entry.code,
          entry.kind,
          entry.ownerId,
          Math.floor(entry.expiresAt),
        );
        accepted += 1;
      }
    });
    await this.ensurePurgeAlarm();
    return { accepted };
  }

  resolve(code: string): { kind: CodeKind; ownerId: string } | null {
    if (typeof code !== 'string' || !CODE_SHAPE.test(code)) return null;
    const rows = this.ctx.storage.sql
      .exec<CodeRow>(`SELECT kind, owner_id FROM codes WHERE code = ? AND expires_at > ?`, code, this.now())
      .toArray();
    const row = rows[0];
    if (row === undefined) return null;
    return { kind: row.kind as CodeKind, ownerId: row.owner_id };
  }

  purge(nowMs: number): number {
    const result = this.ctx.storage.sql.exec(`DELETE FROM codes WHERE expires_at <= ?`, nowMs);
    return result.rowsWritten;
  }

  registerBeacon(record: Omit<BeaconRecord, 'revokedAt'>): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO beacons (beacon_id, venue_type, area, operator_label, stop_id, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (beacon_id) DO NOTHING`,
      record.beaconId,
      record.venueType,
      record.area,
      record.operatorLabel,
      record.stopId,
      record.createdAt,
    );
  }

  markBeaconRevoked(beaconId: string, at: number): void {
    this.ctx.storage.sql.exec(`UPDATE beacons SET revoked_at = ? WHERE beacon_id = ? AND revoked_at IS NULL`, at, beaconId);
  }

  listBeacons(): BeaconRecord[] {
    return this.ctx.storage.sql
      .exec<BeaconRow>(`SELECT * FROM beacons ORDER BY created_at DESC, beacon_id LIMIT 1000`)
      .toArray()
      .map((row) => ({
        beaconId: row.beacon_id,
        venueType: row.venue_type as VenueType,
        area: row.area,
        operatorLabel: row.operator_label,
        stopId: row.stop_id,
        createdAt: row.created_at,
        revokedAt: row.revoked_at,
      }));
  }

  private async ensurePurgeAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(this.now() + PURGE_INTERVAL_MS);
    }
  }

  async alarm(): Promise<void> {
    this.purge(this.now());
    const remaining = this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM codes`).one().n;
    if (remaining > 0) await this.ctx.storage.setAlarm(this.now() + PURGE_INTERVAL_MS);
  }
}
