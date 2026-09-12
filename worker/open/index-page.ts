// /open/ as HTML: the catalogue for people, with the same facts the JSON-LD
// carries and the standing offer to the City. Zero JS, one inline <style>,
// no external request (page security set, Task D4).
import { escapeHtml } from './html';
import { OPEN_DATASETS, OPEN_LICENCE, PUBLISHER, type OpenDataset } from './catalog';
import { formatZagrebDateTime } from './time';

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

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f8f7;--fg:#182423;--muted:#526461;--accent:#08777b;--line:#d6e1de;--card:#fcfdfc}
@media (prefers-color-scheme:dark){:root{--bg:#17201f;--fg:#eff6f3;--muted:#acbdb6;--accent:#63d7c3;--line:#3b4b45;--card:#202d29}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);font:1.125rem/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:64rem;margin:0 auto;padding:2rem 1.5rem 4rem}
.brand{display:inline-block;margin-bottom:1.75rem;font-size:1.35rem;font-weight:800;letter-spacing:-.06em;text-decoration:none;color:var(--fg)}
h1{font-size:clamp(2rem,6vw,3rem);line-height:1.05;margin:.4rem 0 .5rem;letter-spacing:-.02em}
.lede{margin:0 0 1.5rem}
article{margin:0;padding:2rem 0;border-top:1px solid var(--line)}
h2{margin:0 0 .35rem;font-size:1.35rem;line-height:1.25}
.meta{color:var(--muted);font-size:1rem;margin:0 0 .5rem}
ul.dl{list-style:none;padding:0;margin:.5rem 0 0;display:flex;flex-wrap:wrap;gap:.5rem}
ul.dl a{display:inline-flex;align-items:center;min-height:44px;padding:.45rem 1rem;border:1px solid var(--line);border-radius:9px;text-decoration:none;font-weight:650}
a:focus-visible{outline:3px solid var(--accent);outline-offset:4px}
.src{margin:1rem 0 0;padding-top:.5rem;color:var(--muted);font-size:.8rem}
.offer{margin:2rem 0;padding:1.5rem;border:1px solid var(--line);border-radius:16px;background:var(--card)}
footer{color:var(--muted);font-size:.95rem}
`;

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
    `<p class="src">${escapeHtml(d.source.text)} · ${escapeHtml(d.source.licence)} · ` +
    `<a href="${escapeHtml(d.source.url)}" rel="noopener">izvornik</a>. Objavljeno pod: Otvorena dozvola. Prikaz je prilagodba izvora.</p>` +
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
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
<a class="brand" href="/">Kaj ima?</a>
<h1>Otvoreni podaci</h1>
<p class="lede">Svaki modul otvorene razine objavljen je i kao strojno čitljiv skup: isti podaci, isti izvori, ista atribucija, bez ograničenja trajanja. Iznimka je kartica "Grad javlja" na javnom zaslonu prije skeniranja: dolazi iz modula sesijske razine i ovdje se ne objavljuje. Katalog u obliku DCAT-AP: <a href="/open/catalog.json">catalog.json</a>.</p>
</header>
<main>
${OPEN_DATASETS.map(datasetCard).join('\n')}
<aside class="offer" aria-labelledby="h-ponuda">
<h2 id="h-ponuda">Ponuda Gradu Zagrebu</h2>
<p>Svaki skup na ovoj stranici Grad Zagreb može preuzeti i ponovno objaviti na <a href="https://data.zagreb.hr/" rel="noopener">data.zagreb.hr</a> pod Otvorenom dozvolom, bez daljnjeg odobrenja i bez naknade. Katalog <a href="/open/catalog.json">/open/catalog.json</a> dovoljan je za automatsko preuzimanje; izvorni kod koji ga proizvodi objavljen je pod licencom AGPL-3.0-or-later, a Gradu se nudi i pod EUPL-1.2.</p>
</aside>
</main>
<footer>
<p>Izdavač: ${escapeHtml(PUBLISHER.name)} · Licenca: <a href="${escapeHtml(OPEN_LICENCE.url)}" rel="noopener">${escapeHtml(OPEN_LICENCE.title)}</a> · Stanje ${escapeHtml(formatZagrebDateTime(now))}</p>
<p>Sadrži informacije tijela javne vlasti u skladu s Otvorenom dozvolom. Izvorni skupovi i vrijeme zadnje izmjene navedeni su uz svaki skup; ovaj prikaz nije službena objava tijela koja podatke izdaju.</p>
<p><a href="/hitno">Hitno</a> · <a href="/izvori/">Izvori i licence</a> · <a href="/privatnost/">Privatnost</a></p>
</footer>
</div>
</body>
</html>
`;
}
