// Kultura i sjećanje: Događanja, a live (session-tier) panel reading three of
// the dogadanja module's six sources -- Kulturpunkt, Etnografski muzej and
// Kvartovske novosti (mjesna samouprava) -- the culture and community rows.
// The Assembly and the communal-works register are the *city*'s own rows and
// belong to Uprava i pravo (uprava-i-pravo.ts); ZET's two notice feeds belong
// to neither full panel, only to the kiosk teaser (task E8). Below Događanja,
// the still-honest referenca roadmap names what the rest of this layer still
// lacks.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { DogadanjaSourceId } from '../../../worker/feed/modules/dogadanja';
import { zagrebDayKey, zagrebWeekdayDate } from '../format';
import type { I18n } from '../i18n/i18n';
import { createLayerSection, createPanel, dataText, listMarkup } from '../panels/panel';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import type { LayerContext } from './types';

export const EUROPEANA_URL = 'https://www.europeana.eu/hr';
export const NSK_URL = 'https://digitalna.nsk.hr/';

const CULTURE_EVENT_SOURCE_TUPLE = ['kulturpunkt', 'etnografski', 'kvartovske'] as const;
type CultureEventSource = (typeof CULTURE_EVENT_SOURCE_TUPLE)[number];

/** The three of dogadanja's six sources that are culture or community content, not city administration. */
export const CULTURE_EVENT_SOURCES: readonly DogadanjaSourceId[] = CULTURE_EVENT_SOURCE_TUPLE;

/** Human name (for the honest "which sources answered" empty line) and the fuller per-row attribution, which also names the licence. */
const SOURCE_NAME: Record<CultureEventSource, string> = {
  kulturpunkt: 'Kulturpunkt',
  etnografski: 'Etnografski muzej',
  kvartovske: 'Kvartovske novosti',
};
const SOURCE_ATTRIBUTION: Record<CultureEventSource, string> = {
  kulturpunkt: 'Kulturpunkt (CC BY-SA 3.0 HR)',
  etnografski: 'Etnografski muzej',
  kvartovske: 'Kvartovske novosti, Grad Zagreb (Otvorena dozvola)',
};

function isCultureSource(source: string): source is CultureEventSource {
  return (CULTURE_EVENT_SOURCE_TUPLE as readonly string[]).includes(source);
}

/** Exported for its own direct test: the culture/community subset of the merged dogadanja snapshot, in the module's own order. */
export function cultureEvents(snapshot: ModuleSnapshot | undefined): FeedItem[] {
  return (snapshot?.items ?? []).filter((item) => isCultureSource(dataText(item, 'source')));
}

/**
 * "A day with no events says so plainly and names which sources answered"
 * (E7 brief): when none of these three sources' own items survive the
 * filter above, sourceCounts (R-E2 -- an extra property on the snapshot
 * fetchDogadanja itself sets, not part of ModuleSnapshot's own declared
 * shape) says whether each one was silent because it had nothing this cycle,
 * or came back with items that simply were not culture/community rows.
 * Falls back to the ordinary empty text when sourceCounts isn't there at all
 * (no snapshot yet, or a plain unit-test fixture with no extra property).
 */
export function cultureEventsEmptyText(i18n: I18n, snapshot: ModuleSnapshot | undefined): string {
  const counts = (snapshot as (ModuleSnapshot & { sourceCounts?: Partial<Record<string, number>> }) | undefined)
    ?.sourceCounts;
  if (!counts) return i18n.t('status.empty');
  const responded = CULTURE_EVENT_SOURCE_TUPLE.filter((s) => (counts[s] ?? 0) > 0).map((s) => SOURCE_NAME[s]);
  const quiet = CULTURE_EVENT_SOURCE_TUPLE.filter((s) => (counts[s] ?? 0) === 0).map((s) => SOURCE_NAME[s]);
  const parts = [i18n.t('panels.eventsEmpty')];
  if (responded.length) parts.push(i18n.t('panels.sourcesResponded', { list: responded.join(', ') }));
  if (quiet.length) parts.push(i18n.t('panels.sourcesQuiet', { list: quiet.join(', ') }));
  return parts.join(' ');
}

/**
 * "A day with no events" (E7 brief) also has a literal reading, distinct from
 * cultureEventsEmptyText's "nothing at all": today itself may carry nothing
 * even while the list further down shows real future rows -- Kulturpunkt's
 * next announcement, say, three days out. zagrebDayKey (R-O2) gives an
 * unambiguous same-day comparison for that, inclusive of a multi-day
 * Etnografski exhibition's whole [at, until] window (compared as strings,
 * safe because the format is 'YYYY-MM-DD', lexicographic = chronological).
 * Only meaningful once the list isn't already empty outright -- an
 * altogether-empty list already gets the fuller sourceCounts message above.
 */
function coversToday(item: FeedItem, todayKey: string): boolean {
  const startKey = zagrebDayKey(item.at);
  if (!startKey) return false;
  const endKey = item.until ? zagrebDayKey(item.until) : startKey;
  return startKey <= todayKey && todayKey <= endKey;
}

function noneToday(items: readonly FeedItem[], now: number): boolean {
  return items.length > 0 && !items.some((item) => coversToday(item, zagrebDayKey(now)));
}

function eventRow(item: FeedItem, i18n: I18n): string {
  const source = dataText(item, 'source') as CultureEventSource;
  const venue = dataText(item, 'venue');
  const time = zagrebWeekdayDate(item.at);
  const metaParts = [time, venue, SOURCE_ATTRIBUTION[source]].filter(Boolean).map(escapeHtml);
  const link = item.link
    ? ` <a href="${escapeAttribute(item.link)}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('common.openSource'))}</a>`
    : '';
  return `<span data-testid="event-row"><strong>${escapeHtml(item.title)}</strong><span class="panel-sub"> ${metaParts.join(' · ')}</span>${link}</span>`;
}

export function renderKultura(ctx: LayerContext): HTMLElement {
  const { i18n, now, snapshots } = ctx;
  const { section, panels } = createLayerSection('kultura', i18n.t('layers.kultura'));
  const dogadanja = snapshots.dogadanja;
  const events = cultureEvents(dogadanja);
  const todayNotice = noneToday(events, now)
    ? `<p class="panel-empty" data-testid="events-today-notice">${escapeHtml(i18n.t('panels.eventsEmptyToday'))}</p>`
    : '';

  panels.appendChild(
    createPanel({
      i18n, now, id: 'kultura-dogadanja', title: i18n.t('panels.events'), snapshot: dogadanja,
      body:
        todayNotice +
        listMarkup(
          events.map((item) => eventRow(item, i18n)),
          cultureEventsEmptyText(i18n, dogadanja),
        ),
      onCopy: ctx.onCopy,
      copyText:
        events.map((item) => `${item.title} — ${zagrebWeekdayDate(item.at)} — ${item.link ?? ''}`).join('\n') ||
        undefined,
    }).element,
  );

  panels.appendChild(
    createPanel({
      i18n, now, id: 'kultura-roadmap', title: i18n.t('panels.culture'), freshness: 'referenca',
      body: `<p>${escapeHtml(i18n.t('panels.cultureStage1'))}</p>
        <ul class="panel-facts">
          <li><a href="${EUROPEANA_URL}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('panels.cultureEuropeana'))}</a></li>
          <li><a href="${NSK_URL}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('panels.cultureNsk'))}</a></li>
        </ul>`,
    }).element,
  );

  return section;
}
