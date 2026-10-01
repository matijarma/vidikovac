// What the wall showed, counted from an observation's rotation.jsonl (docs/reveal-2026-10.md §5.2 (g),
// docs/reveal-2026-10-plan/R4.md §0.2 (a)). Plain JavaScript without a dependency: scripts/shown-facts.mjs prints it and
// scripts/observe-production.mjs judges its `shown-facts` row with it, so the verdict and the script count the same way.
//
// What counts as transit: the rows of kind `departures` (the one line since R1) and `departure` (the three rows of a
// recording made before R1). Everything else on the list is a non-transit row, and the number of DISTINCT non-transit
// row ids the wall put in front of people in an hour is the KPI (`nonTransit`). Sentence facts are reported beside it and
// never added to it, because a row and its sentence are usually the same fact (a rain row and `rainAt`). `city` is the
// stricter column without promises about trams and trains and ZET's own notice (first, last, notice, rail): monitored only.

/** Row kinds that are transit (brief §5.2 (g)); `departure` covers recordings made before R1. */
export const TRANSIT_KINDS = Object.freeze(['departure', 'departures']);
/** Kinds left out of the stricter "city" column (monitored only): promises about trams and trains, and ZET's own notice. */
export const PROMISE_KINDS = Object.freeze(['first', 'last', 'notice', 'rail']);
/** Sentence wordings that are about transit (app/src/city/sentence.ts SENTENCE_COPY_HR keys). */
export const TRANSIT_WORDINGS = Object.freeze(['departureIn', 'departureAt', 'busIn', 'busAt', 'lastTram', 'firstTram', 'outage', 'notice', 'service', 'serviceNone', 'trainAt', 'eventLastTram']);
/** One reading's spacing in a rotation recording (e2e/wall.ts ROTATION_STEP_MS). */
export const ROTATION_STEP_MS = 2000;

const HOUR_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

/** 'YYYY-MM-DD HH' of an instant in Europe/Zagreb. */
export function zagrebHourKey(atMs) {
  const p = {};
  for (const part of HOUR_FORMAT.formatToParts(new Date(atMs))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}`;
}

/**
 * The reveal of a reading: { kind, id, beat } or null. Parses defensively (R4.md §0.5): a string `page:<beat>` /
 * `advance:<beat>` (what R2 writes; `id` is null), the brief's older `<kind>:<id>:<beat>` (the id may hold colons), or
 * the observer's `{ list, line }` object (the list's value first). Anything else is null.
 */
export function revealOf(value) {
  if (value && typeof value === 'object') return revealOf(value.list || value.line || null);
  if (typeof value !== 'string') return null;
  const parts = value.split(':');
  if (parts.length < 2) return null;
  const kind = parts[0];
  if (kind !== 'advance' && kind !== 'page') return null;
  const last = parts[parts.length - 1];
  if (!/^\d+$/.test(last)) return null;
  const id = parts.length > 2 ? parts.slice(1, -1).join(':') : null;
  return { kind, id, beat: Number(last) };
}

const isValid = (r) => r && typeof r === 'object' && Number.isFinite(r.at) && Array.isArray(r.rows) && !r.error;
const isTransitWording = (fact) => {
  const wording = String(fact).split('|')[0];
  return wording === 'text' || TRANSIT_WORDINGS.includes(wording);
};

function emptyHour(hour) {
  return { hour, readings: 0, failed: 0, ids: new Map(), facts: new Set(), episodes: [], open: null, dmin: null, dmax: null };
}

/** Readings (parsed rotation.jsonl lines) to the per-hour table and the summary (the JSON of shown-facts.mjs --json). */
export function shownFacts(readings) {
  const hours = new Map();
  const hourOf = (at) => {
    const key = zagrebHourKey(at);
    let h = hours.get(key);
    if (!h) hours.set(key, (h = emptyHour(key)));
    return h;
  };
  let failed = 0;
  let valid = 0;
  let from = null;
  let to = null;
  const runIds = new Set();
  const sorted = [...readings].filter((r) => r && typeof r === 'object');
  for (const r of sorted) {
    if (!isValid(r)) {
      if (r && Number.isFinite(r.at)) hourOf(r.at).failed += 1;
      failed += 1;
      continue;
    }
    valid += 1;
    if (from === null || r.at < from) from = r.at;
    if (to === null || r.at > to) to = r.at;
    const h = hourOf(r.at);
    h.readings += 1;
    for (const row of r.rows) {
      if (!row || row.id == null || TRANSIT_KINDS.includes(row.kind)) continue;
      const kind = String(row.kind);
      if (!h.ids.has(kind)) h.ids.set(kind, new Set());
      h.ids.get(kind).add(String(row.id));
      runIds.add(String(row.id));
    }
    if (typeof r.fact === 'string' && r.fact) h.facts.add(r.fact);
    if (typeof r.departures === 'number') {
      h.dmin = h.dmin === null ? r.departures : Math.min(h.dmin, r.departures);
      h.dmax = h.dmax === null ? r.departures : Math.max(h.dmax, r.departures);
    }
    const reveal = revealOf(r.reveal);
    const value = typeof r.reveal === 'string' ? r.reveal : r.reveal && typeof r.reveal === 'object' ? r.reveal.list || r.reveal.line || null : null;
    if (reveal && value) {
      if (h.open && h.open.value === value) h.open.lastAt = r.at;
      else {
        h.open = { value, kind: reveal.kind, beat: reveal.beat, firstAt: r.at, lastAt: r.at };
        h.episodes.push(h.open);
      }
    } else h.open = null;
  }
  const out = [];
  for (const key of [...hours.keys()].sort()) {
    const h = hours.get(key);
    const rows = {};
    const all = new Set();
    const city = new Set();
    for (const kind of [...h.ids.keys()].sort()) {
      rows[kind] = [...h.ids.get(kind)].sort();
      for (const id of rows[kind]) {
        all.add(id);
        if (!PROMISE_KINDS.includes(kind)) city.add(id);
      }
    }
    const facts = [...h.facts].sort();
    const eps = h.episodes;
    let minGapBeats = null;
    for (let i = 1; i < eps.length; i++) {
      const gap = Math.abs(eps[i].beat - eps[i - 1].beat);
      if (minGapBeats === null || gap < minGapBeats) minGapBeats = gap;
    }
    const dwell = eps.length ? Math.max(...eps.map((e) => e.lastAt - e.firstAt + ROTATION_STEP_MS)) : null;
    out.push({
      hour: key,
      readings: h.readings,
      failed: h.failed,
      rows,
      nonTransit: all.size,
      city: city.size,
      facts,
      nonTransitFacts: facts.filter((f) => !isTransitWording(f)).length,
      reveals: {
        count: eps.length,
        byKind: { advance: eps.filter((e) => e.kind === 'advance').length, page: eps.filter((e) => e.kind === 'page').length },
        distinct: [...new Set(eps.map((e) => e.value))],
        minGapBeats,
        maxDwellMs: dwell,
      },
      departures: { min: h.dmin, max: h.dmax },
    });
  }
  let fewest = null;
  for (const h of out) if (h.readings > 0 && (fewest === null || h.nonTransit < fewest.nonTransit)) fewest = { hour: h.hour, nonTransit: h.nonTransit };
  return {
    readings: valid,
    failed,
    from: from === null ? null : new Date(from).toISOString(),
    to: to === null ? null : new Date(to).toISOString(),
    hours: out,
    summary: { nonTransit: runIds.size, fewest },
  };
}

/** The Markdown report of shownFacts(), with the summary line last. */
export function shownFactsMarkdown(result, title) {
  const L = [`# Shown facts: ${title}`, ''];
  L.push(`${result.readings} readings, ${result.failed} failed${result.from ? `, from ${result.from} to ${result.to}` : ''}.`, '');
  for (const h of result.hours) {
    L.push(`## ${h.hour}:00 (${h.readings} readings, ${h.failed} failed)`, '');
    L.push('| Kind | Distinct rows | Row ids |', '|---|---:|---|');
    for (const kind of Object.keys(h.rows)) L.push(`| ${kind} | ${h.rows[kind].length} | ${h.rows[kind].map((id) => `\`${id.replace(/\|/g, '/')}\``).join(', ')} |`);
    L.push('');
    L.push(`Non-transit rows: ${h.nonTransit}; without first, last, notice and rail: ${h.city}.`);
    L.push(`Sentence facts: ${h.facts.length} distinct, ${h.nonTransitFacts} not about transit: ${h.facts.join(', ') || 'none'}.`);
    const r = h.reveals;
    L.push(
      r.count === 0
        ? 'Reveals: none.'
        : `Reveals: ${r.count} (page ${r.byKind.page}, advance ${r.byKind.advance}); shortest gap ${r.minGapBeats === null ? 'none' : `${r.minGapBeats} beats`}; longest dwell ${r.maxDwellMs / 1000} s.`,
    );
    L.push(`Departures cells: ${h.departures.min === null ? 'none' : `${h.departures.min} to ${h.departures.max}`}.`, '');
  }
  L.push('## Summary', '');
  L.push(`Distinct non-transit rows over the run: ${result.summary.nonTransit}.`);
  const f = result.summary.fewest;
  L.push(f ? `Fewest non-transit facts: ${f.hour}:00 (${f.nonTransit}).` : 'Fewest non-transit facts: none (no valid reading).');
  return L.join('\n');
}
