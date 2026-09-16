// Grad javlja: the kiosk's one dogadanja card. Every source the app fetches
// reaches the public screen with its own credit (owner, 16 Sept 2026); the
// card shows the module's first row, whatever its source, and names that
// source in its attribution. One row per card: the module's own soonest-first
// order puts an upcoming Assembly session or tonight's event ahead of a
// notice posted this morning, and a notice ahead of a works entry last
// touched in July.
import type { Attribution, FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { zagrebDateTime, zagrebWeekdayDate } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataText } from '../panels/panel';
import { CULTURE_SOURCE_ATTRIBUTION } from './kultura';
import { CITY_WORK_SOURCE_ATTRIBUTION } from './uprava-i-pravo';

// The same strings the two panels print, so a reader who scans after seeing
// the card meets the same attribution on the session side. ZET's two feeds
// are shown on no full panel (E7), so theirs lives only here.
const SOURCE_ATTRIBUTION: Record<string, string> = {
  ...CULTURE_SOURCE_ATTRIBUTION,
  skupstina: CITY_WORK_SOURCE_ATTRIBUTION.skupstina,
  komunalne: CITY_WORK_SOURCE_ATTRIBUTION.komunalne,
  'zet-novosti': 'ZET (Otvorena dozvola)',
  'zet-promet': 'ZET (Otvorena dozvola)',
};

/** The rows this card may show: every row of whatever dogadanja snapshot the kiosk holds, in the module's own order. */
export function cityTeaserRows(snapshot: ModuleSnapshot | undefined): FeedItem[] {
  return snapshot?.items ?? [];
}

/**
 * Title and a time reading that says what the stamp means: a komunalne `at`
 * is the register's last-change date and is labelled so (as the Grad radi
 * panel does, E7); a ZET notice's `at` is its publish time, labelled
 * "objavljeno" with the minute; an Assembly session or a kvartovska novost is
 * a dated event and reads as a weekday date, like every other panel row.
 */
export function cityTeaserBody(item: FeedItem, i18n: I18n): string {
  const source = dataText(item, 'source');
  const when =
    source === 'komunalne'
      ? i18n.t('panels.cityWorkChanged', { time: zagrebWeekdayDate(item.at) })
      : source.startsWith('zet-')
        ? i18n.t('kiosk.teaserPublished', { time: zagrebDateTime(item.at) })
        : zagrebWeekdayDate(item.at);
  return [item.title, when].filter(Boolean).join(' · ');
}

/**
 * Per-row attribution naming the row's own source and its licence, linking
 * to the row itself when it has a link; with no row, the payload's own
 * statement for the module (the reduced copy's Otvorena dozvola attribution);
 * with no snapshot yet, nothing, like every other card while loading.
 */
export function cityTeaserAttribution(snapshot: ModuleSnapshot | undefined, item: FeedItem | undefined): Attribution | undefined {
  if (!snapshot) return undefined;
  if (!item) return snapshot.attribution;
  const source = dataText(item, 'source');
  const credit = SOURCE_ATTRIBUTION[source];
  return {
    text: credit ? `Izvor: ${credit}` : snapshot.attribution.text,
    url: item.link ?? snapshot.attribution.url,
    licence: snapshot.attribution.licence,
  };
}
