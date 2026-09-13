// Kiosk copy in Croatian and English. The shared i18n catalogues (i18n/*.json)
// belong to the UI workstream, so every sentence the new kiosk compositions
// say lives here, keyed once and typed so hr and en can never drift apart
// (test/app/kiosk-strings.test.ts walks both). Shared vocabulary that already
// exists in the catalogues -- severity words, delay words, closure plurals,
// "Otključano do" -- is still read through i18n.t so the two surfaces agree.
import type { LayerId } from '../../../worker/protocol';
import { en } from './strings-en';
import { hr } from './strings-hr';

export type PluralForms = { one: string; few?: string; other: string };

export interface KioskStrings {
  appName: string;
  surface: string;
  languageName: string;
  header: { context: string; clockLabel: string; sessionLabel: string; driver: string; temporaryUntil: string; venue: string; unlockedUntil: string };
  status: {
    connecting: string;
    offline: string;
    reconnecting: string;
    dataDown: string;
    dataStale: string;
    lightweight: string;
  };
  invitation: {
    lead: string;
    support: string;
    typeCode: string;
    codeLabel: string;
    qrLabel: string;
    qrWaiting: string;
    codeWaiting: string;
    codeValid: string;
    progressLabel: string;
  };
  weather: {
    title: string;
    humidity: string;
    wind: string;
    windCalm: string;
    /** A measured speed whose direction the station did not state. */
    windNoDir: string;
    /** The eight compass points, the same words the app's weather uses. */
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
    noStop: string;
    modelNote: string;
    vehiclesMoving: PluralForms;
  };
  story: {
    city: string;
    assembly: string;
    zet: string;
    neighbourhood: string;
    works: string;
    news: string;
    quake: string;
    published: string;
    changed: string;
    quakeBody: string;
    empty: string;
  };
  safety: {
    label: string;
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
  };
  basics: { title: string; hint: string; close: string; empty: string; routes: string; weather: string; pharmacy: string; warnings: string; closures: string };
  session: {
    join: string;
    joinHint: string;
    selected: string;
    selectedRoute: string;
    selectedStop: string;
    ended: string;
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
    agenda: string;
    notices: string;
    ongoing: string;
    ongoingWord: string;
    ongoingUntil: string;
    zetNotices: string;
    headlines: string;
    overviewTransport: string;
    allDay: string;
    noData: string;
    sourceDown: string;
    unconfirmed: string;
    dataFrom: string;
    stale: string;
    phase: string;
    amount: string;
    coverage: string;
    routeVehicles: PluralForms;
    depth: string;
    magUnknown: string;
    depthUnknown: string;
    upcomingFrom: string;
    quakeNone: string;
    warningsNone: string;
    closuresNone: string;
    eventsNone: string;
    newsNone: string;
    actsNone: string;
    worksNone: string;
    sessionsNone: string;
    sunUnknown: string;
    rangeUnknown: string;
    untilTime: string;
    direction: string;
    lineWord: string;
    stopWord: string;
    licence: string;
  };
  notice: {
    expiredTitle: string;
    expiredBody: string;
    revokedTitle: string;
    revokedBody: string;
    setupAgain: string;
    endsAfterSession: string;
  };
  setup: {
    title: string;
    intro: string;
    step1: string;
    step2: string;
    districtLegend: string;
    stopLegend: string;
    search: string;
    searchHint: string;
    nearest: string;
    results: PluralForms;
    noResults: string;
    routesAt: string;
    next: string;
    back: string;
    create: string;
    creating: string;
    summary: string;
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
    provisionHint: string;
  };
}

export const KIOSK_CATALOGUES: Readonly<Record<'hr' | 'en', KioskStrings>> = Object.freeze({ hr, en });

/** The catalogue for a locale code; anything that is not English reads Croatian. */
export function kioskStrings(locale: string): KioskStrings {
  return locale.slice(0, 2).toLowerCase() === 'en' ? en : hr;
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
