#!/usr/bin/env node
// Evidence for WP5: does a live vehicle's trip id actually appear on the
// scheduled board of the stop it is driving towards?
//
// arrivalsAt (shared/city/arrivals.ts) joins the two by tripId alone. That is
// only worth shipping if ZET's realtime trip ids and the trip ids in the
// static GTFS the departure boards are built from are the same ids on the same
// day. This script measures it against production, read-only:
//
//   node scripts/arrivals-join-rate.mjs
//
// It fetches /api/teaser once, takes the busiest platforms by how many live
// vehicles name them as their next stop, fetches each one's board, and reports
// the share of those vehicles whose tripId is on the board of the very stop
// they are approaching -- overall and per GTFS route type.
//
// Optional argument:
//   --past-minutes=<N>  ESTIMATE, not a measurement. /api/city/departures
//       serves the board it is deployed with and exposes no raw runs, so a
//       past window that is not deployed yet cannot be re-applied here from
//       anything the endpoint returns. What this does instead is count a
//       'rolled off' miss as recovered when the vehicle is running no more
//       than N minutes late: its scheduled slot at that stop is then within N
//       minutes of now, so a board carrying N minutes of scheduled past would
//       still list the row. The output labels the figure as an estimate. The
//       real post-fix rate can only be measured after a deploy.
//
// Optional environment:
//   PROBE_ORIGIN    the deployment to probe; default https://zagreb.aningfilm.hr
//   PROBE_PLATFORMS how many platforms to sample; default 20
//
// It changes nothing and writes nothing. The gate the plan sets is 70 %: below
// that, the join needs a fallback, and that is a ruling, not a patch.

const ORIGIN = process.env.PROBE_ORIGIN ?? 'https://zagreb.aningfilm.hr';
const PLATFORMS = Number(process.env.PROBE_PLATFORMS ?? 20);
const TYPE_NAMES = { 0: 'tram', 3: 'bus' };
const PAST_MINUTES = Number((process.argv.find((a) => a.startsWith('--past-minutes=')) ?? '=0').split('=')[1]) || 0;

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

function pct(part, whole) {
  return whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)} %`;
}

const teaser = await getJson(`${ORIGIN}/api/teaser`);
const zet = (teaser.modules ?? []).find((m) => m.module === 'zet-rt');
if (!zet) throw new Error('no zet-rt module in the teaser');

// One live vehicle per pin, with the two fields the join needs.
const vehicles = (zet.items ?? [])
  .filter((item) => item.id.startsWith('vehicle:'))
  .map((item) => item.data ?? {})
  .filter((data) => typeof data.tripId === 'string' && data.tripId !== '');

const counts = new Map();
for (const v of vehicles) if (typeof v.nextStopId === 'string' && v.nextStopId !== '') counts.set(v.nextStopId, (counts.get(v.nextStopId) ?? 0) + 1);
const busiest = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, PLATFORMS).map(([id]) => id);

const boards = new Map();
for (const stopId of busiest) {
  try {
    boards.set(stopId, await getJson(`${ORIGIN}/api/city/departures?operator=zet&stop=${encodeURIComponent(stopId)}`));
  } catch (error) {
    boards.set(stopId, { status: 'down', departures: [], error: String(error) });
  }
}

const tally = new Map();
const add = (key, hit) => {
  const bucket = tally.get(key) ?? { hit: 0, n: 0 };
  bucket.n++;
  if (hit) bucket.hit++;
  tally.set(key, bucket);
};

// Why a miss missed, because the three reasons want three different answers:
//   'terminal'   the board is empty -- the vehicle is arriving at the end of
//                its own trip, and a terminal arrival is excluded by design.
//                There is no departure to match; no fallback would find one.
//   'rolled off' the board carries this route but starts after the vehicle is
//                due: a late trip's scheduled slot has already passed and the
//                board only lists departures still to come.
//   'unmatched'  the board is up and carries the route in a plausible window,
//                and the trip id is still not on it. This is the only reason a
//                fallback matcher would answer.
function reasonFor(board, vehicle) {
  const departures = board.departures ?? [];
  if (departures.length === 0) return 'terminal';
  const sameRoute = departures.filter((d) => d.routeId === vehicle.routeId);
  if (sameRoute.length === 0) return 'unmatched';
  // The vehicle is at its next stop within a couple of minutes. A board whose
  // first departure of that route is five minutes out has already dropped it.
  const firstMs = Date.parse(sameRoute[0].at);
  return Number.isFinite(firstMs) && firstMs > Date.now() + 5 * 60_000 ? 'rolled off' : 'unmatched';
}

const misses = [];
const reasons = new Map();
for (const v of vehicles) {
  const board = boards.get(v.nextStopId);
  if (!board || board.status === 'down') continue;
  const hit = (board.departures ?? []).some((d) => d.tripId === v.tripId);
  const type = TYPE_NAMES[v.routeType] ?? `type ${v.routeType}`;
  add('all', hit);
  add(type, hit);
  const reason = hit ? null : reasonFor(board, v);
  if (reason !== null) {
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    misses.push({ route: v.routeShortName ?? v.routeId, stop: v.nextStopId, tripId: v.tripId, reason, delaySeconds: v.delaySeconds });
  }
  // A terminal arrival is not a failed join: there is no departure to find.
  if (reason !== 'terminal') add('joinable', hit);
  if (PAST_MINUTES > 0 && reason !== 'terminal') {
    const recovered = reason === 'rolled off' && Number.isFinite(v.delaySeconds) && v.delaySeconds > 0 && v.delaySeconds <= PAST_MINUTES * 60;
    add('estimated', hit || recovered);
  }
}

const all = tally.get('all') ?? { hit: 0, n: 0 };
console.log(`origin           ${ORIGIN}`);
console.log(`teaser           ${teaser.generatedAt} (zet-rt ${zet.status}, source ${zet.sourceUpdatedAt ?? 'n/a'})`);
console.log(`live vehicles    ${vehicles.length} with a tripId, ${counts.size} distinct next stops`);
console.log(`platforms probed ${busiest.length}: ${[...boards].filter(([, b]) => b.status !== 'down').length} answered, ${[...boards].filter(([, b]) => b.status === 'down').length} down`);
console.log(`board rows       ${[...boards.values()].reduce((n, b) => n + (b.departures?.length ?? 0), 0)}`);
console.log('');
console.log(`JOIN RATE        ${pct(all.hit, all.n)}  (${all.hit}/${all.n} vehicles matched a departure on the board of the stop they are approaching)`);
for (const [key, bucket] of [...tally].filter(([k]) => k !== 'all' && k !== 'joinable' && k !== 'estimated').sort()) console.log(`  ${key.padEnd(14)} ${pct(bucket.hit, bucket.n)}  (${bucket.hit}/${bucket.n})`);
const joinable = tally.get('joinable') ?? { hit: 0, n: 0 };
console.log(`  ${'joinable'.padEnd(14)} ${pct(joinable.hit, joinable.n)}  (${joinable.hit}/${joinable.n}, leaving out arrivals at a terminus, which no board lists)`);
if (reasons.size > 0) console.log(`  misses by reason: ${[...reasons].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(', ')}`);
if (PAST_MINUTES > 0) {
  const estimated = tally.get('estimated') ?? { hit: 0, n: 0 };
  console.log('');
  console.log(`  ESTIMATE with a ${PAST_MINUTES}-minute past window on the board: ${pct(estimated.hit, estimated.n)} (${estimated.hit}/${estimated.n} joinable).`);
  console.log('  Not a measurement: the endpoint serves the board it is deployed with and exposes no raw');
  console.log('  runs, so this counts a rolled-off miss as recovered when the vehicle is no more than');
  console.log(`  ${PAST_MINUTES} minutes late. The real rate can only be measured after the fix is deployed.`);
}
console.log('');
console.log(all.n === 0 ? 'NO EVIDENCE: no vehicle met a board that answered.'
  : all.hit / all.n >= 0.7 ? 'AT OR ABOVE the 70 % gate: the tripId join stands on its own.'
    : 'BELOW the 70 % gate: the tripId join needs a ruling on a fallback.');
if (misses.length > 0) {
  console.log('');
  console.log(`misses (${misses.length}):`);
  for (const m of misses.slice(0, 15)) console.log(`  route ${String(m.route).padEnd(4)} stop ${String(m.stop).padEnd(8)} ${m.reason.padEnd(10)} delay ${String(m.delaySeconds ?? '-').padStart(5)}s  trip ${m.tripId}`);
  if (misses.length > 15) console.log(`  ... and ${misses.length - 15} more`);
}
