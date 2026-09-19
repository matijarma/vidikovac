// Public presentation vocabulary. Deliberately separate from private browser
// state: no query text, favorites, device coordinates, HTML or arbitrary camera.
import type { LayerId } from './protocol';
import { isAreaSlug } from './pairing/areas';
import { parseSelection, validLayer, type PublicSelection } from './public-selection';

export const PRESENTATION_VERSION = 1 as const;
export const PRESENTATION_ACK_MS = 8_000;
export const PRESENTATION_TIMES = ['sada', 'danas', 'veceras', 'sutra', 'tjedan'] as const;
export type PresentationTime = (typeof PRESENTATION_TIMES)[number];

export interface PresentationTarget {
  layer: LayerId | 'kvart';
  selection?: PublicSelection;
  district?: string;
  time?: PresentationTime;
}

export interface PresentationState {
  version: typeof PRESENTATION_VERSION;
  revision: number;
  target: PresentationTarget | null;
  owner: 'self' | 'other' | null;
  expiresAt: number | null;
  status: 'idle' | 'pending' | 'displayed' | 'unavailable';
  online: boolean;
  supported: boolean;
  /** V1 screens cannot render city catalogue subjects. */
  capabilities?: readonly string[];
}

export interface PresentationCommand {
  version: typeof PRESENTATION_VERSION;
  requestId: string;
  action: 'present' | 'stop';
  expectedRevision: number;
  target?: PresentationTarget;
  takeover?: boolean;
}

export type PresentationError =
  | 'unavailable' | 'unsupported' | 'not-allowed' | 'changed'
  | 'occupied' | 'invalid-request' | 'too-many-requests';

export interface PresentationResult {
  requestId: string;
  state: PresentationState;
  error?: PresentationError;
}

/** Only the authenticated kiosk receives a data token. */
export interface ScreenPresentation {
  version: typeof PRESENTATION_VERSION;
  revision: number;
  target: PresentationTarget | null;
  expiresAt: number | null;
  dataToken?: string;
}

export function parsePresentationTarget(value: unknown): PresentationTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some(k => !['layer', 'selection', 'district', 'time'].includes(k))) return null;
  if (p.layer !== 'kvart' && !validLayer(p.layer)) return null;
  const target: PresentationTarget = { layer: p.layer };
  if (p.selection !== undefined) {
    const selection = parseSelection(p.selection);
    if (!selection) return null;
    target.selection = selection;
  }
  if (p.district !== undefined) {
    if (!isAreaSlug(p.district)) return null;
    target.district = p.district;
  }
  if (p.time !== undefined) {
    if (!(PRESENTATION_TIMES as readonly unknown[]).includes(p.time)) return null;
    target.time = p.time as PresentationTime;
  }
  return target;
}

export function parsePresentationCommand(value: unknown): PresentationCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some(k => !['version', 'requestId', 'action', 'expectedRevision', 'target', 'takeover'].includes(k))) return null;
  if (p.version !== 1 || typeof p.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(p.requestId)) return null;
  if (!Number.isSafeInteger(p.expectedRevision) || (p.expectedRevision as number) < 0) return null;
  if (p.action !== 'present' && p.action !== 'stop') return null;
  if (p.takeover !== undefined && typeof p.takeover !== 'boolean') return null;
  const target = p.target === undefined ? null : parsePresentationTarget(p.target);
  if (p.action === 'present' && !target) return null;
  if (p.action === 'stop' && (p.target !== undefined || p.takeover !== undefined)) return null;
  return {
    version: 1, requestId: p.requestId, action: p.action,
    expectedRevision: p.expectedRevision as number,
    ...(target ? { target } : {}),
    ...(p.takeover === true ? { takeover: true } : {}),
  };
}
