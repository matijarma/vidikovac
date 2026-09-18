/** Public city vocabulary. No private search, position, or saved-list fields. */
export const CITY_SCHEMA = 1 as const;
export const PLACE_CATEGORIES = [
  'culture', 'water', 'toilet', 'sport', 'dogs', 'recycling', 'market',
  'wifi', 'cycle-parking', 'garage', 'charging', 'heritage', 'rail',
] as const;
export type PlaceCategory = typeof PLACE_CATEGORIES[number];
export type CityStatus = 'live' | 'stale' | 'down';
export interface CitySource {
  id: string;
  name: string;
  url: string;
  licence: string;
  status: CityStatus;
  fetchedAt?: string;
  updatedAt?: string;
  count: number;
  limited?: boolean;
  note?: string;
}
export interface Place {
  id: string;
  category: PlaceCategory;
  name: string;
  lon?: number;
  lat?: number;
  address?: string;
  district?: string;
  subtype?: string;
  website?: string;
  phone?: string;
  description?: string;
  hours?: string;
  /** Published attributes, not live operational claims. */
  facts?: Record<string, string | number | boolean>;
  sourceId: string;
  sourceRecord: string;
  updatedAt?: string;
  /** Heritage protected-area geometry; not a building entrance. */
  polygons?: [number, number][][][];
}
export interface StreetStory {
  id: string;
  name: string;
  settlement: string;
  settlementId: string;
  description: string;
  updatedAt?: string;
}
export interface CityPath {
  id: string;
  name: string;
  kind: 'cycle';
  lines: [number, number][][];
  surface?: string;
  district?: string;
  sourceId: string;
}
export interface Settlement {
  id: string;
  name: string;
  polygons: [number, number][][][];
}
export interface CatalogueData {
  places: Place[];
  streets: StreetStory[];
  paths: CityPath[];
  settlements: Settlement[];
}
export interface CatalogueChunk {
  schema: typeof CITY_SCHEMA;
  source: CitySource;
  data: CatalogueData;
}
export interface CatalogueEntry extends CitySource {
  kind: 'places' | 'streets' | 'paths' | 'settlements' | 'schedules';
  chunks: { hash: string; bytes: number; part?: string }[];
  etag?: string;
  lastModified?: string;
}
export interface CatalogueManifest {
  schema: typeof CITY_SCHEMA;
  version: string;
  generatedAt: string;
  sources: CatalogueEntry[];
}
export interface BikeStation {
  id: string;
  name: string;
  lon: number;
  lat: number;
  bikes: number | null;
  docks: number | null;
  capacity: number | null;
  installed: boolean;
  renting: boolean;
  returning: boolean;
  observedAt?: string;
  rentalUrl?: string;
}
export interface AirStation {
  id: string;
  name: string;
  lon: number;
  lat: number;
  index: number | null;
  observedAt?: string;
  pollutants?: { name: string; value: number | null; index: number | null }[];
}
export interface Consultation {
  id: string;
  title: string;
  institution: string;
  status: string;
  start: string;
  end: string;
  url: string;
}
export interface CityLive {
  schema: typeof CITY_SCHEMA;
  generatedAt: string;
  sources: CitySource[];
  bikes: BikeStation[];
  air: AirStation[];
  river?: { text: string; publishedAt: string; period: string; warning?: string };
  consultations: Consultation[];
}
export interface CityState extends CatalogueData {
  manifest: CatalogueManifest | null;
  live: CityLive | null;
  loading: boolean;
  errors: string[];
  loaded: string[];
}
export const emptyCatalogue = (): CatalogueData => ({ places: [], streets: [], paths: [], settlements: [] });
export const emptyCity = (): CityState => ({ ...emptyCatalogue(), manifest: null, live: null, loading: false, errors: [], loaded: [] });
export interface ScheduledDeparture {
  operator: 'zet' | 'hz';
  tripId: string;
  routeId: string;
  routeName: string;
  headsign: string;
  at: string;
}
export interface DepartureBoard {
  operator: 'zet' | 'hz';
  stopId: string;
  stopName: string;
  status: CityStatus;
  generatedAt: string;
  validUntil?: string;
  departures: ScheduledDeparture[];
}
