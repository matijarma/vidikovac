// Kiosk copy lives in the one catalogue (i18n/hr.json, en.json) under
// `kiosk.*`; this is the thin typed adapter that builds the KioskStrings tree
// every composition reads as `s.group.leaf`, once per locale. Shared
// vocabulary is read where it lives so the two surfaces agree: the app name
// (common.appName), the domain names (layers.*), the compass words
// (motion.compass.*) and the canonical sentences (shared.*). Severity words,
// delay words and closure plurals keep going through i18n.t at the call
// site, as before. Every catalogue key named here is checked against the
// Croatian JSON at compile time; hr/en parity is the i18n test's.
import type { LayerId } from '../../../worker/protocol';
import { createDefaultI18n, type SupportedLocale } from '../i18n/create-default-i18n';
import en from '../i18n/en.json';
import hr from '../i18n/hr.json';
import { THEME_PREFERENCES, type ThemePreference } from '../ui/theme';

export type PluralForms = { one: string; few?: string; other: string };

export interface KioskStrings {
  appName: string;
  surface: string;
  header: {
    temporaryUntil: string; venue: string; unlockedUntil: string;
    /** "Tema: {pref}", filled with themeWord[preference]; the header button's own label. */
    theme: string;
    themeWord: Record<ThemePreference, string>;
  };
  status: {
    offline: string;
    reconnecting: string;
    dataDown: string;
  };
  invitation: {
    lead: string;
    support: string;
    /** `{host}` is the code base's hostname with `/s`, filled by the composition. */
    typeCode: string;
    qrLabel: string;
    qrWaiting: string;
    codeWaiting: string;
    copyCode: string;
    progressLabel: string;
  };
  weather: {
    title: string;
    humidity: string;
    wind: string;
    windCalm: string;
    /** A measured speed whose direction the station did not state. */
    windNoDir: string;
    /** The eight compass points, the same words the app's vehicle cards use (motion.compass.*). */
    compass: Record<'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW', string>;
    pressure: string;
    observed: string;
    sunrise: string;
    sunset: string;
    daylight: string;
    range: string;
    unavailable: string;
    loading: string;
    station: string;
    /** A live observation with no temperature: said in a word, never a dash. */
    noReading: string;
  };
  lines: {
    title: string;
    nearbyTitle: string;
    tram: string;
    bus: string;
    nearby: PluralForms;
    noneNearby: string;
    more: PluralForms;
    unavailable: string;
    loading: string;
    modelNote: string;
    vehiclesMoving: PluralForms;
  };
  story: {
    city: string;
    assembly: string;
    zet: string;
    neighbourhood: string;
    works: string;
    quake: string;
    published: string;
    changed: string;
    quakeBody: string;
    empty: string;
  };
  /** The front page's own words (kiosk/front.ts): the events panel's counts and
   *  its empty sentence, the city panel's kicker and lead words, the acts plural,
   *  the surroundings' kicker and the works lead. */
  front: {
    eventsToday: PluralForms;
    eventsTomorrow: PluralForms;
    eventsNone: string;
    /** "Sutra u gradu": the events kicker once tonight is over. */
    tomorrowCity: string;
    city: string;
    around: string;
    acts: PluralForms;
    /** The lead cell of an act row, a gazette row's short word. */
    actLead: string;
    kvartLead: string;
    worksLead: string;
    /** The promet card's sentence when the network has no exception to report. */
    linesRegular: string;
    /** "2 zatvaranja": the closures the promet card counts rather than lists. */
    closures: PluralForms;
    /** "1 obavijest ZET-a": ZET's own fresh notices, counted. */
    notices: PluralForms;
    /** "+2 linije kasne": the exceptions the card had no room for. */
    moreLate: PluralForms;
  };
  /** The header ticker's five kicker words (kiosk/ticker.ts), printed uppercase
   *  by the sheet: the weather, the network, the works, tonight, the city. */
  ticker: {
    weather: string;
    transit: string;
    works: string;
    tonight: string;
    city: string;
  };
  /** The column's kicker words and filler sentences (kiosk/front.ts reads the shared ones):
   *  transit's three value states, its "N vozila u blizini" plural and its
   *  zero, the other seven statements' kickers and the works plural, and
   *  "danas"/"sutra" for the Assembly's context line. */
  say: {
    /** "Večeras u gradu": the events kicker. */
    tonight: string;
    allDay: string;
    tonightMore: PluralForms;
    transit: string;
    transitRegular: string;
    transitNoData: string;
    nearby: PluralForms;
    nearbyNone: string;
    quake: string;
    closure: string;
    zet: string;
    worksCity: string;
    works: PluralForms;
    today: string;
    tomorrow: string;
  };
  safety: {
    label: string;
    /** The strip's cell: the shared sentence without its full stop. */
    warningsNone: string;
    warningsUnknown: string;
    warningsStale: string;
    /** No active warning, but one announced: said as such, never as an all-clear. */
    warningsUpcoming: string;
    warningsLoading: string;
    closuresUnknown: string;
    closuresStale: string;
    closuresNearest: string;
    pharmacy: string;
    hitno: string;
    basics: string;
    /** "DHMZ · EMSC": the sources, the calm trail before any of them has confirmed the moment. */
    sources: string;
    /** "DHMZ · EMSC · {time}": the calm trail, the moment the three sources last confirmed calm together. */
    confirmed: string;
    /** "Sigurnost: {verdict}. Otvori Osnovno": the verdict button's name while the invitation shows. */
    openBasics: string;
    /** "hitno" / "mirno" / "nepotvrđeno": the strip's verdict word, from safetyState's level. */
    verdict: Record<'urgent' | 'calm' | 'unknown', string>;
  };
  basics: { title: string; hint: string; close: string; empty: string; routes: string; weather: string; pharmacy: string; warnings: string; closures: string };
  session: {
    join: string;
    joinHint: string;
    selected: string;
    selectedRoute: string;
    selectedStop: string;
  };
  layers: Record<LayerId, string>;
  /** Words for the event sources' category slugs; an unknown slug is not printed. */
  events: Record<string, string>;
  paired: {
    warnings: string;
    closures: string;
    delays: string;
    quakes: string;
    today: string;
    tomorrow: string;
    later: string;
    forecast: string;
    sun: string;
    pharmacies: string;
    assemblyPoints: string;
    acts: string;
    sessions: string;
    works: string;
    notices: string;
    ongoing: string;
    ongoingWord: string;
    ongoingUntil: string;
    overviewTransport: string;
    allDay: string;
    noData: string;
    sourceDown: string;
    unconfirmed: string;
    dataFrom: string;
    fetchedAt: string;
    stale: string;
    phase: string;
    amount: string;
    coverage: string;
    /** The departure board's own coverage line, counted in lines; `{shown}` and `{total}` stay for the row fitter. */
    coverageLines: PluralForms;
    routeVehicles: PluralForms;
    depth: string;
    magUnknown: string;
    depthUnknown: string;
    upcomingFrom: string;
    quakeNone: string;
    warningsNone: string;
    closuresNone: string;
    eventsNone: string;
    actsNone: string;
    worksNone: string;
    sessionsNone: string;
    rangeUnknown: string;
    untilTime: string;
    lineWord: string;
    licence: string;
    /** "Izvor" / "Izvori": the label a compact credit line opens with. */
    sourceLabel: string;
    sourcesLabel: string;
    /** Where the full attribution of every source lives. */
    fullSources: string;
  };
  notice: {
    expiredTitle: string;
    expiredBody: string;
    revokedTitle: string;
    revokedBody: string;
    setupAgain: string;
    endsAfterSession: string;
  };
  /** The start screen (kiosk/start.ts) and the sentences the settings panel's
   *  stop search reuses: one vocabulary for the one thing that creates and
   *  changes a screen. */
  setup: {
    title: string;
    intro: string;
    search: string;
    results: PluralForms;
    noResults: string;
    routesAt: string;
    create: string;
    creating: string;
    validity: string;
    errorAccess: string;
    errorQuota: string;
    errorNetwork: string;
    errorInvalid: string;
    errorFailed: string;
    errorStops: string;
    retry: string;
    retryIn: string;
    loadingStops: string;
  };
  /** The on-screen settings overlay (kiosk/settings.ts): the four sections and
   *  the forget-screen confirmation. */
  settings: {
    open: string;
    title: string;
    hint: string;
    close: string;
    save: string;
    saving: string;
    saved: string;
    /** The three ways a save does not land: no socket, a refusal, a repeat inside the DO's window. */
    saveOffline: string;
    saveRefused: string;
    saveBusy: string;
    area: string;
    areaWhole: string;
    areaHint: string;
    stop: string;
    stopNone: string;
    stopHint: string;
    theme: string;
    screen: string;
    expiry: string;
    expiryNone: string;
    forget: string;
    forgetAsk: string;
    forgetYes: string;
    forgetNo: string;
  };
}

type Kiosk = typeof hr.kiosk;
type Group = { [G in keyof Kiosk]: Kiosk[G] extends string ? never : G }[keyof Kiosk];
type Leaf<G extends Group> = keyof Kiosk[G] & string;
type PluralBase<K extends string> = K extends `${infer Base}_one` ? Base : never;

const RAW: Record<SupportedLocale, typeof hr | typeof en> = { hr, en };
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

function build(code: SupportedLocale): KioskStrings {
  const i18n = createDefaultI18n(code);
  const t = (key: string): string => i18n.t(key);
  const raw = RAW[code];
  /** The named leaves of one `kiosk.*` group. */
  const group = <G extends Group, K extends Leaf<G>>(name: G, keys: readonly K[]): Record<K, string> =>
    Object.fromEntries(keys.map((key) => [key, t(`kiosk.${name}.${key}`)])) as Record<K, string>;
  /** `_one`, `_few` (only where this locale writes one) and `_other` of a kiosk plural. */
  const forms = <G extends Group>(name: G, base: PluralBase<Leaf<G>>): PluralForms => {
    const own = raw.kiosk[name] as Record<string, unknown>;
    return {
      one: t(`kiosk.${name}.${base}_one`),
      ...(`${base}_few` in own ? { few: t(`kiosk.${name}.${base}_few`) } : {}),
      other: t(`kiosk.${name}.${base}_other`),
    };
  };
  const record = <K extends string>(keys: readonly K[], key: (k: K) => string): Record<K, string> =>
    Object.fromEntries(keys.map((k) => [k, t(key(k))])) as Record<K, string>;
  /** The strip cell is the shared sentence without its full stop. */
  const fragment = (sentence: string): string => sentence.replace(/\.$/, '');

  return {
    appName: t('common.appName'),
    surface: t('kiosk.surface'),
    header: {
      ...group('header', ['temporaryUntil', 'venue', 'theme']),
      unlockedUntil: t('shared.unlockedUntil'),
      themeWord: record(THEME_PREFERENCES, (pref) => `kiosk.header.themeWord.${pref}`),
    },
    status: group('status', ['offline', 'reconnecting', 'dataDown']),
    invitation: { ...group('invite', ['lead', 'support', 'typeCode', 'qrLabel', 'qrWaiting', 'codeWaiting', 'progressLabel']), copyCode: i18n.t('session.shareCopy') },
    weather: {
      ...group('weather', ['title', 'humidity', 'wind', 'windCalm', 'windNoDir', 'pressure', 'observed', 'sunrise', 'sunset', 'daylight', 'range', 'unavailable', 'loading', 'station', 'noReading']),
      compass: record(COMPASS, (point) => `motion.compass.${point}`),
    },
    lines: {
      ...group('lines', ['title', 'nearbyTitle', 'tram', 'bus', 'noneNearby', 'unavailable', 'loading', 'modelNote']),
      nearby: forms('lines', 'nearby'),
      more: forms('lines', 'more'),
      vehiclesMoving: forms('lines', 'vehiclesMoving'),
    },
    story: group('story', ['city', 'assembly', 'zet', 'neighbourhood', 'works', 'quake', 'published', 'changed', 'quakeBody', 'empty']),
    front: {
      ...group('front', ['eventsNone', 'tomorrowCity', 'city', 'around', 'actLead', 'kvartLead', 'worksLead', 'linesRegular']),
      eventsToday: forms('front', 'eventsToday'),
      eventsTomorrow: forms('front', 'eventsTomorrow'),
      acts: forms('front', 'acts'),
      closures: forms('front', 'closures'),
      notices: forms('front', 'notices'),
      moreLate: forms('front', 'moreLate'),
    },
    ticker: group('ticker', ['weather', 'transit', 'works', 'tonight', 'city']),
    say: {
      ...group('say', ['transit', 'transitRegular', 'transitNoData', 'nearbyNone', 'quake', 'closure', 'zet', 'worksCity', 'today', 'tomorrow', 'tonight', 'allDay']),
      nearby: forms('say', 'nearby'),
      works: forms('say', 'works'),
      tonightMore: forms('say', 'tonightMore'),
    },
    safety: {
      ...group('safety', ['warningsUnknown', 'warningsStale', 'warningsUpcoming', 'warningsLoading', 'closuresUnknown', 'closuresStale', 'closuresNearest', 'pharmacy', 'basics', 'sources', 'confirmed', 'openBasics']),
      label: t('shared.safetyPage'),
      hitno: t('shared.safetyPage'),
      warningsNone: fragment(t('shared.warningsNone')),
      verdict: record(['urgent', 'calm', 'unknown'] as const, (level) => `kiosk.safety.verdict.${level}`),
    },
    basics: group('basics', ['title', 'hint', 'close', 'empty', 'routes', 'weather', 'pharmacy', 'warnings', 'closures']),
    session: group('session', ['join', 'joinHint', 'selected', 'selectedRoute', 'selectedStop']),
    layers: record(Object.keys(raw.layers) as LayerId[], (layer) => `layers.${layer}`),
    events: record(Object.keys(raw.kiosk.events), (slug) => `kiosk.events.${slug}`),
    paired: {
      ...group('paired', [
        'warnings', 'closures', 'delays', 'quakes', 'today', 'tomorrow', 'later', 'forecast', 'sun', 'pharmacies', 'assemblyPoints',
        'acts', 'sessions', 'works', 'notices', 'ongoing', 'ongoingWord', 'ongoingUntil', 'overviewTransport', 'allDay',
        'noData', 'sourceDown', 'unconfirmed', 'dataFrom', 'fetchedAt', 'stale', 'phase', 'amount', 'coverage', 'depth', 'magUnknown',
        'depthUnknown', 'upcomingFrom', 'quakeNone', 'eventsNone', 'actsNone', 'worksNone', 'sessionsNone', 'rangeUnknown',
        'untilTime', 'lineWord', 'licence', 'sourceLabel', 'sourcesLabel', 'fullSources',
      ]),
      coverageLines: forms('paired', 'coverageLines'),
      routeVehicles: forms('paired', 'routeVehicles'),
      warningsNone: t('shared.warningsNone'),
      closuresNone: t('shared.closuresNone'),
    },
    notice: group('notice', ['expiredTitle', 'expiredBody', 'revokedTitle', 'revokedBody', 'setupAgain', 'endsAfterSession']),
    setup: {
      ...group('setup', [
        'title', 'intro', 'search', 'noResults', 'routesAt', 'create', 'creating', 'validity',
        'errorAccess', 'errorQuota', 'errorNetwork', 'errorInvalid', 'errorFailed', 'errorStops',
        'retry', 'retryIn', 'loadingStops',
      ]),
      results: forms('setup', 'results'),
    },
    settings: group('settings', [
      'open', 'title', 'hint', 'close', 'save', 'saving', 'saved', 'saveOffline', 'saveRefused', 'saveBusy',
      'area', 'areaWhole', 'areaHint', 'stop', 'stopNone', 'stopHint',
      'theme', 'screen', 'expiry', 'expiryNone', 'forget', 'forgetAsk', 'forgetYes', 'forgetNo',
    ]),
  };
}

const BUILT = new Map<SupportedLocale, KioskStrings>();

/** The strings for a locale code, built once; anything that is not English reads Croatian. */
export function kioskStrings(locale: string): KioskStrings {
  const code: SupportedLocale = locale.slice(0, 2).toLowerCase() === 'en' ? 'en' : 'hr';
  let strings = BUILT.get(code);
  if (!strings) {
    strings = build(code);
    BUILT.set(code, strings);
  }
  return strings;
}

/** `{name}` interpolation, the same shape the shared i18n uses. */
export function fill(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) out = out.split(`{${key}}`).join(String(value));
  return out;
}

/** Croatian has three categories (1 / 2-4 / 5+), English two; Intl decides. */
export function plural(locale: string, forms: PluralForms, count: number): string {
  let category = 'other';
  try { category = new Intl.PluralRules(locale).select(count); } catch { /* unknown tag: 'other' */ }
  const template = category === 'one' ? forms.one : category === 'few' ? (forms.few ?? forms.other) : forms.other;
  return fill(template, { count });
}
