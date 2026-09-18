import type { ModuleId } from './feed/schema';
import { LAYERS, type LayerId } from './protocol';

/** Public display context only. Never credentials, coordinates or search text. */
export type PublicSelection =
  | { kind: 'route'; id: string }
  | { kind: 'stop'; id: string }
  | { kind: 'place'; id: string }
  | { kind: 'street'; id: string }
  | { kind: 'item'; id: string; module: ModuleId };

const ID = /^[0-9A-Za-z_-]{1,32}$/;
const KEY = /^[0-9a-f]{16}$/;
const MODULE_IDS: readonly ModuleId[] = [
  'zet-rt', 'prometnice', 'dhmz-now', 'dhmz-forecast', 'dhmz-cap',
  'emsc', 'glasnik', 'ckan-geo', 'dogadanja',
];

/** Stable, bounded identity for UI reconciliation and relay, NOT a security hash. */
export function publicItemKey(module: ModuleId, id: string): string {
  const text = `${module}:${id}`;
  let a = 2166136261;
  let b = 2246822507;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 3266489909);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function validLayer(value: unknown): value is LayerId {
  return typeof value === 'string' && (LAYERS as readonly string[]).includes(value);
}

export function selectionParams(selection: PublicSelection | null): Record<string, string> | undefined {
  if (!selection) return undefined;
  return selection.kind === 'item'
    ? { kind: selection.kind, id: selection.id, module: selection.module }
    : { kind: selection.kind, id: selection.id };
}

/** Strict allowlist protects the shared screen from private or arbitrary context. */
export function parseSelection(params: unknown): PublicSelection | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const p = params as Record<string, unknown>;
  if (Object.keys(p).some((k) => !['kind', 'id', 'module'].includes(k))) return null;
  if (typeof p.id !== 'string') return null;
  if ((p.kind === 'place' || p.kind === 'street') && /^[0-9A-Za-z_-]{1,80}$/.test(p.id) && p.module === undefined) {
    return { kind: p.kind, id: p.id };
  }
  if ((p.kind === 'route' || p.kind === 'stop') && ID.test(p.id) && p.module === undefined) {
    return { kind: p.kind, id: p.id };
  }
  if (p.kind === 'item' && KEY.test(p.id) && MODULE_IDS.includes(p.module as ModuleId)) {
    return { kind: 'item', id: p.id, module: p.module as ModuleId };
  }
  return null;
}
