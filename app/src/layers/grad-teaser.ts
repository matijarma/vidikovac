// Grad javlja: the kiosk's one dogadanja card. The public screen is the open
// tier, so this card carries only the Otvorena dozvola city rows -- Skupština,
// mjesna samouprava (kvartovske novosti), data.zagreb.hr (plan komunalnih
// aktivnosti) and ZET's two notice feeds -- and never a Kulturpunkt
// (CC BY-SA 3.0 HR) or Etnografski row, which stay on the session-tier
// Kultura panel (kultura.ts). /api/teaser is already reduced to those rows
// by registry.teaserSubset; the same predicate is applied here again on
// purpose, so the screen's licence statement does not depend on which
// payload it was handed. One row per card: the module's own soonest-first
// order puts an upcoming Assembly session ahead of a notice posted this
// morning, and a notice ahead of a works entry last touched in July.
import type { Attribution, FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { openLicenceEvents, type OpenLicenceEventSource } from '../../../worker/feed/modules/dogadanja/licence';
import { zagrebDateTime, zagrebWeekdayDate } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataText } from '../panels/panel';
import { CULTURE_SOURCE_ATTRIBUTION } from './kultura';
import { CITY_WORK_SOURCE_ATTRIBUTION } from './uprava-i-pravo';

// The same strings the two panels print, so a reader who scans after seeing
// the card meets the same attribution on the session side. ZET's two feeds
// are shown on no full panel (E7), so theirs lives only here.
const SOURCE_ATTRIBUTION: Record<OpenLicenceEventSource, string> = {
  skupstina: CITY_WORK_SOURCE_ATTRIBUTION.skupstina,
  komunalne: CITY_WORK_SOURCE_ATTRIBUTION.komunalne,
  kvartovske: CULTURE_SOURCE_ATTRIBUTION.kvartovske,
  'zet-novosti': 'ZET (Otvorena dozvola)',
  'zet-promet': 'ZET (Otvorena dozvola)',
};

/** The rows this card may show: the Otvorena dozvola subset of whatever dogadanja snapshot the kiosk holds, in the module's own order. */
export function cityTeaserRows(snapshot: ModuleSnapshot | undefined): FeedItem[] {
  return openLicenceEvents(snapshot?.items ?? []);
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
  const source = dataText(item, 'source') as OpenLicenceEventSource;
  return {
    text: `Izvor: ${SOURCE_ATTRIBUTION[source]}`,
    url: item.link ?? snapshot.attribution.url,
    licence: snapshot.attribution.licence,
  };
}
