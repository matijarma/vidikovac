import type { ExternalTextKind } from '../../../shared/kiosk/external-text';
import type { PresentationTarget } from '../../../worker/presentation';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
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

/** A feed item's title under its own kind: a closure's is the closed street's
 *  name (worker/feed/modules/prometnice.ts), where a house-number range is
 *  data; every other module's title is prose. */
export function itemTitleKind(module: string): ExternalTextKind {
  return module === 'prometnice' ? 'name' : 'title';
}

/** The kind of a presentation target's label (experience/presentation.ts): a
 *  place, street, stop, route or layer is named; an item reads as its title. */
export function presentationLabelKind(target: PresentationTarget): ExternalTextKind {
  return target.selection?.kind === 'item' ? itemTitleKind(target.selection.module) : 'name';
}
