// The teaser summaries other surfaces and the integration suite read off the
// open-tier payload: one card per source with a real value and a filled
// attribution, and the safety strip's three sentences. Built on the same
// helpers the kiosk compositions use, so the two can never disagree, and on
// the licence-aware city rows, so no CC BY-SA title reaches a public screen
// whatever the payload carried.
import type { Attribution, FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { fillAttribution } from '../attribution';
import type { I18n } from '../i18n/i18n';
import { cityTeaserAttribution, cityTeaserBody, cityTeaserRows } from '../layers/grad-teaser';
import { dataNumber, dataText } from '../panels/panel';
import { fmtNumber } from './format';
import { byModule, closuresNear, isLive, recentQuakes, safetyStrip, weatherNow } from './local';
import { kioskStrings } from './strings';

export interface TeaserCard {
  id: 'weather' | 'quake' | 'closures' | 'news' | 'city' | 'invitation';
  title: string;
  body: string;
  attribution?: Attribution;
}

function filled(snapshot: ModuleSnapshot | undefined, item?: FeedItem): Attribution | undefined {
  return snapshot ? { ...snapshot.attribution, text: fillAttribution(snapshot.attribution, snapshot, item ?? snapshot.items[0]) } : undefined;
}

/** One card per open source: a real value, the honest loading word, or the unconfirmed sentence. */
export function teaserCards(modules: readonly ModuleSnapshot[], i18n: I18n, now: number): TeaserCard[] {
  const locale = i18n.getLocale();
  const s = kioskStrings(locale);
  const map = byModule(modules);
  const loading = i18n.t('status.loading');
  const weather = weatherNow(modules, s, locale);
  const quakes = map.emsc;
  const quake = recentQuakes(quakes, now)[0];
  const near = closuresNear(modules, null, now);
  const hrt = map['hrt-news'];
  const news = isLive(hrt) ? hrt.items[0] : undefined;
  const city = map.dogadanja;
  const cityRow = cityTeaserRows(city)[0];
  const weatherBody = weather.state === 'loading' ? loading
    : weather.state === 'down' && weather.temperature === null ? s.weather.unavailable
      : [weather.temperature ?? '', weather.condition].filter(Boolean).join(' · ');
  return [
    { id: 'weather', title: s.weather.title, body: weatherBody, attribution: filled(map['dhmz-now']) },
    { id: 'quake', title: s.story.quake, body: quake ? quakeCard(quake) : isLive(quakes) ? s.paired.quakeNone : quakes ? s.paired.sourceDown : loading, attribution: filled(quakes, quake) },
    { id: 'closures', title: s.paired.closures, body: near.state === 'loading' ? loading : near.state === 'down' ? s.safety.closuresUnknown : i18n.t('panels.closuresCount', { count: near.count }), attribution: filled(map.prometnice) },
    { id: 'news', title: s.story.news, body: news ? news.title : hrt ? s.paired.newsNone : loading, attribution: filled(hrt, news) },
    { id: 'city', title: s.story.city, body: city ? (cityRow ? cityTeaserBody(cityRow, i18n) : s.story.empty) : loading, attribution: cityTeaserAttribution(city, cityRow) },
    { id: 'invitation', title: s.appName, body: `${s.invitation.lead} ${s.invitation.support}` },
  ];
  /** "M 1,6 · CROATIA"; a magnitude the source did not give is named missing, never zero. */
  function quakeCard(q: ModuleSnapshot['items'][number]): string {
    const mag = dataNumber(q, 'mag');
    return `${mag === null ? s.paired.magUnknown : `M ${fmtNumber(locale, mag, 1)}`} · ${dataText(q, 'region') || q.title}`;
  }
}

/** The strip's three sentences with no stop to rank by: the same words the kiosk paints. */
export function safetyStripText(modules: readonly ModuleSnapshot[], i18n: I18n, now: number = Date.now()): { cap: string; closures: string; pharmacy: string } {
  const strip = safetyStrip(modules, null, i18n, kioskStrings(i18n.getLocale()), now);
  return { cap: strip.warning.text, closures: strip.closures.text, pharmacy: strip.pharmacy.label };
}
