// Stage `exports` (lane V1, decision S-14): the derived series as open data
// under Otvorena dozvola. RFC 4180 CSV (UTF-8, LF line ends, comma, quotes
// only where a field needs them), every row with `t_local` (ISO 8601 with
// +02:00) and `t_epoch`; an empty cell is a missing value, never 0. Not in the
// downloads: ZET's RSS titles, press headlines, the observed screen readings,
// raw frames, people. `opis.json` describes every file and its columns.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeBajs, BAJS_MISSING, BAJS_NOT_RENTING, decodeRoutes } from '../../shared/snimka-codec';
import { ZAGREB_OFFSET_S, type Attribution, type BajsFile, type ClosuresFile, type EventsFile, type ExportRef, type HashedRef, type OpisFile, type RoutesFile, type SeriesFile, type StationsFile, type VoiceFile } from '../../shared/snimka';
import type { BajsRefs } from './stage-bajs';
import type { ClosuresRefs } from './stage-closures';
import type { EventsRefs } from './stage-events';
import type { VoiceRefs } from './stage-voice';
import { readWork, writeObject, writeWork, type Paths } from './paths';

export const OPIS_TITLE = 'Tri dana bez tramvaja: izvedeni podaci snimke od 27. rujna do 2. listopada 2026.';
export const LICENCE = { text: 'Otvorena dozvola', url: 'http://data.gov.hr/otvorena-dozvola' } as const;

type Cell = string | number | null | undefined;
type ColumnType = 'int' | 'float' | 'text' | 'time' | 'bool';
export interface Column { name: string; type: ColumnType; unit: string | null; description: string }
export type OpisEntry = OpisFile['exports'][number];
export interface ExportsRefs { exports: ExportRef[]; opis: HashedRef; entries: OpisEntry[] }

/** One RFC 4180 field: quoted only when it holds a comma, a quote or a line break; a missing value is empty. */
export function csvField(value: Cell): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A whole CSV: the header and one line per row, LF line ends, a final LF. */
export function csvText(header: readonly string[], rows: Iterable<readonly Cell[]>): { text: string; rows: number } {
  const lines = [header.map(csvField).join(',')];
  for (const row of rows) {
    if (row.length !== header.length) throw new Error(`exports: a row of ${row.length} cells under ${header.length} columns`);
    lines.push(row.map(csvField).join(','));
  }
  return { text: `${lines.join('\n')}\n`, rows: lines.length };
}

/** `2026-09-28T07:45:00+02:00` for an epoch second (Zagreb summer time over the whole dataset). */
export function localIso(sec: number): string {
  return `${new Date((sec + ZAGREB_OFFSET_S) * 1000).toISOString().slice(0, 19)}+02:00`;
}

const T_COLS: Column[] = [
  { name: 't_local', type: 'time', unit: null, description: 'početak minute ili razdoblja, zagrebačko vrijeme (ISO 8601, +02:00)' },
  { name: 't_epoch', type: 'int', unit: 's', description: 'isto, sekunde od 1. 1. 1970. UTC' },
];
const col = (name: string, type: ColumnType, unit: string | null, description: string): Column => ({ name, type, unit, description });

/** The minute series as rows: every column of the window's SeriesFile, flattened. */
export function seriesRows(s: SeriesFile): { columns: Column[]; rows: Cell[][] } {
  const p = s.published;
  const columns: Column[] = [
    ...T_COLS,
    col('seen_all', 'int', 'vozila', 'vozila s položajem koja je aplikacija objavila, zadnji okvir minute'),
    col('seen_tram', 'int', 'vozila', 'od toga tramvaji'),
    col('seen_bus', 'int', 'vozila', 'od toga autobusi'),
    col('expected_all', 'int', 'vožnje', 'vožnje u tijeku po voznom redu'),
    col('expected_tram', 'int', 'vožnje', 'od toga tramvajske'),
    col('expected_bus', 'int', 'vožnje', 'od toga autobusne'),
    col('service_state', 'text', null, 'stanje usluge: normal, reduced, silent ili unknown'),
    col('service_since', 'time', null, 'od kada traje stanje'),
    col('service_ratio', 'float', null, 'omjer viđenih i očekivanih vozila'),
    col('service_hold', 'text', null, 'zašto stanje nije ocijenjeno: below-min, no-calendar, gap (minuta bez okvira)'),
    col('feed_header_age_s', 'int', 's', 'starost ZET-ova zaglavlja na kraju minute'),
    col('feed_entities', 'int', 'zapisi', 'vozila s položajem u ZET-ovu okviru'),
    col('feed_rejected_future', 'int', 'zapisi', 'položaji odbačeni zbog vremena iz budućnosti'),
    col('feed_hidden_depot', 'int', 'vozila', 'vozila u tramvajskom spremištu, nisu na karti'),
    col('feed_hidden_parked', 'int', 'vozila', 'parkirana vozila, nisu na karti'),
    col('feed_frozen', 'bool', null, '1 kad je ZET-ovo zaglavlje starije od 180 s, inače 0'),
    col('feed_alerts', 'int', 'upozorenja', 'ZET-ova upozorenja „bez prometa” u podacima'),
    col('feed_cancelled_trips', 'int', 'vožnje', 'vožnje koje ZET-ova upozorenja otkazuju, a nijedno vozilo ih ne vozi'),
    col('published_vehicles', 'int', 'vozila', 'broj vozila koji je aplikacija objavila uživo'),
    col('published_item_count', 'int', 'zapisi', 'stavke ZET-ova izvora u objavljenom odgovoru'),
    col('published_status', 'text', null, 'stanje izvora u objavljenom odgovoru: live, stale, down'),
    col('published_service', 'text', null, 'stanje usluge koje je aplikacija objavila uživo'),
    col('bikes_total', 'int', 'bicikli', 'bicikli BAJS-a na stanicama'),
    col('bikes_empty', 'int', 'stanice', 'stanice BAJS-a bez bicikla'),
    col('bikes_reporting', 'int', 'stanice', 'stanice BAJS-a koje su javile stanje'),
    col('closures_active', 'int', 'zatvaranja', 'aktivna zatvaranja ulica'),
    col('closures_version', 'int', null, 'redni broj inačice skupa zatvaranja (closures.geojson)'),
  ];
  const rows: Cell[][] = [];
  for (let m = 0; m < s.n; m++) {
    const t = s.t0 + m * 60;
    const since = s.service.since[m];
    rows.push([
      localIso(t), t, s.seen.all[m], s.seen.tram[m], s.seen.bus[m], s.expected.all[m], s.expected.tram[m], s.expected.bus[m],
      s.service.state[m], since === null ? null : localIso(since), s.service.ratio[m], s.service.hold[m],
      s.feed.headerAgeS[m], s.feed.entities[m], s.feed.rejectedFuture[m], s.feed.hiddenDepot[m], s.feed.hiddenParked[m], s.feed.frozen[m], s.feed.alerts[m], s.feed.cancelledTrips[m],
      p?.vehicles[m], p?.itemCount[m], p?.status[m], p?.service[m],
      s.bikes?.total[m], s.bikes?.empty[m], s.bikes?.reporting[m], s.closures?.active[m], s.closures?.version[m],
    ]);
  }
  return { columns, rows };
}

export function hourlyRows(s: SeriesFile): { columns: Column[]; rows: Cell[][] } {
  const h = s.hourly;
  return {
    columns: [...T_COLS, col('temp_c', 'float', '°C', 'temperatura, DHMZ Zagreb-Maksimir'), col('weather', 'text', null, 'vrijeme riječima, DHMZ'),
      col('news_pulse', 'int', 'naslovi', 'relevantni naslovi triju medija u satu, nakon uklanjanja duplikata (samo broj)')],
    rows: Array.from({ length: h.n }, (_, i) => [localIso(h.t0 + i * 3600), h.t0 + i * 3600, h.tempC[i], h.weather[i], h.newsPulse ? h.newsPulse[i] : null]),
  };
}

export function routesRows(file: RoutesFile): { columns: Column[]; rows: Cell[][] } {
  const { seen, expected } = decodeRoutes(file);
  const rows: Cell[][] = [];
  for (let j = 0; j < file.n; j++) {
    const t = file.t0 + j * file.step;
    file.routes.forEach((r, i) => {
      const s = seen[i]![j]!;
      const e = expected[i]![j]!;
      rows.push([localIso(t), t, r.id, r.shortName, r.type === 0 ? 'tram' : 'bus', s === 255 ? null : s, e === 255 ? null : e]);
    });
  }
  return {
    columns: [...T_COLS, col('route', 'text', null, 'ZET-ova oznaka linije (route_id)'), col('short_name', 'text', null, 'broj linije'), col('type', 'text', null, 'tram ili bus'),
      col('seen', 'int', 'vozila', 'različita vozila linije s položajem u petominutnom razdoblju'), col('expected', 'int', 'vožnje', 'vožnje linije u tijeku po voznom redu na početku razdoblja')],
    rows,
  };
}

export function bikesRows(file: BajsFile): { columns: Column[]; rows: Cell[][] } {
  const matrix = decodeBajs(file);
  const rows: Cell[][] = [];
  for (let j = 0; j < file.n; j++) {
    const t = file.t0 + j * file.step;
    rows.push([localIso(t), t, ...matrix.map((row) => { const v = row[j]!; return v === BAJS_MISSING ? null : v === BAJS_NOT_RENTING ? 'nr' : v; })]);
  }
  return {
    columns: [...T_COLS, ...file.stations.map((id) => col(id, 'int', 'bicikli', `bicikli na stanici ${id}; nr = stanica ne iznajmljuje`))],
    rows,
  };
}

export function stationsRows(file: StationsFile): { columns: Column[]; rows: Cell[][] } {
  return {
    columns: [col('id', 'text', null, 'oznaka stanice (nextbike)'), col('name', 'text', null, 'naziv stanice'), col('lon', 'float', '°', 'zemljopisna dužina'), col('lat', 'float', '°', 'zemljopisna širina'),
      col('capacity', 'int', 'mjesta', 'broj mjesta za bicikle')],
    rows: file.stations.map((s) => [s.id, s.name, s.lon, s.lat, s.capacity]),
  };
}

/** One GeoJSON feature per closure, with the end every recorded version published for it. */
export function closuresGeoJson(file: ClosuresFile): { type: 'FeatureCollection'; features: unknown[] } {
  const ends = file.closures.map(() => [] as { version_from_local: string; end_local: string | null }[]);
  file.byVersion.forEach((row, v) => {
    for (const [idx, end] of row) ends[idx]!.push({ version_from_local: localIso(file.versions[v]!.fromSec), end_local: end === null ? null : localIso(end) });
  });
  return {
    type: 'FeatureCollection',
    features: file.closures.map((c, i) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: c.line },
      properties: { id: c.id, street: c.street, type: c.type, subtype: c.subtype, direction: c.direction, start_local: c.startSec === null ? null : localIso(c.startSec), ends: ends[i] },
    })),
  };
}

/** Sentences whose words quote third-party titles or ZET's notices stay out of the download (S-14). */
const QUOTING = new Set(['event', 'eventLastTram', 'always', 'notice', 'bioToday']);

/** The replayed voice per minute: state, departure voice and the lead sentence (blank where it quotes a third party). */
export function sentencesRows(days: readonly VoiceFile[]): { columns: Column[]; rows: Cell[][] } {
  const rows: Cell[][] = [];
  for (const d of days) {
    for (let i = 0; i < d.n; i++) {
      const t = d.t0 + i * 60;
      const m = d.minutes[i];
      if (!m) { rows.push([localIso(t), t, null, null, null, null]); continue; }
      const leadFact = m.lead === null ? null : d.facts[m.f.find((fi) => d.facts[fi]!.text === d.sentences[m.lead!]) ?? -1] ?? null;
      const family = leadFact?.wording ?? null;
      const text = m.lead === null || (family !== null && QUOTING.has(family)) ? null : d.sentences[m.lead]!;
      rows.push([localIso(t), t, m.state, m.voice, family, text]);
    }
  }
  return {
    columns: [...T_COLS, col('state', 'text', null, 'stanje ZET-a kako ga čita zaslon: normal, reduced, silent, unconfirmed, down, unknown'),
      col('voice', 'text', null, 'koje polaske zaslon smije reći: all, live-only, none'), col('family', 'text', null, 'predložak rečenice'),
      col('sentence', 'text', null, 'rečenica zaglavlja zaslona na Trgu bana Jelačića, izračunana naknadno današnjim pravilima; prazno gdje bi navela tuđi naslov')],
    rows,
  };
}

interface ExportSpec { name: string; format: ExportRef['format']; title: string; description: string; body: string; rows: number | null; columns: Column[] | null }

const MEDIA: Record<ExportRef['format'], ExportRef['mediaType']> = { csv: 'text/csv', json: 'application/json', geojson: 'application/geo+json' };

export async function stageExports(paths: Paths, attribution: Attribution[], log: (line: string) => void): Promise<boolean> {
  const series = readWork<SeriesFile>(paths, 'series-window.json');
  const routes = readWork<RoutesFile>(paths, 'routes-window.json');
  const obj = <T>(ref: HashedRef): T => JSON.parse(readFileSync(join(paths.objects, ref.path), 'utf8')) as T;
  const bajsRefs = readWork<BajsRefs>(paths, 'bajs-refs.json');
  const bajs = obj<BajsFile>(bajsRefs.bajs);
  const stations = obj<StationsFile>(bajsRefs.stations);
  const closures = obj<ClosuresFile>(readWork<ClosuresRefs>(paths, 'closures-refs.json').closures);
  const events = obj<EventsFile>(readWork<EventsRefs>(paths, 'events-refs.json').events);
  const voiceDays = readWork<VoiceRefs>(paths, 'voice-refs.json').days.map((d) => obj<VoiceFile>(d.file));

  const csv = (name: string, title: string, description: string, built: { columns: Column[]; rows: Cell[][] }): ExportSpec => {
    const { text, rows } = csvText(built.columns.map((c) => c.name), built.rows);
    return { name, format: 'csv', title, description, body: text, rows, columns: built.columns };
  };
  const specs: ExportSpec[] = [
    csv('series', 'Stanje usluge i vozila po minuti', 'Jedan redak po minuti snimke: vozila viđena i po voznom redu, stanje usluge, pouzdanost ZET-ovih podataka, ono što je aplikacija objavila, bicikli i zatvorene ulice.', seriesRows(series)),
    csv('hourly', 'Brojevi po satu', 'Jedan redak po satu: temperatura i vrijeme (DHMZ) i broj relevantnih medijskih naslova.', hourlyRows(series)),
    csv('routes-5min', 'Vozila po liniji svakih pet minuta', 'Za svaku liniju i svako petominutno razdoblje: različita vozila s položajem i vožnje po voznom redu. Prazno: bez okvira u razdoblju ili bez voznog reda za dan.', routesRows(routes)),
    csv('bikes-5min', 'Bicikli po stanici svakih pet minuta', 'Broj bicikala na svakoj stanici BAJS-a svakih pet minuta; nr = stanica ne iznajmljuje; prazno = bez podatka.', bikesRows(bajs)),
    csv('stations', 'Stanice BAJS-a', 'Stanice BAJS-a s položajem i brojem mjesta.', stationsRows(stations)),
    csv('sentences', 'Rečenice zaslona po današnjim pravilima', 'Za svaku minutu: kako bi zaslon na Trgu bana Jelačića čitao ZET i koju bi rečenicu rekao, izračunano naknadno današnjim pravilima aplikacije (samo predlošci). Zapisi stvarnog zaslona nisu u preuzimanju.', sentencesRows(voiceDays)),
    { name: 'events', format: 'json', title: 'Događaji snimke', description: 'Poglavlja i oznake snimke s izvorima; izvedeni događaji izračunani su iz niza po minuti.', body: JSON.stringify(events), rows: null, columns: null },
    { name: 'closures', format: 'geojson', title: 'Zatvorene ulice po inačici skupa', description: 'Svako zatvaranje ulice iz skupa Grada Zagreba, s krajem kako ga je objavila svaka snimljena inačica skupa.', body: JSON.stringify(closuresGeoJson(closures)), rows: null, columns: null },
  ];
  const exports: ExportRef[] = [];
  const entries: OpisEntry[] = [];
  for (const spec of specs) {
    const ref = writeObject(paths, `exports/${spec.name}`, spec.format, spec.body);
    const exp: ExportRef = { ...ref, name: spec.name, format: spec.format, mediaType: MEDIA[spec.format], title: spec.title, rows: spec.rows };
    exports.push(exp);
    entries.push({ ...exp, description: spec.description, columns: spec.columns });
  }
  const opis: OpisFile = { v: 2, title: OPIS_TITLE, licence: { ...LICENCE }, attribution, exports: entries };
  const opisRef = writeObject(paths, 'exports/opis', 'json', JSON.stringify(opis));
  exports.push({ ...opisRef, name: 'opis', format: 'json', mediaType: 'application/json', title: 'Opis skupa', rows: null });
  writeWork(paths, 'exports-refs.json', { exports, opis: opisRef, entries } satisfies ExportsRefs);
  log(`exports: ${exports.map((e) => `${e.name} ${e.bytes} B${e.rows !== null ? ` ${e.rows} rows` : ''}`).join(', ')}`);
  return true;
}
