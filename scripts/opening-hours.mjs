// The subset of the OpenStreetMap `opening_hours` syntax that scripts/osm-hours.mjs turns
// into a plain week (https://wiki.openstreetmap.org/wiki/Key:opening_hours/specification).
// Supported: rules separated by ';' (a later rule replaces the days it names) and by ','
// before a weekday selector (an additional rule, which adds to those days); weekday
// selectors as single days, ranges (also wrapping, "Fr-Mo") and lists ("Mo, We, Fr");
// several time ranges a day; a range whose close lies before its open runs past midnight;
// 24:00 as a close (00:00 as a close means midnight too); "24/7"; "off" and "closed" (also
// capitalised, a common slip whose meaning is plain); a rule without a weekday selector
// holds for every day. Public-holiday rules ("PH off",
// "PH 12:00-20:00", the PH in "Su,PH off") are ignored: the screen shows nothing from this
// file on a holiday (shared/city/osm-hours.ts). Every other form (months, dates, weeks,
// nth weekdays "Sa[1,3]", comments in quotes, school holidays, sunrise, open ends "18:00+",
// fallback rules "||", times past 24:00, a selector without a time) drops the whole value:
// a half-read rule could claim a place open when it is shut.
//
// A week is seven day fields, Monday first; a field is its ranges as "HHMM-HHMM" joined
// by ',' ("" closed), sorted by opening time; the fields are joined by '|'.

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const TOKEN = /\s*(?:(24\/7)|(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?|(PH)|(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})|([Oo]ff|[Cc]losed)|(,))\s*/y;

/** Minutes of "HH", "MM"; null when out of range. `close` admits 24:00. */
function minutes(h, m, close) {
  const hh = Number(h), mm = Number(m);
  if (mm > 59) return null;
  const v = hh * 60 + mm;
  if (close ? v > 1440 : v >= 1440) return null;
  return v;
}

/** One ';'-separated part: its rules in order ({ days: number[] | null, ph, ranges, off, additional }), or a reason. */
function parsePart(text) {
  const rules = [];
  let rule = null, comma = false;
  const fresh = (additional) => ({ selector: false, days: [], ph: false, ranges: [], off: false, all: false, additional });
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const start = TOKEN.lastIndex;
    const m = TOKEN.exec(text);
    if (!m || m.index !== start) return { reason: 'syntax' };
    if (m[10]) { comma = true; continue; }
    const selector = m[2] || m[4];
    if (m[1]) {
      if (rule) return { reason: 'syntax' };
      rule = fresh(false); rule.all = true; rule.ranges.push([0, 1440]);
      comma = false;
      continue;
    }
    if (selector) {
      if (rule && (rule.ranges.length || rule.off)) {
        // A weekday after a finished rule starts an additional rule, but only after a comma.
        if (!comma) return { reason: 'syntax' };
        rules.push(rule); rule = fresh(true);
      } else if (rule && (rule.days.length || rule.ph) && !comma) return { reason: 'syntax' };
      rule ??= fresh(false);
      rule.selector = true;
      if (m[4]) rule.ph = true;
      else {
        const a = DAYS.indexOf(m[2]), b = m[3] ? DAYS.indexOf(m[3]) : a;
        for (let d = a; ; d = (d + 1) % 7) { rule.days.push(d); if (d === b) break; }
      }
      comma = false;
      continue;
    }
    rule ??= fresh(false);
    if (m[9]) {
      if (rule.ranges.length || rule.all) return { reason: 'syntax' };
      rule.off = true;
    } else {
      if (rule.off || rule.all || (rule.ranges.length && !comma)) return { reason: 'syntax' };
      const open = minutes(m[5], m[6], false), close = minutes(m[7], m[8], true);
      if (open === null || close === null) return { reason: 'time' };
      const end = close === 0 ? 1440 : close;
      if (end === open) return { reason: 'time' };
      rule.ranges.push([open, end]);
    }
    comma = false;
  }
  if (rule) rules.push(rule);
  if (comma || !rules.length) return { reason: 'syntax' };
  for (const r of rules) if (!r.all && !r.ranges.length && !r.off) return { reason: 'selector without a time' };
  return { rules };
}

/** Why a value is outside the subset before it is even tokenised, or null. */
function unsupported(value) {
  if (/["\[\](){}]/.test(value)) return 'comment, nth weekday or group';
  if (/\|\|/.test(value)) return 'fallback rule';
  if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(value)) return 'month or date';
  if (/\b(?:SH|week|easter|sunrise|sunset|dawn|dusk|open|unknown)\b/i.test(value)) return 'variable or open-ended time';
  if (/\+/.test(value)) return 'open end';
  return null;
}

/**
 * `opening_hours` → { days: [[open, close], ...] x 7 (minutes; close <= open runs past midnight) }
 * or { reason } when the value is outside the subset.
 */
export function parseOpeningHours(value) {
  const text = String(value ?? '').trim();
  if (!text) return { reason: 'empty' };
  const early = unsupported(text);
  if (early) return { reason: early };
  const days = Array.from({ length: 7 }, () => null);
  let anyRule = false;
  for (const partText of text.split(';')) {
    if (!partText.trim()) continue;
    const part = parsePart(partText);
    if (part.reason) return { reason: part.reason };
    for (const rule of part.rules) {
      // PH alone is ignored; the PH of "Su,PH off" is dropped from the selector.
      if (rule.selector && !rule.days.length) continue;
      anyRule = true;
      const targets = rule.days.length ? rule.days : [0, 1, 2, 3, 4, 5, 6];
      for (const d of targets) {
        if (rule.off) days[d] = [];
        else if (rule.additional) days[d] = [...(days[d] ?? []), ...rule.ranges];
        else days[d] = [...rule.ranges];
      }
    }
  }
  if (!anyRule) return { reason: 'holiday rules only' };
  return { days: days.map((ranges) => (ranges ?? []).slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])) };
}

const hhmm = (v) => `${String(Math.floor(v / 60)).padStart(2, '0')}${String(v % 60).padStart(2, '0')}`;

/** The week string of osm-hours.json: "HHMM-HHMM,...|..." Monday first. */
export function weekString(days) {
  return days.map((ranges) => ranges.map(([open, close]) => `${hhmm(open)}-${hhmm(close)}`).join(',')).join('|');
}
