// /open/ as HTML: the catalogue for people, with the same facts the JSON-LD
// carries and the standing offer to the City. Zero JS, one inline <style>,
// no external request (page security set, Task D4). The style is generated
// from the app's tokens (scripts/build-hitno-style.mjs); this file paints no
// colour of its own.
import { OPEN_STYLE } from '../hitno/style.generated';
import { escapeHtml } from './html';
import { ARCHIVE_DATASETS, OPEN_DATASETS, OPEN_LICENCE, PUBLISHER, type OpenArchiveDataset, type OpenDataset } from './catalog';
import { formatZagrebDateTime, zagrebParts } from './time';

export function cadenceWords(ttl: number): string {
  if (ttl % 86400 === 0) {
    const d = ttl / 86400;
    return d === 1 ? 'svaki dan' : `svakih ${d} dana`;
  }
  if (ttl % 3600 === 0) {
    const h = ttl / 3600;
    return h === 1 ? 'svaki sat' : `svakih ${h} sati`;
  }
  const m = Math.round(ttl / 60);
  if (m === 1) return 'svaku minutu';
  if (m >= 2 && m <= 4) return `svake ${m} minute`;
  return `svakih ${m} minuta`;
}

/**
 * The registry's attribution strings are templates ({vrijeme}, {datum}, {naziv})
 * filled from a live snapshot where one exists (worker/open/attribution.ts). This
 * page has none, so a clause that exists only to carry a placeholder is left out
 * and no brace reaches a reader; the footer says the times live with each
 * dataset. The DCAT JSON keeps the template verbatim (R-08).
 */
export function staticAttribution(text: string): string {
  return text
    .replace(/\s*[,;]\s*[^,;{}]*\{\w+\}[^,;]*/g, '')
    .replace(/\s*\{\w+\}\s*/g, ' ')
    .trim();
}

/** The footer set every public page shares (/hitno, /open/, the prose pages, /s/): href and label, in this order. */
export const PAGE_LINKS: readonly (readonly [href: string, label: string])[] = [
  ['/hitno', 'Sigurnost'],
  ['/s/', 'Upiši kod'],
  ['/izvori/', 'Izvori'],
  ['/open/', 'Otvoreni podaci'],
  ['/privatnost/', 'Privatnost'],
  ['/pristupacnost/', 'Pristupačnost'],
];

/** The footer set as a labelled nav of 44 px links; the page at `current` is marked for assistive technology. */
export function pageFooter(current: string): string {
  const items = PAGE_LINKS.map(
    ([href, label]) => `<li><a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a></li>`,
  );
  return `<nav aria-label="Stranice"><ul class="foot-links">${items.join('')}</ul></nav>`;
}

function datasetCard(d: OpenDataset): string {
  return (
    `<article id="${escapeHtml(d.module)}">` +
    `<h2>${escapeHtml(d.title)}</h2>` +
    `<p class="meta">Osvježava se ${escapeHtml(cadenceWords(d.ttl))} · ${escapeHtml(d.keywords.join(', '))}</p>` +
    `<p>${escapeHtml(d.description)}</p>` +
    `<ul class="dl">` +
    d.distributions
      .map((x) => `<li><a href="${escapeHtml(x.path)}" type="${escapeHtml(x.mediaType)}">${escapeHtml(x.format)}</a></li>`)
      .join('') +
    `</ul>` +
    `<p class="src">${escapeHtml(staticAttribution(d.source.text))} · ${escapeHtml(d.source.licence)} · ` +
    `<a href="${escapeHtml(d.source.url)}" rel="noopener">izvornik</a>. Objavljeno pod: Otvorena dozvola. Prikaz je prilagodba izvora.</p>` +
    `</article>`
  );
}

/** `27. 9. 2026. u 20:00` for an instant, in Zagreb time. */
function croatianInstant(iso: string): string {
  const p = zagrebParts(new Date(iso));
  return `${Number(p.day)}. ${Number(p.month)}. ${p.year}. u ${p.hour}:${p.minute}`;
}

function distributionName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The "Arhiva" card: a finished dataset published once, with its eight files and its licence line. */
function archiveCard(a: OpenArchiveDataset): string {
  return (
    `<article id="${escapeHtml(a.id)}">` +
    `<h2>${escapeHtml(a.title)}</h2>` +
    `<p class="meta">Arhiva · ${escapeHtml(croatianInstant(a.temporal.start))} do ${escapeHtml(croatianInstant(a.temporal.end))} · objavljeno jednom, ne osvježava se · ${escapeHtml(a.keywords.join(', '))}</p>` +
    `<p>${escapeHtml(a.description)}</p>` +
    `<ul class="dl">` +
    a.distributions
      .map(
        (x) =>
          `<li><a href="${escapeHtml(x.path)}" type="${escapeHtml(x.mediaType)}">${escapeHtml(distributionName(x.path))}</a> (${escapeHtml(x.format)}): ${escapeHtml(x.description)}</li>`,
      )
      .join('') +
    `</ul>` +
    `<p class="src">${escapeHtml(a.provenance)} · Objavljeno pod: Otvorena dozvola, uz navođenje izvora. ` +
    a.sources.map((x) => `<a href="${escapeHtml(x.url)}" rel="noopener">${escapeHtml(x.name)}</a>`).join(' · ') +
    `. Skup je izveden iz izvora i prilagođen; na stranici <a href="/snimka/">Snimka</a> piše kako.</p>` +
    `</article>`
  );
}

export function renderOpenIndex(origin: string, now: Date): string {
  return `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Otvoreni podaci · Kaj ima?</title>
<meta name="description" content="Otvoreni podaci o Zagrebu u Kaj ima?: upozorenja DHMZ-a, potresi, prometnice i zborna mjesta. Izvori, licence i DCAT katalog.">
<style>${OPEN_STYLE}</style>
</head>
<body>
<a class="skip" href="#sadrzaj">Preskoči na sadržaj</a>
<div class="wrap">
<header>
<a class="brand" href="/">Kaj ima<span class="mark">?</span></a>
<h1>Otvoreni podaci</h1>
<p class="lede">Svaki modul otvorene razine objavljen je i kao strojno čitljiv skup: isti podaci, isti izvori, ista atribucija, bez ograničenja trajanja. Iznimka su podaci modula sesijske razine koje javni zaslon prikazuje prije skeniranja, poput vozila, vremena i događanja: ovdje se ne objavljuju. Katalog u obliku DCAT-AP: <a href="/open/catalog.json">catalog.json</a>.</p>
</header>
<main id="sadrzaj">
${OPEN_DATASETS.map(datasetCard).join('\n')}
${ARCHIVE_DATASETS.map(archiveCard).join('\n')}
<aside class="offer" aria-labelledby="h-ponuda">
<h2 id="h-ponuda">Ponuda Gradu Zagrebu</h2>
<p>Svaki skup na ovoj stranici Grad Zagreb može preuzeti i ponovno objaviti na <a href="https://data.zagreb.hr/" rel="noopener">data.zagreb.hr</a> pod Otvorenom dozvolom, bez daljnjeg odobrenja i bez naknade. Katalog <a href="/open/catalog.json">/open/catalog.json</a> dovoljan je za automatsko preuzimanje; izvorni kod koji ga proizvodi objavljen je pod licencom AGPL-3.0-or-later, a Gradu se nudi i pod EUPL-1.2.</p>
</aside>
</main>
<footer class="page">
<p>Izdavač: ${escapeHtml(PUBLISHER.name)} · Licenca: <a href="${escapeHtml(OPEN_LICENCE.url)}" rel="noopener">${escapeHtml(OPEN_LICENCE.title)}</a> · Stanje ${escapeHtml(formatZagrebDateTime(now))}</p>
<p>Sadrži informacije tijela javne vlasti u skladu s Otvorenom dozvolom. Izvorni skupovi i vrijeme zadnje izmjene navedeni su uz svaki skup; ovaj prikaz nije službena objava tijela koja podatke izdaju.</p>
${pageFooter('/open/')}
</footer>
</div>
</body>
</html>
`;
}
