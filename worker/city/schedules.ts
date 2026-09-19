import { createInflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';
import type { DepartureBoard, Place, ScheduledDeparture } from '../../shared/city/types';
import { cityId } from '../../shared/city/geo';
import { csvRows, clean } from './normalize';
export const SCHEDULE_DAYS = 14;
export interface ScheduleStop {
  name: string; lon: number; lat: number;
  /** service-day bitset, GTFS seconds, trip id, route id, route label, headsign */
  runs: [number, number, string, string, string, string][];
}
export interface SchedulePart {
  schema: 1; operator: 'zet' | 'hz'; generatedAt: string; days: string[]; validUntil: string;
  stops: Record<string, ScheduleStop>;
}
interface ZipEntry { name: string; start: number; size: number; unpacked: number; method: number }
function zipEntries(bytes: Uint8Array): ZipEntry[] {
  if(bytes.length<22||bytes.length>64_000_000)throw new Error('gtfs-zip-size');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65558) && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < Math.max(0,bytes.length-65558) || v.getUint32(end, true) !== 0x06054b50) throw new Error('gtfs-zip');
  const count = v.getUint16(end + 10, true);
  if(count>1000||v.getUint16(end+4,true)!==0||v.getUint16(end+6,true)!==0)throw new Error('gtfs-zip-directory');
  let pos = v.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (pos+46>end||v.getUint32(pos, true) !== 0x02014b50) throw new Error('gtfs-zip-directory');
    const length = v.getUint16(pos + 28, true), extra = v.getUint16(pos + 30, true), comment = v.getUint16(pos + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + length));
    const local = v.getUint32(pos + 42, true);
    if(pos+46+length+extra+comment>end||local+30>bytes.length||v.getUint32(local,true)!==0x04034b50||(v.getUint16(pos+8,true)&1))throw new Error('gtfs-zip-entry');
    const start=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true),size=v.getUint32(pos+20,true),unpacked=v.getUint32(pos+24,true);
    if(start+size>bytes.length||unpacked>512_000_000)throw new Error('gtfs-zip-entry-size');
    entries.push({ name, start, size, unpacked, method: v.getUint16(pos + 10, true) });
    pos += 46 + length + extra + comment;
  }
  return entries;
}
async function* records(bytes: Uint8Array, entry: ZipEntry): AsyncGenerator<Record<string, string>> {
  const compressed = bytes.subarray(entry.start, entry.start + entry.size);
  const chunks = entry.method === 0 ? Readable.from([compressed]) : entry.method === 8 ? Readable.from([compressed]).pipe(createInflateRaw()) : null;
  if (!chunks) throw new Error('gtfs-compression');
  let buffer = '', headers: string[] | null = null, scanned=0, quoted=false, expanded=0;
  const decoder = new TextDecoder();
  const parse = (line: string) => {
    const values = csvRows(line.replace(/\r$/, ''), ',')[0];
    if (!values) return null;
    if (!headers) { headers = values; return null; }
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  };
  for await (const chunk of chunks) {
    expanded+=chunk.length;
    if(expanded>entry.unpacked||expanded>512_000_000)throw new Error('gtfs-expanded-size');
    buffer += decoder.decode(chunk, { stream: true });
    // Quote parity also handles doubled quotes, including at chunk boundaries.
    for(;scanned<buffer.length;scanned++){
      if(buffer[scanned]==='"')quoted=!quoted;
      if(buffer[scanned]==='\n'&&!quoted){
        const row=parse(buffer.slice(0,scanned));buffer=buffer.slice(scanned+1);scanned=-1;
        if(row)yield row;
      }
    }
    if (buffer.length > 1_000_000) throw new Error('gtfs-row-too-long');
  }
  buffer += decoder.decode();
  if(quoted)throw new Error('gtfs-unterminated-quote');
  const last = parse(buffer); if (last) yield last;
}
const DAY_MS = 86_400_000;
const ZAGREB_HOUR=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Zagreb',hour:'2-digit',hourCycle:'h23'});
export function zagrebDay(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
/** Noon minus twelve hours, then GTFS seconds: handles >24h and DST. */
export function scheduleInstant(day: string, seconds: number): number {
  const guess = Date.parse(day + 'T10:00:00Z');
  const hour = Number(ZAGREB_HOUR.format(guess));
  return guess + (12 - hour - 12) * 3_600_000 + seconds * 1000;
}
export function stopShard(id: string): string {
  let h = 0;
  for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return String(h % 32).padStart(2, '0');
}
export async function buildSchedule(bytes: Uint8Array, operator: 'zet' | 'hz', now: number): Promise<{ parts: SchedulePart[]; places: Place[] }> {
  const entries = zipEntries(bytes);
  const read = (name: string) => {
    const entry = entries.find(e => e.name === name);
    if (!entry) throw new Error('gtfs-missing-' + name);
    return records(bytes, entry);
  };
  const firstDay = Date.parse(zagrebDay(now) + 'T12:00:00Z') - DAY_MS;
  const days = Array.from({ length: SCHEDULE_DAYS + 1 }, (_, i) => new Date(firstDay + i * DAY_MS).toISOString().slice(0, 10));
  const services = new Map<string, number>();
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if (entries.some(e => e.name === 'calendar.txt')) for await (const r of read('calendar.txt')) {
    let mask = 0;
    days.forEach((day, i) => { const compact = day.replace(/-/g, ''); if (compact >= r.start_date && compact <= r.end_date && r[weekdays[new Date(day + 'T12:00:00Z').getUTCDay()]] === '1') mask |= 1 << i; });
    if (mask) services.set(r.service_id, mask);
  }
  if (entries.some(e => e.name === 'calendar_dates.txt')) for await (const r of read('calendar_dates.txt')) {
    const i = days.findIndex(day => day.replace(/-/g, '') === r.date);
    if (i < 0) continue;
    const mask = services.get(r.service_id) ?? 0;
    services.set(r.service_id, r.exception_type === '1' ? mask | (1 << i) : mask & ~(1 << i));
  }
  if (![...services.values()].some(Boolean)) throw new Error('gtfs-no-current-service');
  const route = new Map<string, { name: string; short: string }>();
  for await (const r of read('routes.txt')) route.set(r.route_id, { name: clean(r.route_long_name), short: clean(r.route_short_name) });
  const trips = new Map<string, { id:string;mask: number; route: string; label: string; headsign: string }>();
  for await (const r of read('trips.txt')) {
    const mask = services.get(r.service_id);
    if (mask) trips.set(r.trip_id, { id:r.trip_id,mask, route: r.route_id, label: route.get(r.route_id)?.short || route.get(r.route_id)?.name || r.route_id, headsign: clean(r.trip_headsign) || route.get(r.route_id)?.name || '' });
  }
  const lastActive=days.reduce((last,_,i)=>[...services.values()].some(mask=>mask&(1<<i))?i:last,0);
  const generatedAt = new Date(now).toISOString();
  const lastActiveStart=scheduleInstant(days[lastActive],0);
  let validUntilMs=lastActiveStart+DAY_MS;
  const validUntil=new Date(validUntilMs).toISOString();
  const parts = Array.from({ length: 32 }, (): SchedulePart => ({ schema: 1, operator, generatedAt, days, validUntil, stops: {} }));
  const stopMap = new Map<string, ScheduleStop>();
  const places: Place[] = [];
  for await (const s of read('stops.txt')) {
    const lon = Number(s.stop_lon), lat = Number(s.stop_lat);
    if (!s.stop_id || !s.stop_name || lon < 15.7 || lon > 16.3 || lat < 45.5 || lat > 46.02 || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const stop: ScheduleStop = { name: clean(s.stop_name), lon, lat, runs: [] };
    stopMap.set(s.stop_id, stop);
    parts[Number(stopShard(s.stop_id))].stops[s.stop_id] = stop;
    if (operator === 'hz') places.push({ id: cityId('rail', s.stop_id), name: stop.name, lon, lat, category: 'rail', sourceId: 'hz-schedule', sourceRecord: s.stop_id });
  }
  const endpoints=new Map<string,number>();
  for await(const r of read('stop_times.txt')){
    if(!trips.has(r.trip_id))continue;
    const sequence=Number(r.stop_sequence);
    if(Number.isFinite(sequence))endpoints.set(r.trip_id,Math.max(endpoints.get(r.trip_id)??-1,sequence));
  }
  for await (const r of read('stop_times.txt')) {
    const trip = trips.get(r.trip_id), stop = stopMap.get(r.stop_id);
    if (!trip || !stop || r.pickup_type === '1' || Number(r.stop_sequence)===endpoints.get(r.trip_id)) continue;
    const m = r.departure_time?.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/);
    if (!m) continue;
    const seconds=Number(m[1])*3600+Number(m[2])*60+Number(m[3]);
    if(seconds>=48*3600)continue;
    if(trip.mask&(1<<lastActive))validUntilMs=Math.max(validUntilMs,lastActiveStart+seconds*1000+1000);
    stop.runs.push([trip.mask,seconds, trip.id, trip.route, trip.label, trip.headsign]);
  }
  for (const s of stopMap.values()) s.runs.sort((a, b) => a[1] - b[1]);
  for(const part of parts)part.validUntil=new Date(validUntilMs).toISOString();
  return { parts, places };
}
/** How much scheduled past a board carries (WP5). A board of nothing but
 *  future departures drops a trip the moment its scheduled minute passes,
 *  which is exactly when a late tram is closest and the rider most wants it:
 *  the join-rate probe found that "rolled off the board" was the largest
 *  reason a tracked vehicle had no row to be matched to. Fifteen minutes is
 *  longer than any delay ZET reports routinely. These rows ride ON TOP of the
 *  twelve-row count, never inside it (R-25): they are there so a late trip has
 *  a row to be matched to, and a one-minute-headway platform must not pay for
 *  them with the twelve future departures a rider is actually waiting for.
 *  Which of these rows has actually gone is decided against live positions in
 *  shared/city/arrivals.ts, not here: the schedule does not know. */
export const DEPARTURES_PAST_WINDOW_MS = 15 * 60_000;

/** Future departures a board carries. Unchanged; only what it counts changed. */
export const DEPARTURES_ROWS = 12;

export function departuresFrom(part: SchedulePart | null, operator: 'zet' | 'hz', stopId: string, now: number): DepartureBoard {
  const stop = part?.stops[stopId];
  const valid = part && now < Date.parse(part.validUntil) && now >= scheduleInstant(part.days[0], 0);
  // Two lists, because the cap is on the future alone (R-25).
  const past: ScheduledDeparture[] = [];
  const future: ScheduledDeparture[] = [];
  if (stop && valid) {
    const starts=part.days.map(day=>scheduleInstant(day,0));
    for (const [mask, seconds, tripId, routeId, routeName, headsign] of stop.runs) {
      for (let i = 0; i < part.days.length; i++) if (mask & (1 << i)) {
        const at = starts[i]+seconds*1000;
        if (at < now - DEPARTURES_PAST_WINDOW_MS || at > now + DAY_MS) continue;
        (at < now ? past : future).push({ operator, tripId, routeId, routeName, headsign, at: new Date(at).toISOString() });
      }
    }
  }
  const byTime = (a: ScheduledDeparture, b: ScheduledDeparture): number => a.at.localeCompare(b.at);
  past.sort(byTime); future.sort(byTime);
  return { operator, stopId, stopName: stop?.name ?? stopId, status: valid && stop ? 'live' : 'down',
    generatedAt: part?.generatedAt ?? new Date(now).toISOString(), validUntil: part?.validUntil, departures: [...past, ...future.slice(0, DEPARTURES_ROWS)] };
}
