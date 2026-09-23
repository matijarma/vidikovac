// Key-group ownership for the companion run (docs/companion-2026-09-22.md
// §15.2 S9). A package adds keys only inside its own groups, in hr.json and
// en.json together (the i18n test holds parity), never reorders a group, and
// only WP5 deletes:
//   WP1  kiosk.nearby.*, kiosk.sentence.*, kiosk.handheld.*
//   WP2  kiosk.legend.{tram,bikes,culture}
//   WP3  kiosk.setup.*, kiosk.settings.*
//   WP4  sada.*, directory.*, arrivals.timetable, layers.u-pokretu
//   WP5  deletions, in every group
// Never: a top-level nearby.*, a sentence.kicker.* (the kickers live under
// kiosk.sentence.kicker.*), a time.untilDate (events.untilDate says it).
//
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
import type { SentenceKicker } from '../../../shared/kiosk/sentence';
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
    /** `{host}` is the code base's hostname with `/s`, filled by the composition. */
    typeCode: string;
    qrLabel: string;
    qrWaiting: string;
    progressLabel: string;
  };
  /** The wall map's legend (WP2, kiosk.legend.*): three plain items, the tram
   *  route, the BAJS disc's count and tonight's culture, never a caveat. The
   *  invitation mounts it only where there is a map. */
  legend: {
    tram: string;
    bikes: string;
    culture: string;
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
  /** What comes next at a stop (WP5b). The words are the app's own
   *  `arrivals.*`, not a kiosk copy of them: the tapped stop's card and the
   *  phone sheet say the same thing about the same row, and the note under a
   *  list is the one sentence that explains where an estimate comes from. */
  arrivals: {
    /** A tram due inside half a minute is the one pulling in, not "za 0 min". */
    now: string;
    /** `{n}` is the whole minutes left. */
    inMinutes: string;
    /** The live dot's own name, for a reader who cannot see it. */
    live: string;
    scheduled: string;
    note: string;
    none: string;
    down: string;
    /** Still waiting for a board: on a screen that never stops running, "no
     *  board in hand" is almost always "not fetched yet". */
    loading: string;
  };
  /** "3 perona": the platforms of the stop a board is of, the app's own words
   *  (transport.platforms_*), not a second kiosk vocabulary for them. */
  platforms: PluralForms;
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
  /** The wall's "U blizini" list (WP1, kiosk.nearby.*): its head, the pill
   *  template "{km} km · ~{min} min" (the measured radius and its walking
   *  minutes), the untimed row's word "uvijek", "do" before a closure's end
   *  date, the timed rows' own titles and the one quiet note on the map while
   *  ZET sends no vehicle positions. */
  nearby: {
    title: string;
    pill: string;
    always: string;
    until: string;
    sunrise: string;
    sunset: string;
    lastTrams: string;
    firstTram: string;
    outageNote: string;
  };
  /** The header sentence (WP1, kiosk.sentence.*): the six kicker words
   *  (Promet · Kultura · Vrijeme · Bicikli · Noćas · Radovi) and the templates
   *  the deterministic fallback fills, one fact each. */
  sentence: Record<SentenceTemplate, string> & { kicker: Record<SentenceKicker, string> };
  /** The handheld invitation's one line: how a public display is started, and that scanning changes nothing on it. */
  handheld: { info: string };
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
    hitno: string;
    basics: string;
    /** "DHMZ · EMSC": the sources, the calm trail, never with a time. */
    sources: string;
    /** "Sigurnost: {verdict}. Otvori Osnovno": the verdict button's name while the invitation shows. */
    openBasics: string;
    /** "hitno" / "mirno" / "nepotvrđeno": the strip's verdict word, from safetyState's level. */
    verdict: Record<'urgent' | 'calm' | 'unknown', string>;
  };
  basics: { title: string; hint: string; close: string; empty: string; routes: string; weather: string; warnings: string; closures: string };
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
  /** The start screen (kiosk/start.ts), its one field (kiosk/place-field.ts,
   *  shared with the settings' Mjesto row) and the sentences the settings
   *  panel reuses: one vocabulary for the one thing that creates and changes a
   *  screen. */
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
    /** The one field's label, "Adresa ili stajalište" (kiosk/place-field.ts). */
    place: string;
    /** "Na zaslonu: {place} i {count} stajališta uokolo": what a screen with a place shows, {count} its Kadar. */
    preview: PluralForms;
    /** "Na zaslonu: cijeli grad.": the line under an empty field. */
    previewCity: string;
    /** Typed text that is neither a stop nor a street, said instead of creating anything. */
    noMatch: string;
    /** A stretch of a long street, named by the stop on it: "{street} · stajalište {stop}". */
    streetNear: string;
    loadingPlaces: string;
    errorPlaces: string;
    /** A typed name more than one street carries: the person picks the row, told apart by its settlement. */
    ambiguous: string;
  };
  /** The on-screen settings overlay (kiosk/settings.ts): the click-toggle rows
   *  (Mjesto, Kadar, Prikaz, Tema, Ritam, Zaslon) and the forget-screen
   *  confirmation. `area`, `areaHint`, `stop`, `stopNone`, `stopHint`, `save`,
   *  `saving` and `saved` belonged to the area/stop/Spremi panel and are read
   *  by nothing any more (ready to delete, WP5). */
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
    /** Mjesto: the row's label, and the button that opens the "Adresa ili stajalište" field. */
    place: string;
    placeChange: string;
    /** Kadar: the row's label, and the toggle's text "Kadar: {count} stajališta odavde" (4, 6 or 8). */
    frame: string;
    frameValue: string;
    /** Prikaz: the row's label and the toggle's two texts, the map or the schematic network. */
    view: string;
    viewMap: string;
    viewSchema: string;
    /** Ritam: the row's label, and the toggle's text "Ritam: {seconds} s" (20, 30 or 60). */
    rhythm: string;
    rhythmValue: string;
  };
}

/** The header sentence's templates (kiosk.sentence.*), each filled from one fact. */
export type SentenceTemplate =
  | 'departureIn' | 'departureAt' | 'busIn' | 'busAt' | 'closureUntil' | 'weather' | 'weatherNoRange' | 'weatherTemperature'
  | 'bikes' | 'sunset' | 'sunsetAt' | 'sunsetTime' | 'sunrise' | 'sunriseAt' | 'sunriseTime' | 'lastTram' | 'firstTram'
  | 'event' | 'opening' | 'pharmacy' | 'always' | 'outage';

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
    invitation: group('invite', ['lead', 'typeCode', 'qrLabel', 'qrWaiting', 'progressLabel']),
    legend: group('legend', ['tram', 'bikes', 'culture']),
    weather: {
      ...group('weather', ['title', 'humidity', 'wind', 'windCalm', 'windNoDir', 'pressure', 'observed', 'sunrise', 'sunset', 'daylight', 'range', 'unavailable', 'loading', 'station', 'noReading']),
      compass: record(COMPASS, (point) => `motion.compass.${point}`),
    },
    arrivals: { ...record(['now', 'inMinutes', 'live', 'scheduled', 'note', 'none', 'down'] as const, (key) => `arrivals.${key}`), loading: t('kiosk.lines.loading') },
    platforms: { one: t('transport.platforms_one'), few: t('transport.platforms_few'), other: t('transport.platforms_other') },
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
    nearby: group('nearby', ['title', 'pill', 'always', 'until', 'sunrise', 'sunset', 'lastTrams', 'firstTram', 'outageNote']),
    sentence: {
      ...group('sentence', [
        'departureIn', 'departureAt', 'busIn', 'busAt', 'closureUntil', 'weather', 'weatherNoRange', 'weatherTemperature',
        'bikes', 'sunset', 'sunsetAt', 'sunsetTime', 'sunrise', 'sunriseAt', 'sunriseTime', 'lastTram', 'firstTram',
        'event', 'opening', 'pharmacy', 'always', 'outage',
      ]),
      kicker: record(['promet', 'kultura', 'vrijeme', 'bicikli', 'nocas', 'radovi'] as const, (kind) => `kiosk.sentence.kicker.${kind}`),
    },
    handheld: group('handheld', ['info']),
    say: {
      ...group('say', ['transit', 'transitRegular', 'transitNoData', 'nearbyNone', 'quake', 'closure', 'zet', 'worksCity', 'today', 'tomorrow', 'tonight', 'allDay']),
      nearby: forms('say', 'nearby'),
      works: forms('say', 'works'),
      tonightMore: forms('say', 'tonightMore'),
    },
    safety: {
      ...group('safety', ['warningsUnknown', 'warningsStale', 'warningsUpcoming', 'warningsLoading', 'closuresUnknown', 'closuresStale', 'closuresNearest', 'basics', 'sources', 'openBasics']),
      label: t('shared.safetyPage'),
      hitno: t('shared.safetyPage'),
      warningsNone: fragment(t('shared.warningsNone')),
      verdict: record(['urgent', 'calm', 'unknown'] as const, (level) => `kiosk.safety.verdict.${level}`),
    },
    basics: group('basics', ['title', 'hint', 'close', 'empty', 'routes', 'weather', 'warnings', 'closures']),
    session: group('session', ['join', 'joinHint', 'selected', 'selectedRoute', 'selectedStop']),
    layers: record(Object.keys(raw.layers) as LayerId[], (layer) => `layers.${layer}`),
    events: record(Object.keys(raw.kiosk.events), (slug) => `kiosk.events.${slug}`),
    paired: {
      ...group('paired', [
        'warnings', 'closures', 'delays', 'quakes', 'today', 'tomorrow', 'later', 'forecast', 'sun', 'pharmacies', 'assemblyPoints',
        'acts', 'sessions', 'works', 'notices', 'ongoing', 'ongoingWord', 'overviewTransport', 'allDay',
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
        'place', 'previewCity', 'noMatch', 'streetNear', 'loadingPlaces', 'errorPlaces', 'ambiguous',
      ]),
      results: forms('setup', 'results'),
      preview: forms('setup', 'preview'),
    },
    settings: group('settings', [
      'open', 'title', 'hint', 'close', 'save', 'saving', 'saved', 'saveOffline', 'saveRefused', 'saveBusy',
      'area', 'areaWhole', 'areaHint', 'stop', 'stopNone', 'stopHint',
      'theme', 'screen', 'expiry', 'expiryNone', 'forget', 'forgetAsk', 'forgetYes', 'forgetNo',
      'place', 'placeChange', 'frame', 'frameValue', 'view', 'viewMap', 'viewSchema', 'rhythm', 'rhythmValue',
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
