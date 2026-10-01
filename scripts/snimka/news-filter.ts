// The press filter of the snimka page (lane S1): pure, no I/O. Input: every
// distinct item (by link) the three outlets' RSS carried; output: the
// relevant pool after de-duplication (what the strip counts per hour) and the
// candidates for the owner's curation (what passes the hourly cap). The page
// publishes only the committed curated list (scripts/snimka/news-curated.json);
// these candidates are the read-through's starting point, never published as
// they are. Titles stay verbatim; the RSS description is read for relevance
// only and never leaves this module.

export type Outlet = 'jutarnji' | 'vecernji' | 'n1';

export interface NewsItem {
  outlet: Outlet;
  /** The title as the feed carried it, entities decoded. */
  title: string;
  link: string;
  pubSec: number;
  /** The feed's own categories (Jutarnji, N1); Večernji carries none. */
  categories: string[];
  /** The RSS description: relevance only, never published. */
  text: string;
}

export interface Candidate {
  id: string;
  outlet: Outlet;
  title: string;
  link: string;
  pubSec: number;
  beat: string | null;
  score: number;
  firstOfBeat: boolean;
  live: boolean;
  /** Links of the near-duplicates merged into this, the earliest, item. */
  merged: string[];
  /** Passes the cap of three per hour, ten minutes apart. */
  selected: boolean;
  reasons: string[];
}

export interface FilterOptions {
  /** Zagreb's offset from UTC over the whole window, seconds. */
  offsetSec?: number;
  /** Near-duplicate titles: Jaccard over title words at or above this ... */
  jaccard?: number;
  /** ... published at most this far apart. */
  duplicateWithinSec?: number;
  perHour?: number;
  spacingSec?: number;
}

const DEFAULTS: Required<FilterOptions> = { offsetSec: 7200, jaccard: 0.6, duplicateWithinSec: 6 * 3600, perHour: 3, spacingSec: 600 };

/** Lowercase ASCII: Croatian diacritics folded, so one pattern matches every spelling. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[čć]/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const STRIKE = /strajk|\bzet\b|\bzet-a\b|sindikat/;
const HOLDING = /holding/;
const TRANSPORT = /tramvaj|autobus|\bbus(evi|eva|om|a)?\b|javn\w* prijevoz|\bprijevoz|bajs|bicikl|nextbike|romobil|taksi|taxi|\buber\b|\bbolt\b|guzv|linij\w* 228|vozac\w* (tramvaj|autobus)/;
/** Zagreb, or what only Zagreb has here: ZET, its trams (Osijek's two lines aside), Rebro, the mayor. */
const ANCHOR = /zagreb|zagrepc|tomasevic|\bzet\b|\bzet-a\b|tramvaj|\brebr|\bkbc\b|jelacic|dubrav|sesvet|novi zagreb/;
/** Not a sport, world or crime story, by the feed's category or the link's path. */
const EXCLUDED = /sport|nogomet|kosark|rukomet|tenis|\batp\b|\bnba\b|euroliga|aba liga|vaterpolo|reprezentacij|hajduk|dinamo|\bhnl\b|liga nacija|svijet|world|regij|crna[ -]kronika|zvijezde|showbiz|lifestyle|horoskop|promo/;
const LIVE = /\buzivo\b|\blive\b|\bblog\b/;

/** Zagreb wall time of the strike week (CEST), epoch seconds. */
const z = (day: number, hh: number, mm = 0): number => Date.UTC(2026, 8, day, hh - 2, mm) / 1000;

interface Beat {
  key: string;
  test: RegExp;
  also?: RegExp;
  from?: number;
  to?: number;
}

/** The beats of the curation, in priority order: an item takes the first that fits. */
export const BEATS: readonly Beat[] = [
  { key: 'najava', test: /strajk/, also: /najav|sutra|ponedjeljak|ponoc|krece|krecu|pocinje|prijeti|kolaps|nece/, to: z(28, 3, 30) },
  { key: 'pocetak', test: /strajk/, also: /pocet|poceo|pocela|pocinje|zapoce|stupil|krenu|prvi dan|jutro|traje|bez tramvaj|bez javnog/, from: z(28, 3, 30), to: z(28, 14) },
  { key: 'jedan-tramvaj', test: /jedan tramvaj|jedini tramvaj|samo jedan|jedini koji|vozi samo|voze samo|kristin|samo (dvije|tri) linij/ },
  { key: 'linija-228', test: /\b228\b|\brebr/ },
  { key: 'sud-privremeno', test: /privremen|zabran/, also: /sud/, to: z(30, 0) },
  { key: 'presuda', test: /nezakonit|presud|proglasi|odluk|odluci|sud/, also: /strajk|zet|holding/, from: z(30, 0) },
  { key: 'povratak', test: /vrac|vratil|vratit|ponovno (vozi|voze|prometuj|na ulic)|kraj strajka|prekid strajka|obustav|zavrsi|normaliz|redovit|punom opsegu/, from: z(30, 11) },
  { key: 'bajs', test: /bajs|bicikl|nextbike|romobil|pedal/ },
  { key: 'taksi', test: /taksi|taxi|\buber\b|\bbolt\b|prijevoznik|dijeljen|cijen\w* voznj/ },
  { key: 'volonteri', test: /volonter|dobrovolj|besplatan prijevoz|besplatno (vozi|prevozi)|do bolnic|do kb|solidarn|pomoc gradanima/ },
  { key: 'skole', test: /skol|ucenic|\bnastav(a|e|u|om)\b|vrtic|student/ },
  { key: 'drugi-dan', test: /strajk/, also: /drugi dan|utorak|nastavlja|i dalje|drugog dana/, from: z(29, 0), to: z(30, 0) },
  { key: 'treci-dan', test: /strajk/, also: /treci dan|srijed|treceg dana|nastavlja|i dalje/, from: z(30, 0), to: z(30, 13) },
  { key: 'holding', test: /holding|cistoc|smece|otpad|odvoz/ },
  { key: 'guzve', test: /guzv|kolon|zastoj|kolaps|promet/ },
  { key: 'pregovori', test: /pregovor|sindikat|tomasevic|gradonacelnik|uprav\w* zet/ },
];

/** The words of a title for the near-duplicate test: folded, three letters or more. */
export function titleWords(title: string): Set<string> {
  return new Set(fold(title).split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

export interface Relevance {
  relevant: boolean;
  score: number;
  reasons: string[];
}

/** Strike or transport words and a Zagreb anchor, outside a sport, world or crime category. */
export function relevance(item: NewsItem): Relevance {
  const title = fold(item.title);
  const all = `${title} ${fold(item.text)}`;
  const where = fold(`${item.categories.join(' ')} ${pathOf(item.link)}`);
  const reasons: string[] = [];
  if (EXCLUDED.test(where)) return { relevant: false, score: 0, reasons: [`excluded: ${where.match(EXCLUDED)![0]}`] };
  const holding = HOLDING.test(all) && /strajk|zagreb/.test(all);
  const strike = STRIKE.test(all) || holding;
  const transport = TRANSPORT.test(all);
  const anchor = ANCHOR.test(all) || holding;
  if (!(strike || transport)) return { relevant: false, score: 0, reasons: ['no strike or transport word'] };
  if (!anchor) return { relevant: false, score: 0, reasons: ['no Zagreb anchor'] };
  let score = 1;
  if (STRIKE.test(title) || HOLDING.test(title)) {
    score += 2;
    reasons.push('strike word in the title');
  }
  if (TRANSPORT.test(title)) {
    score += 1;
    reasons.push('transport word in the title');
  }
  if (ANCHOR.test(title)) {
    score += 1;
    reasons.push('Zagreb in the title');
  }
  return { relevant: true, score, reasons };
}

function pathOf(link: string): string {
  try {
    return new URL(link).pathname.split('/').slice(0, -1).join(' ');
  } catch {
    return '';
  }
}

/** The first beat whose words, and time window, fit the item; null when none does. */
export function beatOf(item: NewsItem): string | null {
  const all = `${fold(item.title)} ${fold(item.text)}`;
  for (const beat of BEATS) {
    if (beat.from !== undefined && item.pubSec < beat.from) continue;
    if (beat.to !== undefined && item.pubSec >= beat.to) continue;
    if (!beat.test.test(all)) continue;
    if (beat.also && !beat.also.test(all)) continue;
    return beat.key;
  }
  return null;
}

export function isLive(item: Pick<NewsItem, 'title'>): boolean {
  return LIVE.test(fold(item.title));
}

/** The Zagreb hour an instant falls in, as epoch seconds of its start. */
export function zagrebHour(sec: number, offsetSec = DEFAULTS.offsetSec): number {
  return Math.floor((sec + offsetSec) / 3600) * 3600 - offsetSec;
}

const zagrebDay = (sec: number, offsetSec: number): number => Math.floor((sec + offsetSec) / 86400);

export interface FilterResult {
  /** Relevant items after near-duplicates and repeated live blogs are merged: the strip's per-hour count. */
  pool: Candidate[];
  /** The pool with beats, first reports and the hourly cap marked (`selected`). */
  candidates: Candidate[];
}

/**
 * Distinct by link, relevant, near-duplicates within six hours merged to the
 * earliest (Jaccard of title words at or above 0.6, across outlets), a live
 * blog kept once per outlet and day, every item given its beat and the first
 * report of each beat marked and preferred, then at most three per Zagreb
 * hour, ten minutes apart, the higher score first.
 */
export function filterNews(items: readonly NewsItem[], options: FilterOptions = {}): FilterResult {
  const o = { ...DEFAULTS, ...options };
  const byLink = new Map<string, NewsItem>();
  for (const item of items) {
    const known = byLink.get(item.link);
    if (!known || item.pubSec < known.pubSec) byLink.set(item.link, item);
  }
  const ordered = [...byLink.values()].sort((a, b) => a.pubSec - b.pubSec || a.link.localeCompare(b.link));

  const pool: (Candidate & { words: Set<string> })[] = [];
  for (const item of ordered) {
    const rel = relevance(item);
    if (!rel.relevant) continue;
    const live = isLive(item);
    if (live) {
      const key = `${item.outlet}|${zagrebDay(item.pubSec, o.offsetSec)}`;
      const first = pool.find((c) => c.live && `${c.outlet}|${zagrebDay(c.pubSec, o.offsetSec)}` === key);
      if (first) {
        first.merged.push(item.link);
        continue;
      }
    }
    const words = titleWords(item.title);
    const twin = pool.find((c) => item.pubSec - c.pubSec <= o.duplicateWithinSec && jaccard(c.words, words) >= o.jaccard);
    if (twin) {
      twin.merged.push(item.link);
      continue;
    }
    pool.push({
      id: `${item.outlet}-${item.pubSec}-${pool.length}`,
      outlet: item.outlet,
      title: item.title,
      link: item.link,
      pubSec: item.pubSec,
      beat: beatOf(item),
      score: rel.score - (live ? 1 : 0),
      firstOfBeat: false,
      live,
      merged: [],
      selected: false,
      reasons: rel.reasons,
      words,
    });
  }
  const beatsSeen = new Set<string>();
  for (const c of pool) {
    if (c.beat === null || beatsSeen.has(c.beat)) continue;
    beatsSeen.add(c.beat);
    c.firstOfBeat = true;
    c.score += 2;
    c.reasons.push(`first report of ${c.beat}`);
  }
  const byPreference = [...pool].sort((a, b) => b.score - a.score || a.pubSec - b.pubSec);
  const perHour = new Map<number, number>();
  const taken: number[] = [];
  for (const c of byPreference) {
    const hour = zagrebHour(c.pubSec, o.offsetSec);
    if ((perHour.get(hour) ?? 0) >= o.perHour) continue;
    if (taken.some((t) => Math.abs(t - c.pubSec) < o.spacingSec)) continue;
    perHour.set(hour, (perHour.get(hour) ?? 0) + 1);
    taken.push(c.pubSec);
    c.selected = true;
  }
  const strip = (c: Candidate & { words: Set<string> }): Candidate => {
    const { words: _words, ...rest } = c;
    return rest;
  };
  const out = pool.map(strip);
  return { pool: out, candidates: out };
}
