// The open safety tier as HTML. Zero JavaScript, one inline <style>, no font,
// no image, no external request: it must work on an old phone with scripts
// off, in a library kiosk browser and on paper, and it is what lets the route
// carry `default-src 'none'` (worker/security-headers.ts, Task D4).
//
// Every value from a feed passes through escapeHtml. Severity, freshness and
// status are always a word plus a shape; colour only reinforces.
import type { FeedItem, Severity } from '../feed/schema';
import { fillAttribution } from '../open/attribution';
import { escapeHtml } from '../open/html';
import { formatZagrebDateTime, formatZagrebTime, parseIso } from '../open/time';
import { EMERGENCY_NUMBERS, EMERGENCY_NUMBERS_SOURCE } from './brojevi';
import { LJEKARNE, LJEKARNE_CHECKED_ON, LJEKARNE_SOURCE } from './ljekarne';
import { SEVERITY_WORDS, isActiveWarning, type HitnoData, type HitnoPanel } from './select';

/** "Živo" while the last fetch is younger than this; "Danas" otherwise. */
export const LIVE_WINDOW_MS = 5 * 60 * 1000;

const STYLE = `
:root{color-scheme:dark light;--bg:#16226b;--fg:#f2ead8;--muted:#c3cdf5;--accent:#9db4ff;
--line:rgba(242,234,216,.22);--card:#0f1a52;--amber:#f2c078;--red:#ff9d9d;--ok:#7fd6a8}
@media (prefers-color-scheme:light){:root{--bg:#f2ead8;--fg:#16226b;--muted:#4553a8;
--accent:#3a49b0;--line:rgba(22,34,107,.24);--card:#faf5e9;--amber:#8a5800;--red:#b3271e;--ok:#1e6f47}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);
font:1.125rem/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:46rem;margin:0 auto;padding:1.25rem 1.25rem 4rem}
.skip{position:absolute;left:-999px}.skip:focus{left:1rem;top:1rem;background:var(--card);padding:.5rem}
header .brand{display:inline-block;font-weight:600;letter-spacing:.02em;text-decoration:none;color:var(--muted)}
h1{font-size:clamp(2rem,6vw,3rem);line-height:1.05;margin:.4rem 0 .5rem;letter-spacing:-.02em}
.lede{margin:0 0 .5rem;font-size:1.125rem}
.stamp{color:var(--muted);margin:0 0 1.25rem}
nav.toc ul{display:flex;flex-wrap:wrap;gap:.5rem 1rem;list-style:none;margin:0 0 1.5rem;padding:0}
nav.toc a{text-decoration:none;border-bottom:1px solid var(--line)}
section{margin:0 0 2rem;padding:1rem 1.1rem;border:1px solid var(--line);border-radius:14px;background:var(--card)}
h2{margin:0 0 .35rem;font-size:1.5rem;line-height:1.2;display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap}
.check{font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;
color:var(--amber);border:1px solid currentColor;border-radius:999px;padding:.05rem .5rem}
.status{margin:0 0 .75rem;color:var(--muted);font-size:1rem}
.status.stale .dot{color:var(--amber)}.status.down .dot{color:var(--red)}.status.live .dot{color:var(--ok)}
ul.items{list-style:none;margin:0;padding:0}
ul.items>li{padding:.7rem 0;border-top:1px solid var(--line)}
ul.items>li:first-child{border-top:0}
.title{font-weight:600}
.meta{color:var(--muted);font-size:1rem}
.sev{display:inline-block;font-weight:600;text-transform:uppercase;letter-spacing:.06em;font-size:.8rem;
border-radius:999px;padding:.1rem .6rem;border:1px solid currentColor;margin-right:.4rem}
.sev-moderate,.sev-minor{color:var(--amber)}.sev-severe,.sev-extreme{color:var(--red)}
.sev-info{color:var(--muted)}
.empty{margin:.25rem 0;color:var(--muted)}
.src{margin-top:.75rem;padding-top:.5rem;border-top:1px dashed var(--line);color:var(--muted);font-size:.95rem}
.src p{margin:0}
table{width:100%;border-collapse:collapse;font-size:1rem}
th,td{text-align:left;vertical-align:top;padding:.45rem .4rem;border-top:1px solid var(--line)}
th{font-weight:600}
thead th{border-top:0;color:var(--muted);font-size:.85rem;text-transform:uppercase;letter-spacing:.06em}
.numbers{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.6rem;list-style:none;margin:0;padding:0}
.numbers a{display:block;text-decoration:none;border:1px solid var(--line);border-radius:12px;padding:.6rem .8rem;color:var(--fg)}
.numbers b{display:block;font-size:1.75rem;line-height:1.1;letter-spacing:-.01em}
.numbers span{color:var(--muted);font-size:.95rem}
details summary{cursor:pointer;font-weight:600;padding:.3rem 0}
footer.page{color:var(--muted);font-size:.95rem}
@media (max-width:480px){.wrap{padding:1rem .9rem 3rem}section{padding:.9rem .85rem}}
@media print{html,body{background:#fff;color:#000;font-size:11pt}section{border-color:#999;background:#fff;break-inside:avoid}
nav.toc,.skip{display:none}a{color:#000}.src a[href]::after,.numbers a[href]::after{content:""}
a.ext[href]::after{content:" (" attr(href) ")";font-size:.8em;color:#555}}
`;

function timeTag(iso: string | undefined): string {
  const d = parseIso(iso);
  if (d === null) return '<span class="meta">vrijeme nepoznato</span>';
  return `<time datetime="${escapeHtml(d.toISOString())}">${formatZagrebDateTime(d)}</time>`;
}

function freshness(panel: HitnoPanel, now: Date): string {
  const s = panel.snapshot;
  if (s === null || s.status === 'down') {
    return `<p class="status down"><span class="dot" aria-hidden="true">○</span> Izvor trenutačno nedostupan.</p>`;
  }
  if (s.status === 'stale') {
    return (
      `<p class="status stale"><span class="dot" aria-hidden="true">◐</span> Zastarjelo: ` +
      `posljednji uspješan dohvat ${timeTag(s.fetchedAt)}.</p>`
    );
  }
  const fetched = parseIso(s.fetchedAt);
  const live = fetched !== null && now.getTime() - fetched.getTime() < LIVE_WINDOW_MS;
  return (
    `<p class="status live"><span class="dot" aria-hidden="true">●</span> ${live ? 'Živo' : 'Danas'}: ` +
    `ažurirano ${fetched === null ? 'nepoznato' : formatZagrebTime(fetched)}.</p>`
  );
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
  return ` · <a class="ext" href="${escapeHtml(href)}" rel="noopener">karta</a>`;
}

/**
 * A `severity` this far has already been through `FeedItem`'s type, but that
 * is a compile-time promise only: a bug in Area A's CAP-severity mapping, an
 * unmapped CAP severity string, or a future field could hand this a value
 * outside the closed 5-word vocabulary. That value is about to become part
 * of an HTML class attribute (`sev-${sev}`), so it is normalised against the
 * one true list of valid keys — `SEVERITY_WORDS` — and anything not on that
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

function warningsSection(panel: HitnoPanel, now: Date): string {
  let list: string;
  if (panel.items.length === 0) {
    list = `<p class="empty">Trenutačno nema upozorenja DHMZ-a za Zagrebačku regiju.</p>`;
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
    list = `<p class="empty">U posljednja 72 sata EMSC nije zabilježio potres u okolici Zagreba.</p>`;
  } else {
    list =
      `<ul class="items">` +
      panel.items
        .map(
          (q) =>
            `<li><span class="title">${escapeHtml(q.title)}</span>` +
            `<div class="meta">${timeTag(q.at)}${osmLink(q)}` +
            (q.link ? ` · <a class="ext" href="${escapeHtml(q.link)}" rel="noopener">EMSC</a>` : '') +
            `</div>` +
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
    list = `<p class="empty">Nema aktivnih zatvaranja.</p>`;
  } else {
    list =
      `<ul class="items">` +
      panel.items
        .map(
          (c) =>
            `<li><span class="title">${escapeHtml(c.title)}</span>` +
            (c.summary ? `<div>${escapeHtml(c.summary)}</div>` : '') +
            `<div class="meta">od ${timeTag(c.at)} · ${c.until ? `očekivano otvaranje ${timeTag(c.until)}` : 'kraj nije najavljen'}</div>` +
            `</li>`,
        )
        .join('') +
      `</ul>`;
  }
  return section(
    'prometnice',
    'Zatvorene prometnice',
    freshness(panel, now) +
      list +
      sourceLine(panel, '/open/prometnice.geojson'),
  );
}

function assemblySection(panel: HitnoPanel, now: Date): string {
  let body: string;
  if (panel.items.length === 0) {
    body = `<p class="empty">Popis zbornih mjesta trenutačno nije dostupan.</p>`;
  } else {
    body =
      `<p>Zborna mjesta su mjesta okupljanja građana nakon velike nesreće ili potresa. ` +
      `Na popisu je <b>${panel.items.length}</b> mjesta u Gradu Zagrebu.</p>` +
      `<details><summary>Prikaži sva zborna mjesta</summary><ul class="items">` +
      panel.items
        .map(
          (p) =>
            `<li><span class="title">${escapeHtml(p.title)}</span>` +
            `<div class="meta">${p.summary ? escapeHtml(p.summary) : ''}${osmLink(p)}</div></li>`,
        )
        .join('') +
      `</ul></details>`;
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
      `<tr><th scope="row">${escapeHtml(p.label)}</th>` +
      `<td>${escapeHtml(p.address)}</td>` +
      `<td>${p.phoneE164 && p.phoneDisplay ? `<a href="tel:${escapeHtml(p.phoneE164)}">${escapeHtml(p.phoneDisplay)}</a>` : '<span class="meta">nije naveden</span>'}</td>` +
      `<td>${escapeHtml(p.hours)}<div class="meta">${escapeHtml(p.operator)}</div></td></tr>`,
  ).join('');
  const checked = parseIso(`${LJEKARNE_CHECKED_ON}T12:00:00Z`);
  const checkedText = checked === null ? LJEKARNE_CHECKED_ON : formatZagrebDateTime(checked).replace(/ \d\d:\d\d$/, '');
  return section(
    'ljekarne',
    'Dežurne ljekarne',
    `<p class="status"><span aria-hidden="true">▣</span> Ručno održavan popis, provjeren ${escapeHtml(checkedText)} ` +
      `prema stranici Grada Zagreba. Prije puta provjeri na izvorniku ili nazovi ljekarnu.</p>` +
      `<table><thead><tr><th scope="col">Ljekarna</th><th scope="col">Adresa</th>` +
      `<th scope="col">Telefon</th><th scope="col">Radno vrijeme</th></tr></thead><tbody>${rows}</tbody></table>` +
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
<title>Hitno · Zagreb</title>
<meta name="description" content="Sigurnosne informacije za Zagreb: upozorenja DHMZ-a, potresi, zatvorene prometnice, zborna mjesta civilne zaštite, dežurne ljekarne i brojevi za hitne slučajeve. Otvoreno svima, bez skeniranja.">
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#brojevi">Preskoči na brojeve za hitne slučajeve</a>
<div class="wrap">
<header>
<a class="brand" href="/">Vidikovac</a>
<h1>Hitno</h1>
<p class="lede">Sigurnosne informacije za Zagreb. Otvoreno svima, bez skeniranja i bez vremenskog ograničenja. Radi i bez JavaScripta; može se ispisati.</p>
<p class="stamp">Stanje <time datetime="${escapeHtml(now.toISOString())}">${escapeHtml(stamp)}</time>, vrijeme Zagreb. Stranica se osvježava svake minute.</p>
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
${quakesSection(data.quakes, now)}
${closuresSection(data.closures, now)}
${assemblySection(data.assembly, now)}
${pharmaciesSection()}
</main>
<footer class="page">
<p>Sadrži informacije tijela javne vlasti u skladu s Otvorenom dozvolom. Prikaz je prilagodba izvora; izvorni podaci i vrijeme zadnje izmjene navedeni su uz svaki panel. Ova stranica ne predstavlja službenu obavijest ni tijela koja podatke objavljuju.</p>
<p><a href="/open/">Otvoreni podaci</a> · <a href="/izvori/">Izvori i licence</a> · <a href="/privatnost/">Privatnost</a> · <a href="/pristupacnost/">Pristupačnost</a></p>
</footer>
</div>
</body>
</html>
`;
}

/** 429 for the open tier: a person, not a client library, reads this. */
export function renderTooManyRequests(): Response {
  const html = `<!doctype html>
<html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Previše zahtjeva · Hitno</title>
<style>body{margin:0;padding:3rem 1.25rem;font:1.125rem/1.5 system-ui,sans-serif;background:#16226b;color:#f2ead8}
@media (prefers-color-scheme:light){body{background:#f2ead8;color:#16226b}}main{max-width:36rem;margin:0 auto}</style></head>
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
