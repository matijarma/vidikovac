// The open safety tier as HTML. Zero JavaScript, one inline <style>, no font,
// no image, no external request: it must work on an old phone with scripts
// off, in a library kiosk browser and on paper, and it is what lets the route
// carry `default-src 'none'` (worker/security-headers.ts, Task D4).
//
// Every value from a feed passes through escapeHtml. Severity, freshness and
// status are always a word plus a shape; colour only reinforces. The style is
// generated from the app's tokens (scripts/build-hitno-style.mjs), so this
// file paints no colour of its own.
import { DISTRICTS, type District } from '../../app/src/kiosk/districts';
import type { FeedItem, Severity } from '../feed/schema';
import { fillAttribution } from '../open/attribution';
import { escapeHtml } from '../open/html';
import { pageFooter } from '../open/index-page';
import { formatZagrebDateTime, formatZagrebTime, parseIso, zagrebDay } from '../open/time';
import { EMERGENCY_NUMBERS, EMERGENCY_NUMBERS_SOURCE } from './brojevi';
import { LJEKARNE, LJEKARNE_CHECKED_ON, LJEKARNE_SOURCE } from './ljekarne';
import { SEVERITY_WORDS, isActiveWarning, type HitnoData, type HitnoPanel } from './select';
import { HITNO_STYLE, PAGE_PALETTE } from './style.generated';

/** "Živo" while the last fetch is younger than this; "Danas" otherwise. */
export const LIVE_WINDOW_MS = 5 * 60 * 1000;
/** Assembly points on the page before the "Prikaži još" fold, when no point names its district (R-K4). */
export const ASSEMBLY_PAGE = 24;
/** Closures on the page before the fold. */
export const CLOSURES_SHOWN = 5;

function timeTag(iso: string | undefined): string {
  const d = parseIso(iso);
  if (d === null) return '<span class="meta">vrijeme nepoznato</span>';
  return `<time datetime="${escapeHtml(d.toISOString())}">${formatZagrebDateTime(d)}</time>`;
}

/** A clock for an instant on the same Zagreb day as `now` ("09:58"); the day-and-clock form otherwise ("9. 9. 08:00"). */
function clockTag(d: Date, now: Date): string {
  const text = zagrebDay(d) === zagrebDay(now) ? formatZagrebTime(d) : formatZagrebDateTime(d);
  return `<time datetime="${escapeHtml(d.toISOString())}">${text}</time>`;
}

/**
 * The freshness line: a shape, a state word, and the time it refers to,
 * named for what it is (R-25). "ažurirano" only for the source's own
 * timestamp; "dohvaćeno" when only our fetch time exists; "zastarjelo od"
 * from the moment the live fetch first failed.
 */
function freshness(panel: HitnoPanel, now: Date): string {
  const s = panel.snapshot;
  if (s === null || panel.state === 'unavailable') {
    return `<p class="status down"><span class="dot" aria-hidden="true">○</span> <span>Izvor trenutačno nedostupan.</span></p>`;
  }
  const fetched = parseIso(panel.availability?.fetchedAt ?? s.fetchedAt);
  if (panel.state === 'stale') {
    const since = parseIso(s.staleSince);
    const lastGood = `posljednji uspješan dohvat ${fetched === null ? 'nepoznat' : clockTag(fetched, now)}`;
    const text = since === null ? `Zastarjelo: ${lastGood}.` : `Zastarjelo od ${clockTag(since, now)}, ${lastGood}.`;
    return `<p class="status stale"><span class="dot" aria-hidden="true">◐</span> <span>${text}</span></p>`;
  }
  const live = fetched !== null && now.getTime() - fetched.getTime() < LIVE_WINDOW_MS;
  const source = parseIso(panel.availability?.sourceUpdatedAt);
  // The state word describes the copy: "Živo" within five minutes of the fetch,
  // "Danas" when the time shown is today, neutral when the source's own time
  // is from another day (so "Danas: ažurirano 2. 1." can never be printed).
  const shown = source ?? fetched;
  const today = shown !== null && zagrebDay(shown) === zagrebDay(now);
  const word = live ? 'Živo' : today ? 'Danas' : 'Stanje';
  const when = source !== null
    ? `ažurirano ${clockTag(source, now)}`
    : fetched !== null
      ? `dohvaćeno ${clockTag(fetched, now)}`
      : 'vrijeme nepoznato';
  return `<p class="status live"><span class="dot" aria-hidden="true">●</span> <span>${word}: ${when}.</span></p>`;
}

/** `panel`'s attribution text may be an R-08 template; it is filled from the
 *  panel's own snapshot and its first (most relevant) item before it ever
 *  reaches this page (R-62). */
function sourceLine(panel: HitnoPanel, download: string | null): string {
  const { snapshot } = panel;
  if (snapshot === null) return '';
  const { attribution } = snapshot;
  const text = fillAttribution(attribution, snapshot, panel.items[0]);
  const dl = download === null ? '' : ` · <a href="${escapeHtml(download)}">podaci (JSON)</a>`;
  return (
    `<footer class="src"><p>${escapeHtml(text)} · ${escapeHtml(attribution.licence)} · ` +
    `<a class="ext" href="${escapeHtml(attribution.url)}" rel="noopener">izvornik</a>${dl}</p></footer>`
  );
}

function osmLink(item: FeedItem): string {
  if (!item.geo || item.geo.type !== 'Point') return '';
  const [lon, lat] = item.geo.coordinates as number[];
  if (typeof lat !== 'number' || typeof lon !== 'number') return '';
  const href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
  return `<a class="ext" href="${escapeHtml(href)}" rel="noopener">karta</a>`;
}

/** The second line of a row: its non-empty parts separated by a middle dot, nothing when there are none. */
function metaLine(parts: readonly string[]): string {
  const shown = parts.filter((p) => p !== '');
  return shown.length === 0 ? '' : `<div class="meta">${shown.join(' · ')}</div>`;
}

/**
 * A `severity` this far has already been through `FeedItem`'s type, but that
 * is a compile-time promise only: a bug in Area A's CAP-severity mapping, an
 * unmapped CAP severity string, or a future field could hand this a value
 * outside the closed 5-word vocabulary. That value is about to become part
 * of an HTML class attribute (`sev-${sev}`), so it is normalised against the
 * one true list of valid keys, `SEVERITY_WORDS`, and anything not on that
 * list becomes 'info' before it ever reaches markup. This is stronger than
 * escaping: an unrecognised value can't reach the page in any form, not even
 * escaped.
 */
function safeSeverity(sev: string): Severity {
  return Object.prototype.hasOwnProperty.call(SEVERITY_WORDS, sev) ? (sev as Severity) : 'info';
}

function section(id: string, heading: string, body: string, badge = ''): string {
  return (
    `<section id="${id}" aria-labelledby="h-${id}">` +
    `<h2 id="h-${id}">${heading}${badge}</h2>${body}</section>`
  );
}

/** The rest of a list behind a closed `<details>`, or nothing when it all fits. */
function fold(summary: string, rows: readonly string[]): string {
  return rows.length === 0 ? '' : `<details><summary>${summary}</summary><ul class="items">${rows.join('')}</ul></details>`;
}

function warningsSection(panel: HitnoPanel, now: Date): string {
  let list: string;
  if (panel.items.length === 0) {
    list = `<p class="empty">${panel.state === 'empty'
      ? 'Trenutačno nema upozorenja DHMZ-a za Zagrebačku regiju.'
      : 'Stanje upozorenja nije potvrđeno. Provjeri službeni izvor DHMZ-a.'}</p>`;
  } else {
    list =
      `<ul class="items">` +
      panel.items
        .map((w) => {
          const sev = safeSeverity(w.severity ?? 'info');
          const state = isActiveWarning(w, now) ? 'na snazi' : 'najavljeno';
          return (
            `<li><span class="sev sev-${sev}">${SEVERITY_WORDS[sev]}</span>` +
            `<span class="title">${escapeHtml(w.title)}</span>` +
            `<div class="meta">${state} · od ${timeTag(w.at)} do ${timeTag(w.until)}</div>` +
            (w.summary ? `<p>${escapeHtml(w.summary)}</p>` : '') +
            `</li>`
          );
        })
        .join('') +
      `</ul>`;
  }
  return section(
    'upozorenja',
    'Upozorenja DHMZ-a',
    freshness(panel, now) + list + sourceLine(panel, '/open/dhmz-cap.json'),
  );
}

function quakesSection(panel: HitnoPanel, now: Date): string {
  let list: string;
  if (panel.items.length === 0) {
    list = `<p class="empty">${panel.state === 'empty'
      ? 'U posljednja 72 sata EMSC nije zabilježio potres u okolici Zagreba.'
      : 'Podaci o potresima trenutačno nisu potvrđeni. Provjeri EMSC.'}</p>`;
  } else {
    list =
      `<ul class="items">` +
      panel.items
        .map(
          (q) =>
            `<li><span class="title">${escapeHtml(q.title)}</span>` +
            metaLine([
              timeTag(q.at),
              osmLink(q),
              q.link ? `<a class="ext" href="${escapeHtml(q.link)}" rel="noopener">EMSC</a>` : '',
            ]) +
            (q.summary ? `<p>${escapeHtml(q.summary)}</p>` : '') +
            `</li>`,
        )
        .join('') +
      `</ul>`;
  }
  return section(
    'potresi',
    'Potresi u posljednja 72 sata',
    freshness(panel, now) + list + sourceLine(panel, '/open/emsc.json'),
  );
}

function closuresSection(panel: HitnoPanel, now: Date): string {
  let list: string;
  if (panel.items.length === 0) {
    list = `<p class="empty">${panel.state === 'empty'
      ? 'Nema zatvorenih prometnica.'
      : 'Stanje prometnica nije potvrđeno. Provjeri službeni izvor.'}</p>`;
  } else {
    const rows = panel.items.map((c) =>
      `<li><span class="title">${escapeHtml(c.title)}</span>` +
      (c.summary ? `<div>${escapeHtml(c.summary)}</div>` : '') +
      `<div class="meta">od ${timeTag(c.at)} · ${c.until ? `očekivano otvaranje ${timeTag(c.until)}` : 'kraj nije najavljen'}</div>` +
      `</li>`);
    list =
      `<ul class="items">${rows.slice(0, CLOSURES_SHOWN).join('')}</ul>` +
      fold(`Prikaži preostala zatvaranja (${rows.length - CLOSURES_SHOWN})`, rows.slice(CLOSURES_SHOWN));
  }
  return section(
    'prometnice',
    'Zatvorene prometnice',
    freshness(panel, now) + list + sourceLine(panel, '/open/prometnice.geojson'),
  );
}

// --- Assembly points, grouped by gradska četvrt ------------------------------

/** "mjesto" after a count ending in 1 (not 11), "mjesta" otherwise. */
function places(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'mjesto' : 'mjesta';
}

/** "je" or "su": the verb agrees with the paucal (2 to 4, not 12 to 14). */
function verbFor(n: number): string {
  const paucal = n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14);
  return paucal ? 'su' : 'je';
}

/** A district as a key: case, diacritics and the dash between its halves do not count ("Gornji Grad-Medveščak" is "Gornji grad – Medveščak"). */
function districtKey(value: string): string {
  return value
    .toLocaleLowerCase('hr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-\u2013\u2014]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const KNOWN_DISTRICTS = new Map<string, District>(DISTRICTS.map((d) => [districtKey(d.name), d]));
const NO_DISTRICT = 'Četvrt nije navedena';

function districtOf(p: FeedItem): string {
  const value = p.data?.district;
  return typeof value === 'string' ? value.trim() : '';
}

interface DistrictGroup {
  label: string;
  order: number;
  points: FeedItem[];
}

/** Groups in the order of kiosk/districts.ts; a district the table does not know follows in first-seen order; points without one come last. */
function groupByDistrict(points: readonly FeedItem[]): DistrictGroup[] {
  const groups = new Map<string, DistrictGroup>();
  let unknownOrder = DISTRICTS.length;
  for (const p of points) {
    const raw = districtOf(p);
    const known = raw ? KNOWN_DISTRICTS.get(districtKey(raw)) : undefined;
    const key = known ? known.slug : raw ? districtKey(raw) : '';
    let group = groups.get(key);
    if (!group) {
      group = known
        ? { label: known.name, order: DISTRICTS.indexOf(known), points: [] }
        : raw
          ? { label: raw, order: unknownOrder++, points: [] }
          : { label: NO_DISTRICT, order: Number.MAX_SAFE_INTEGER, points: [] };
      groups.set(key, group);
    }
    group.points.push(p);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

function assemblyRow(p: FeedItem): string {
  return (
    `<li><span class="title">${escapeHtml(p.title)}</span>` +
    metaLine([p.summary ? escapeHtml(p.summary) : '', osmLink(p)]) +
    `</li>`
  );
}

/** One closed `<details>` per district: its name and count on a 44 px summary, its rows inside. */
function districtGroup(g: DistrictGroup): string {
  return (
    `<details class="district"><summary>${escapeHtml(g.label)} ` +
    `<span class="count">· ${g.points.length} ${places(g.points.length)}</span></summary>` +
    `<ul class="items">${g.points.map(assemblyRow).join('')}</ul></details>`
  );
}

function assemblySection(panel: HitnoPanel, now: Date): string {
  let body: string;
  if (panel.items.length === 0) {
    body = `<p class="empty">Popis zbornih mjesta trenutačno nije dostupan.</p>`;
  } else {
    // The register's true size is the assembly source's own total (the number
    // before its cap). The module's coverage.total cannot serve here: ckan-geo
    // serves two layers in one module, so it counts the districts too.
    const total = panel.availability?.totalItems ?? panel.items.length;
    const intro =
      `<p>Zborna mjesta su mjesta okupljanja građana nakon velike nesreće ili potresa. ` +
      `Na popisu ${verbFor(total)} <b>${total}</b> ${places(total)} u Gradu Zagrebu.</p>`;
    let list: string;
    if (panel.items.some((p) => districtOf(p) !== '')) {
      list = `<div class="districts">${groupByDistrict(panel.items).map(districtGroup).join('')}</div>`;
    } else {
      const rows = panel.items.map(assemblyRow);
      list =
        `<ul class="items">${rows.slice(0, ASSEMBLY_PAGE).join('')}</ul>` +
        fold(`Prikaži još (${rows.length - ASSEMBLY_PAGE})`, rows.slice(ASSEMBLY_PAGE));
    }
    body = intro + list;
  }
  return section(
    'zborna-mjesta',
    'Zborna mjesta civilne zaštite',
    freshness(panel, now) + body + sourceLine(panel, '/open/ckan-geo.json'),
  );
}

function pharmaciesSection(): string {
  const rows = LJEKARNE.map(
    (p) =>
      `<li><h3>${escapeHtml(p.label)}</h3>` +
      `<p>${escapeHtml(p.address)}</p>` +
      `<p class="meta">${escapeHtml(p.hours)}</p><p class="meta">${escapeHtml(p.operator)}</p>` +
      `${p.phoneE164 && p.phoneDisplay ? `<a class="pharmacy-call" href="tel:${escapeHtml(p.phoneE164)}">Nazovi ${escapeHtml(p.phoneDisplay)}</a>` : '<p class="meta">Telefon nije naveden u izvoru.</p>'}</li>`,
  ).join('');
  const checked = parseIso(`${LJEKARNE_CHECKED_ON}T12:00:00Z`);
  const checkedText = checked === null ? LJEKARNE_CHECKED_ON : formatZagrebDateTime(checked).replace(/ \d\d:\d\d$/, '');
  return section(
    'ljekarne',
    'Dežurne ljekarne',
    `<p class="status"><span aria-hidden="true">▣</span> <span>Ručno održavan popis, provjeren ${escapeHtml(checkedText)} ` +
      `prema stranici Grada Zagreba. Prije puta provjeri na izvorniku ili nazovi ljekarnu.</span></p>` +
      `<ul class="pharmacies">${rows}</ul>` +
      `<footer class="src"><p>${escapeHtml(LJEKARNE_SOURCE.text)} · ` +
      `<a class="ext" href="${escapeHtml(LJEKARNE_SOURCE.url)}" rel="noopener">izvornik</a></p></footer>`,
    ` <span class="check">provjeriti</span>`,
  );
}

function numbersSection(): string {
  return section(
    'brojevi',
    'Brojevi za hitne slučajeve',
    `<ul class="numbers">` +
      EMERGENCY_NUMBERS.map(
        (n) =>
          `<li><a href="tel:${escapeHtml(n.number)}"><b>${escapeHtml(n.number)}</b>` +
          `<span>${escapeHtml(n.label)}</span></a></li>`,
      ).join('') +
      `</ul>` +
      `<footer class="src"><p>${escapeHtml(EMERGENCY_NUMBERS_SOURCE.text)} · ` +
      `<a class="ext" href="${escapeHtml(EMERGENCY_NUMBERS_SOURCE.url)}" rel="noopener">izvornik</a></p></footer>`,
  );
}

export function renderHitnoPage(data: HitnoData, now: Date): string {
  const stamp = `${formatZagrebDateTime(now)} (${now.getUTCFullYear()}.)`;
  return `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Sigurnost · Kaj ima?</title>
<meta name="description" content="Sigurnosne informacije za Zagreb: upozorenja DHMZ-a, potresi, zatvorene prometnice, zborna mjesta civilne zaštite, dežurne ljekarne i brojevi za hitne slučajeve. Otvoreno svima, bez skeniranja.">
<style>${HITNO_STYLE}</style>
</head>
<body>
<a class="skip" href="#brojevi">Preskoči na brojeve za hitne slučajeve</a>
<div class="wrap">
<header>
<a class="brand" href="/">Kaj ima<span class="mark">?</span></a>
<h1>Sigurnost</h1>
<p class="lede">Hitni brojevi, upozorenja i pomoć u Zagrebu. Radi bez skeniranja.</p>
<p class="stamp">Stanje <time datetime="${escapeHtml(now.toISOString())}">${escapeHtml(stamp)}</time>, vrijeme Zagreb. <a href="/hitno">Osvježi stanje</a></p>
</header>
<nav class="toc" aria-label="Sadržaj"><ul>
<li><a href="#brojevi">Brojevi</a></li>
<li><a href="#upozorenja">Upozorenja</a></li>
<li><a href="#potresi">Potresi</a></li>
<li><a href="#prometnice">Prometnice</a></li>
<li><a href="#zborna-mjesta">Zborna mjesta</a></li>
<li><a href="#ljekarne">Ljekarne</a></li>
</ul></nav>
<main>
${numbersSection()}
${warningsSection(data.warnings, now)}
<div class="safety-columns"><div>
${closuresSection(data.closures, now)}
${quakesSection(data.quakes, now)}
</div><div>
${pharmaciesSection()}
${assemblySection(data.assembly, now)}
</div></div>
</main>
<footer class="page">
<p>Sadrži informacije tijela javne vlasti u skladu s Otvorenom dozvolom. Prikaz je prilagodba izvora; izvorni podaci i vrijeme zadnje izmjene navedeni su uz svaki panel. Ova stranica ne predstavlja službenu obavijest ni tijela koja podatke objavljuju.</p>
${pageFooter('/hitno')}
</footer>
</div>
</body>
</html>
`;
}

/** 429 for the open tier: a person, not a client library, reads this. */
export function renderTooManyRequests(): Response {
  const html = `<!doctype html>
<html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark light">
<title>Previše zahtjeva · Sigurnost</title>
<style>${PAGE_PALETTE}body{margin:0;padding:3rem 1.25rem;font:1.125rem/1.5 var(--font);background:var(--canvas);color:var(--ink)}main{max-width:36rem;margin:0 auto}a{color:var(--accent)}</style></head>
<body><main><h1>Previše zahtjeva</h1><p>S ove mreže stiglo je više od 120 zahtjeva u minuti. Pokušaj ponovno za minutu.</p>
<p>U hitnom slučaju nazovi <a href="tel:112">112</a>.</p></main></body></html>
`;
  return new Response(html, {
    status: 429,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-language': 'hr',
      'cache-control': 'no-store',
      'retry-after': '60',
    },
  });
}
