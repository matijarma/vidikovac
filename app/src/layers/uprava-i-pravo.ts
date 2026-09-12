// Uprava i pravo: the latest acts from the Službeni glasnik, printable (the
// print stylesheet turns a panel into a readable A4 page with the permalink),
// plus Grad radi -- the city's own two dogadanja sources: Assembly sessions
// and committee (consultation) sessions from Skupština, and the communal
// works register from data.zagreb.hr. The culture and community sources
// (Kulturpunkt, Etnografski muzej, kvartovske novosti) are Kultura's rows
// (kultura.ts); ZET's two notice feeds belong to neither full panel, only to
// the kiosk teaser (task E8).
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { DogadanjaSourceId } from '../../../worker/feed/modules/dogadanja';
import { SKUPSTINA_YOUTUBE_URL } from '../../../worker/feed/modules/dogadanja/skupstina';
import { zagrebDateTime, zagrebWeekdayDate } from '../format';
import type { I18n } from '../i18n/i18n';
import { createLayerSection, createPanel, dataNumber, dataText, listMarkup } from '../panels/panel';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import type { LayerContext } from './types';

const CITY_WORK_SOURCE_TUPLE = ['skupstina', 'komunalne'] as const;
type CityWorkSource = (typeof CITY_WORK_SOURCE_TUPLE)[number];

/** The two of dogadanja's six sources that are the City's own administration, not culture or community content (see kultura.ts). */
export const CITY_WORK_SOURCES: readonly DogadanjaSourceId[] = CITY_WORK_SOURCE_TUPLE;

const SOURCE_NAME: Record<CityWorkSource, string> = {
  skupstina: 'Skupština Grada Zagreba',
  komunalne: 'Plan komunalnih aktivnosti',
};
const SOURCE_ATTRIBUTION: Record<CityWorkSource, string> = {
  skupstina: 'Skupština Grada Zagreba (Otvorena dozvola)',
  komunalne: 'Plan komunalnih aktivnosti, Grad Zagreb (Otvorena dozvola)',
};

function isCityWorkSource(source: string): source is CityWorkSource {
  return (CITY_WORK_SOURCE_TUPLE as readonly string[]).includes(source);
}

/** Exported for its own direct test: the city-administration subset of the merged dogadanja snapshot, in the module's own order. */
export function cityWorkEvents(snapshot: ModuleSnapshot | undefined): FeedItem[] {
  return (snapshot?.items ?? []).filter((item) => isCityWorkSource(dataText(item, 'source')));
}

/** Same honesty rule as kultura.ts's cultureEventsEmptyText, for this panel's own two sources. */
export function cityWorkEmptyText(i18n: I18n, snapshot: ModuleSnapshot | undefined): string {
  const counts = (snapshot as (ModuleSnapshot & { sourceCounts?: Partial<Record<string, number>> }) | undefined)
    ?.sourceCounts;
  if (!counts) return i18n.t('status.empty');
  const responded = CITY_WORK_SOURCE_TUPLE.filter((s) => (counts[s] ?? 0) > 0).map((s) => SOURCE_NAME[s]);
  const quiet = CITY_WORK_SOURCE_TUPLE.filter((s) => (counts[s] ?? 0) === 0).map((s) => SOURCE_NAME[s]);
  const parts = [i18n.t('panels.cityWorkEmpty')];
  if (responded.length) parts.push(i18n.t('panels.sourcesResponded', { list: responded.join(', ') }));
  if (quiet.length) parts.push(i18n.t('panels.sourcesQuiet', { list: quiet.join(', ') }));
  return parts.join(' ');
}

function skupstinaRow(item: FeedItem, i18n: I18n): string {
  const organiser = dataText(item, 'organiser');
  const venue = dataText(item, 'venue');
  const time = zagrebWeekdayDate(item.at);
  const metaParts = [organiser, time, venue, SOURCE_ATTRIBUTION.skupstina].filter(Boolean).map(escapeHtml);
  const link = item.link
    ? ` <a href="${escapeAttribute(item.link)}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('common.openSource'))}</a>`
    : '';
  // R-P5: linking to the Assembly's own YouTube channel from a plenary session is not crawling
  // its disallowed Atom feed -- data.live is set only for a plenary session (skupstina.ts).
  const live =
    dataText(item, 'live') === 'youtube'
      ? ` <a href="${SKUPSTINA_YOUTUBE_URL}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('panels.watchLive'))}</a>`
      : '';
  return `<span data-testid="city-work-row"><strong>${escapeHtml(item.title)}</strong><span class="panel-sub"> ${metaParts.join(' · ')}</span>${link}${live}</span>`;
}

function komunalneRow(item: FeedItem, i18n: I18n): string {
  const phase = dataText(item, 'phase');
  const amount = dataNumber(item, 'amount');
  // `at` here is the register's own last-change stamp, not a scheduled date
  // (komunalne.ts) -- labelled as such so this row never implies a date the
  // source never claimed.
  const changed = i18n.t('panels.cityWorkChanged', { time: zagrebWeekdayDate(item.at) });
  const amountText = amount !== null ? i18n.t('panels.cityWorkAmount', { amount: amount.toLocaleString('hr-HR') }) : '';
  const metaParts = [changed, phase, amountText, SOURCE_ATTRIBUTION.komunalne].filter(Boolean).map(escapeHtml);
  const summary = item.summary
    ? `<span class="panel-sub">${escapeHtml(item.summary)}</span>`
    : '';
  return `<span data-testid="city-work-row"><strong>${escapeHtml(item.title)}</strong><span class="panel-sub"> ${metaParts.join(' · ')}</span>${summary}</span>`;
}

function cityWorkRow(item: FeedItem, i18n: I18n): string {
  return dataText(item, 'source') === 'komunalne' ? komunalneRow(item, i18n) : skupstinaRow(item, i18n);
}

export function renderUpravaIPravo(ctx: LayerContext): HTMLElement {
  const { i18n, snapshots, now } = ctx;
  const { section, panels } = createLayerSection('uprava-i-pravo', i18n.t('layers.uprava-i-pravo'));
  const glasnik = snapshots.glasnik;
  const dogadanja = snapshots.dogadanja;
  const cityWork = cityWorkEvents(dogadanja);

  const rows = (glasnik?.items ?? []).map((act) => {
    const number = `${dataText(act, 'broj')}/${dataText(act, 'godina')}`;
    const link = act.link
      ? ` <a href="${escapeAttribute(act.link)}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('common.openSource'))}</a>`
      : '';
    return `<span data-testid="act-row"><strong>${escapeHtml(act.title)}</strong><span class="panel-sub"> ${escapeHtml(number)} · ${escapeHtml(zagrebDateTime(act.at))}</span>${link}</span>`;
  });

  panels.appendChild(
    createPanel({
      i18n, now, id: 'uprava-i-pravo-acts', title: i18n.t('panels.acts'), snapshot: glasnik,
      body: listMarkup(rows, i18n.t('status.empty')),
      onCopy: ctx.onCopy,
      copyText: (glasnik?.items ?? []).map((a) => `${a.title} (${dataText(a, 'broj')}/${dataText(a, 'godina')}) ${a.link ?? ''}`).join('\n') || undefined,
      extraActions: ctx.onExport ? [{ id: 'print', label: i18n.t('panels.actsPrint'), run: () => ctx.onExport?.('print', 'glasnik') }] : undefined,
    }).element,
  );

  panels.appendChild(
    createPanel({
      i18n, now, id: 'uprava-i-pravo-grad-radi', title: i18n.t('panels.cityWork'), snapshot: dogadanja,
      body: listMarkup(
        cityWork.map((item) => cityWorkRow(item, i18n)),
        cityWorkEmptyText(i18n, dogadanja),
      ),
      onCopy: ctx.onCopy,
      copyText:
        cityWork.map((item) => `${item.title} — ${zagrebWeekdayDate(item.at)}${item.link ? ` — ${item.link}` : ''}`).join('\n') ||
        undefined,
    }).element,
  );

  return section;
}
