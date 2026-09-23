import { vetExternal, type ExternalTextKind } from '../../../shared/kiosk/external-text';
import { escapeHtml } from '../ui/dom/escape';

/** Quoted wall text, escaped only after vetting. No caller can opt out. */
export function externalHtml(kind: ExternalTextKind, value: unknown): string {
  const text = vetExternal(kind, value, 'row');
  return text === null ? '' : escapeHtml(text);
}

/** Optional text is absent, not an empty required name. */
export function optionalExternal(kind: ExternalTextKind, value: string | undefined): boolean {
  return value === undefined || value === '' || vetExternal(kind, value, 'row') !== null;
}
