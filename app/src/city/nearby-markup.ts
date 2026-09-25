// "U blizini" on the phone (companion WP4 step 3, §11, probes §15.6): the
// wall's own list, drawn in the phone's feed. The rows are WP1's selection
// (city/nearby.ts selectNearby) and every row is the wall's markup
// (kiosk/timeline.ts rowMarkup: li.nearby-row[data-id][data-kind]
// [data-when|data-always][data-live][data-source] with .nearby-when,
// .nearby-title and .nearby-sub), so one probe reads both surfaces. What the
// phone adds is a hand to hold it with: a row whose subject has a page (an
// event, a closure, a stop, a street) carries the link that opens it, inside
// its li, and the list is capped as the §12 bounds cap it (whole rows, the
// timeless row kept) rather than fitted to a box.
//
// This module is the phone's heavy half (the selection, the external-text
// policy, the kiosk helpers, the sentence templates): city/feed.ts loads it
// once, after the first paint, so the first screen stays inside its budget.
import type { LayerId } from '../../../worker/protocol';
import type { PublicSelection } from '../core/contracts';
import { selectionHref } from '../experience/blocks';
import type { I18n } from '../i18n/i18n';
import { fitRows, rowMarkup, vettedTimelineRow } from '../kiosk/timeline';
import { escapeAttribute as a, escapeHtml as e } from '../ui/dom/escape';
import { nearbyHead, nearbyPill, selectNearby, type NearbyInput, type NearbyRow } from './nearby';
import { sentenceFacts, templateSentences, type SentenceFact, type WrittenSentence } from './sentence';

// The page reads the selection, the head's circle and the sentence tools through this chunk alone (city/feed.ts):
// the rotation (createSentenceSequence, the wall's own, which applies the header's strict acceptance to every
// candidate), the wire shape of a request (modelSentenceFacts), the reading of an answer (readWrittenSentences)
// and the templates, so dashboard.ts never imports city/sentence.ts on /d/.
export { nearbyHead, nearbyPill, selectNearby };
export { createSentenceSequence, modelSentenceFacts, templateSentences, SENTENCE_HOLD_MS, SENTENCE_NO_REPEAT_MS, SENTENCE_REFRESH_MS } from './sentence';
export { readWrittenSentences } from '../../../shared/kiosk/sentence';

/** The phone's sentence runs to the header's own length (companion §12, step 12). */
export const PHONE_SENTENCE_BUDGET = 80;

/** Where a row's subject opens on the phone: an event in Događanja, everything else on Karta. */
export function rowLayer(selection: PublicSelection): LayerId {
  return selection.kind === 'item' && selection.module === 'dogadanja' ? 'kultura' : 'u-pokretu';
}

/**
 * A closure row whose feed brief is empty says what it is: the feed's own summary ("zatvoreno zbog radova, oba
 * smjera"), else the plain words of the wall's sentence ("do 21:45 Gundulićeva" alone said nothing of a closure;
 * round 1 phone F8, kiosk round 2 F11). The phone's own row: the wall draws the selection's row as it is.
 */
function withClosureSub(i18n: I18n, row: NearbyRow): NearbyRow {
  if (row.kind !== 'closure' || row.sub) return row;
  const { subShort: _short, ...rest } = row;
  return { ...rest, sub: row.summary ?? i18n.t('sada.closureRow') };
}

/** One row as the wall draws it; a row with a subject holds, inside its li, the link that opens it. */
export function nearbyRowMarkup(i18n: I18n, row: NearbyRow, now: number): string {
  const html = rowMarkup(withClosureSub(i18n, row), now, i18n);
  if (!html || !row.selection) return html;
  // The li's own tag ends at its first '>': every attribute value is escaped, so none carries one.
  const open = html.indexOf('>') + 1;
  const layer = rowLayer(row.selection);
  const link = `<a class="nearby-link" href="${a(selectionHref(layer, row.selection))}" data-action="nav" data-layer="${layer}" data-selection="${a(JSON.stringify(row.selection))}">`;
  return `${html.slice(0, open)}${link}${html.slice(open, html.length - '</li>'.length)}</a></li>`;
}

/** The rows in selectNearby's order, at most `cap`, the timeless row kept; a row whose text fails the check is left out whole. */
export function nearbyRowsMarkup(i18n: I18n, rows: readonly NearbyRow[], cap: number, now: number): string {
  return fitRows(rows.filter(vettedTimelineRow), cap).map((row) => nearbyRowMarkup(i18n, row, now)).join('');
}

export interface NearbySectionOptions {
  /** How many rows at most (NEARBY_PHONE_ROWS on a phone, NEARBY_DESK_ROWS on a desk). */
  cap: number;
  /** The section's id prefix, so two lists on one page (the desk's Sada and Karta) never share an id. */
  id: string;
  /**
   * Draw this many reserved rows instead of `rows`, the section busy (city/feed.ts nearbyHeld): the head stands as
   * it will, and the rows arrive into the room they take rather than one source at a time.
   */
  reserve?: number;
}

/** One reserved row: the height of a row, nothing to read. */
export const RESERVED_NEARBY_ROW = '<li class="nearby-row-empty" aria-hidden="true"><span class="skeleton"></span></li>';

/**
 * The list with its head, "U blizini · 2 km · ~15 min" (nearbyHead, the
 * wall's words), the title and the pill in two spans so a phone can set the
 * pill as a chip while the head's text stays the wall's exactly.
 */
export function nearbySectionMarkup(i18n: I18n, rows: readonly NearbyRow[], radiusM: number, now: number, o: NearbySectionOptions): string {
  const head = nearbyHead(i18n, radiusM);
  const cut = head.indexOf(' · ');
  const headHtml = cut === -1
    ? `<span class="nearby-head-title">${e(head)}</span>`
    : `<span class="nearby-head-title">${e(head.slice(0, cut))}</span><span class="visually-hidden"> · </span><span class="nearby-pill">${e(head.slice(cut + 3))}</span>`;
  const headId = `${o.id}-nearby-head`;
  const held = o.reserve !== undefined;
  return `<section class="nearby" data-testid="nearby" data-key="nearby" aria-labelledby="${a(headId)}"${held ? ' aria-busy="true"' : ''}>`
    + `<h3 class="nearby-head" id="${a(headId)}" data-testid="nearby-head">${headHtml}</h3>`
    + `<ol class="nearby-rows" data-testid="nearby-rows">${held ? RESERVED_NEARBY_ROW.repeat(o.reserve!) : nearbyRowsMarkup(i18n, rows, o.cap, now)}</ol></section>`;
}

/**
 * The facts Sada's sentence is written from: the same ones the wall writes
 * from (city/sentence.ts sentenceFacts over the rows selectNearby chose), for
 * the page's request to fetchSentences (companion step 12) and for the
 * templates below.
 */
export function sadaSentenceFacts(input: NearbyInput, rows: readonly NearbyRow[]): SentenceFact[] {
  return sentenceFacts({
    place: input.place, radiusM: input.radiusM, rows, snapshots: input.snapshots, city: input.city,
    now: input.now, outage: input.snapshots['zet-rt']?.status === 'down', locale: input.locale, i18n: input.i18n,
  });
}

/**
 * What Sada can say from these rows without the network: WP1's template
 * sentences over those facts, in the writer's order. The page's own rotation
 * (fetchSentences, falling back to these) replaces them through ctx.sentence;
 * without one Sada prints the first.
 */
export function sadaSentences(input: NearbyInput, rows: readonly NearbyRow[], budget = PHONE_SENTENCE_BUDGET): WrittenSentence[] {
  return templateSentences(sadaSentenceFacts(input, rows), input.i18n, budget, input.now);
}
