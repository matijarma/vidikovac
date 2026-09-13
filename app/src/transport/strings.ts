// The transport workspace's own words, in Croatian and English. The shared
// catalogues (i18n/hr.json, en.json) belong to the UI workstream; the
// workspace reuses their keys wherever one already says the right thing
// (panels.map, panels.closures, motion.note, motion.direction...) and keeps
// the rest here, picked by the page's own locale, so a locale switch
// re-renders the workspace in the other language like everything else.
import type { I18n } from '../i18n/i18n';

const HR = {
  search: 'Traži liniju ili stanicu',
  searchLabel: 'Pretraga linija i stanica',
  searchHint: 'Upiši broj linije ili ime stanice. Strelicama biraj, Enter otvara, Escape briše.',
  noResults: 'Nema linije ni stanice za „{query}”.',
  resultsCount_one: '{count} rezultat',
  resultsCount_few: '{count} rezultata',
  resultsCount_other: '{count} rezultata',
  routes: 'Linije',
  stops: 'Stanice',
  trams: 'Tramvaji',
  buses: 'Autobusi',
  showClosures: 'Zatvaranja',
  follow: 'Prati vozilo',
  unfollow: 'Prestani pratiti',
  followingNote: 'Karta prati ovo vozilo; pomak karte prekida praćenje.',
  fitCity: 'Cijeli grad',
  details: 'Detalji',
  collapse: 'Skupi',
  clearSelection: 'Ukloni odabir',
  tram: 'tramvaj',
  bus: 'autobus',
  vehicle: 'Vozilo',
  route: 'Linija',
  stop: 'Stanica',
  closure: 'Zatvaranje',
  routeStops: 'Stanice na liniji',
  stopRoutes: 'Linije na stanici',
  routeVehicles: 'Vozila na liniji sada',
  vehiclesNow_one: '{count} vozilo u pokretu',
  vehiclesNow_few: '{count} vozila u pokretu',
  vehiclesNow_other: '{count} vozila u pokretu',
  noVehiclesNow: 'Trenutačno nijedno vozilo ove linije nije u pokretu.',
  noArrivals: 'ZET ne objavljuje dolaske; prikazana su vozila koja su sada u pokretu.',
  estimated: 'Položaj je procjena modela iz vlastitih očitanja vozila.',
  screenStop: 'Stanica ovog zaslona',
  overviewTitle: 'U pokretu sada',
  overviewHint: 'Odaberi vozilo, liniju ili stanicu na karti ili pretragom.',
  mapLoading: 'Karta se učitava…',
  tilesFailed: 'Podloga karte trenutačno nije dostupna; linije, stanice i vozila su i dalje prikazani.',
  mapUnavailable: 'Karta nije dostupna u ovom pregledniku. Pretraga, linije i stanice rade i bez nje.',
  notices: 'Obavijesti ZET-a',
  showOnMap: 'Prikaži na karti',
  mapRegion: 'Karta prometa',
  keyboardHint: 'Na karti strelice pomiču, plus i minus zumiraju. Escape uklanja odabir.',
  moreStops_one: 'još {count} stanica',
  moreStops_few: 'još {count} stanice',
  moreStops_other: 'još {count} stanica',
  moreVehicles_one: 'još {count} vozilo',
  moreVehicles_few: 'još {count} vozila',
  moreVehicles_other: 'još {count} vozila',
  held: 'stoji na stanici',
  freeMotion: 'izvan poznate geometrije linije',
  platforms_one: '{count} peron',
  platforms_few: '{count} perona',
  platforms_other: '{count} perona',
  runningRoutes: 'Linije u pokretu',
  noRunning: 'Trenutačno nema vozila u pokretu.',
  zoomIn: 'Približi',
  zoomOut: 'Udalji',
  resetBearing: 'Okreni na sjever',
  selectionOnScreen: 'Odabir se prikazuje i na zaslonu.',
  back: 'Natrag na pregled',
  clearSearch: 'Očisti pretragu',
  searchResults: 'Rezultati pretrage',
  modesLabel: 'Prikaz na karti',
  sheetLabel: 'Detalji prometa',
  toolsLabel: 'Alati karte',
  noClosures: 'Trenutačno nema zatvorenih prometnica.',
  lightHint: 'Lagani prikaz: karta se ne učitava. Linije u pokretu i zatvaranja su ispod.',
  stopVehiclesNow: 'Sada u pokretu na linijama ove stanice',
  noStopVehicles: 'Trenutačno nijedno vozilo linija s ove stanice nije u pokretu.',
  vehicleTitle: '{kind} {short}',
  routeTitle: 'Linija {short}',
  showRoute: 'Prikaži liniju',
  peekLoading: 'Vozila se učitavaju…',
  peekFollowing: 'Praćenje: {title}',
  closuresAndNotices: 'Zatvaranja i obavijesti',
  openNotice: 'Otvori obavijest',
};

const EN: Record<keyof typeof HR, string> = {
  search: 'Search a route or a stop',
  searchLabel: 'Search routes and stops',
  searchHint: 'Type a route number or a stop name. Arrow keys choose, Enter opens, Escape clears.',
  noResults: 'No route or stop matches “{query}”.',
  resultsCount_one: '{count} result',
  resultsCount_few: '{count} results',
  resultsCount_other: '{count} results',
  routes: 'Routes',
  stops: 'Stops',
  trams: 'Trams',
  buses: 'Buses',
  showClosures: 'Closures',
  follow: 'Follow vehicle',
  unfollow: 'Stop following',
  followingNote: 'The map follows this vehicle; moving the map stops following.',
  fitCity: 'Whole city',
  details: 'Details',
  collapse: 'Collapse',
  clearSelection: 'Clear selection',
  tram: 'tram',
  bus: 'bus',
  vehicle: 'Vehicle',
  route: 'Route',
  stop: 'Stop',
  closure: 'Closure',
  routeStops: 'Stops on this route',
  stopRoutes: 'Routes at this stop',
  routeVehicles: 'Vehicles on the route now',
  vehiclesNow_one: '{count} vehicle moving',
  vehiclesNow_few: '{count} vehicles moving',
  vehiclesNow_other: '{count} vehicles moving',
  noVehiclesNow: 'No vehicle of this route is moving right now.',
  noArrivals: 'ZET publishes no arrival times; the vehicles moving right now are shown.',
  estimated: 'The position is the model’s estimate from the vehicle’s own reports.',
  screenStop: 'This screen’s stop',
  overviewTitle: 'Moving now',
  overviewHint: 'Pick a vehicle, a route or a stop on the map or through search.',
  mapLoading: 'Map loading…',
  tilesFailed: 'The base map is unavailable right now; routes, stops and vehicles are still shown.',
  mapUnavailable: 'The map is not available in this browser. Search, routes and stops work without it.',
  notices: 'ZET notices',
  showOnMap: 'Show on the map',
  mapRegion: 'Transport map',
  keyboardHint: 'On the map the arrow keys pan and plus and minus zoom. Escape clears the selection.',
  moreStops_one: '{count} more stop',
  moreStops_few: '{count} more stops',
  moreStops_other: '{count} more stops',
  moreVehicles_one: '{count} more vehicle',
  moreVehicles_few: '{count} more vehicles',
  moreVehicles_other: '{count} more vehicles',
  held: 'standing at a stop',
  freeMotion: 'off the known route geometry',
  platforms_one: '{count} platform',
  platforms_few: '{count} platforms',
  platforms_other: '{count} platforms',
  runningRoutes: 'Routes running',
  noRunning: 'No vehicle is moving right now.',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetBearing: 'Reset bearing to north',
  selectionOnScreen: 'The selection also shows on the screen.',
  back: 'Back to the overview',
  clearSearch: 'Clear search',
  searchResults: 'Search results',
  modesLabel: 'Show on the map',
  sheetLabel: 'Transport details',
  toolsLabel: 'Map tools',
  noClosures: 'No street is closed right now.',
  lightHint: 'Light view: the map does not load. Routes moving now and closures are below.',
  stopVehiclesNow: 'Moving now on this stop’s routes',
  noStopVehicles: 'No vehicle of this stop’s routes is moving right now.',
  vehicleTitle: '{kind} {short}',
  routeTitle: 'Route {short}',
  showRoute: 'Show the route',
  peekLoading: 'Loading vehicles…',
  peekFollowing: 'Following: {title}',
  closuresAndNotices: 'Closures and notices',
  openNotice: 'Open the notice',
};

export type TransportKey = keyof typeof HR;

type PluralBase<K extends string> = K extends `${infer Base}_one` ? Base : never;
/** Keys with `_one/_few/_other` forms, addressed by their base name. */
export type TransportPluralKey = PluralBase<TransportKey>;

function catalogue(locale: string): Record<TransportKey, string> {
  return locale.toLowerCase().startsWith('en') ? EN : HR;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  let out = template;
  for (const [key, value] of Object.entries(vars)) out = out.split(`{${key}}`).join(String(value));
  return out;
}

/** A workspace string in the page's locale, with `{var}` interpolation. */
export function tr(i18n: Pick<I18n, 'getLocale'>, key: TransportKey, vars?: Record<string, string | number>): string {
  return interpolate(catalogue(i18n.getLocale())[key], vars);
}

/** The plural form of `base` for `count`, by the locale's own rules (Croatian
 *  has one / few / other; English one / other, whose `few` reads as other). */
export function trPlural(i18n: Pick<I18n, 'getLocale'>, base: TransportPluralKey, count: number, vars: Record<string, string | number> = {}): string {
  const locale = i18n.getLocale();
  let category = 'other';
  try {
    category = new Intl.PluralRules(locale).select(count);
  } catch {
    /* an unrecognised tag: `other` exists in every language */
  }
  const table = catalogue(locale);
  const key = (`${base}_${category}` in table ? `${base}_${category}` : `${base}_other`) as TransportKey;
  return interpolate(table[key], { count, ...vars });
}
