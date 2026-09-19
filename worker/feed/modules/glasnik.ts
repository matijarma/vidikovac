import type { FetchContext } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { briefRows, compactData } from '../payload';
import { zagrebIso } from '../time';

// The gazette gateway answers { servis, timestamp, message, data }. Reading it
// takes two calls: the code lists give the identifiers of years and issues, then
// a POST lists the acts of one issue. Some titles come back double-encoded
// (UTF-8 bytes read as Latin-1), which is repaired here and flagged as an
// adaptation in docs/izvori.md, never silently corrected in the source.

export const GLASNIK_API = 'https://www1.zagreb.hr/sluzbeni-glasnik-gateway/api/v1/';
export const GLASNIK_ACT_URL = 'https://www1.zagreb.hr/sluzbeni-glasnik/#/app/akt/';

/** How many of the newest issue's acts the kiosk ticker can show, and so how many are condensed (WP6). */
export const GLASNIK_BRIEF_COUNT = 3;
/** The issue's own table of contents is a heading, not an act, and is never briefed. */
const CONTENTS_TITLE = /^sadr[žz]aj\b/i;

const MONTHS: Record<string, number> = {
  siječnja: 1,
  veljače: 2,
  ožujka: 3,
  travnja: 4,
  svibnja: 5,
  lipnja: 6,
  srpnja: 7,
  kolovoza: 8,
  rujna: 9,
  listopada: 10,
  studenoga: 11,
  prosinca: 12,
};

export function repairMojibake(value: string): string {
  if (!/[\u0080-\u00ff]/.test(value)) return value;
  // Anything above U+00FF cannot have come from a single byte, so the string is
  // already correct and must not be touched.
  if (/[^\u0000-\u00ff]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff);
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return value;
  }
}

export function parseCroatianDate(value: string): string | undefined {
  const match = /(\d{1,2})\.\s*([a-zčćđšž]+)\s*(\d{4})/i.exec(value);
  if (!match) return undefined;
  const month = MONTHS[match[2].toLocaleLowerCase('hr')];
  if (!month) return undefined;
  return zagrebIso(Number(match[3]), month, Number(match[1]));
}

export interface GlasnikIssue {
  yearId: string;
  year: string;
  issueId: string;
  issueLabel: string;
  issueNumber: number;
  publishedAt?: string;
}

interface CodeEntry {
  id?: string;
  naziv?: string;
  godina?: string;
  status?: string;
}

export function newestIssue(sifarnici: unknown): GlasnikIssue | null {
  const data = (sifarnici as { data?: { godine?: CodeEntry[]; brojevi?: CodeEntry[] } })?.data;
  const years = (data?.godine ?? []).filter((entry) => entry.id && entry.naziv && entry.status !== 'X');
  const newestYear = years.sort((a, b) => Number(b.naziv) - Number(a.naziv))[0];
  if (!newestYear?.id || !newestYear.naziv) return null;

  const issues = (data?.brojevi ?? [])
    .filter((entry) => entry.id && entry.naziv && entry.godina === newestYear.naziv && entry.status !== 'X')
    .map((entry) => ({ entry, number: Number(/Broj\s+(\d+)/i.exec(entry.naziv ?? '')?.[1] ?? Number.NaN) }))
    .filter((candidate) => Number.isFinite(candidate.number))
    .sort((a, b) => b.number - a.number);
  const newest = issues[0];
  if (!newest) return null;

  const publishedAt = parseCroatianDate(newest.entry.naziv ?? '');
  return {
    yearId: newestYear.id,
    year: newestYear.naziv,
    issueId: newest.entry.id as string,
    issueLabel: newest.entry.naziv as string,
    issueNumber: newest.number,
    ...(publishedAt ? { publishedAt } : {}),
  };
}

interface ActRecord {
  id?: string;
  naziv?: string;
  naslov?: string;
  tekst?: string;
}

export function parseAkti(json: unknown, issue: GlasnikIssue): FeedPayload {
  const envelope = json as { data?: unknown };
  const rows: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray(envelope?.data)
      ? envelope.data
      : Array.isArray((envelope?.data as { akti?: unknown })?.akti)
        ? ((envelope.data as { akti: unknown[] }).akti)
        : [];

  const items: ItemInput[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const act = row as ActRecord;
    const rawTitle = act.naziv ?? act.naslov ?? act.tekst ?? '';
    if (!act.id || !rawTitle) continue;
    items.push({
      id: act.id,
      kind: 'act',
      title: repairMojibake(rawTitle).trim(),
      link: `${GLASNIK_ACT_URL}${act.id}`,
      ...(issue.publishedAt ? { at: issue.publishedAt } : {}),
      data: compactData({ broj: issue.issueNumber, godina: issue.year }),
    });
  }

  return { items, ...(issue.publishedAt ? { sourceUpdatedAt: issue.publishedAt } : {}) };
}

export async function fetchGlasnik(ctx: FetchContext): Promise<FeedPayload> {
  const sifarnici = await (await ctx.fetch(`${GLASNIK_API}sifarnici`)).json();
  const issue = newestIssue(sifarnici);
  if (!issue) throw new Error('glasnik: no active issue in the code lists');

  const response = await ctx.fetch(`${GLASNIK_API}akti`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      item: { godina: issue.yearId, broj: issue.issueId, godinaOd: '', godinaDo: '', tekst: '', tip: 1 },
    }),
  });
  const payload = parseAkti(await response.json(), issue);
  // An act title is one long legal sentence; the ticker gets the reading of
  // the first few, and every act keeps its own title and link regardless.
  const acts = payload.items.filter((item) => !CONTENTS_TITLE.test(item.title)).slice(0, GLASNIK_BRIEF_COUNT);
  await briefRows(ctx, acts, (item) => item.title, 'akt');
  return payload;
}
