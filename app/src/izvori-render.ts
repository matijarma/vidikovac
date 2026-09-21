// /izvori is built at build time from this JSON (vite.config.ts calls
// renderIzvoriHtml in transformIndexHtml), so the attribution page is readable
// with JavaScript switched off and cannot drift from the data the panels use.
import data from './data/izvori.json';
import { escapeAttribute, escapeHtml } from './ui/dom/escape';
import {REFERENCE_SOURCES,LIVE_SOURCES} from '../../worker/city/sources';

export interface IzvorEntry {
  module: string;
  naziv: string;
  tier: string;
  url: string;
  text: string;
  licence: string;
}

/** One `data.source` value the dogadanja module actually emits (licence.ts), with its own address and licence. */
export interface DogadanjaSourceEntry {
  source: string;
  naziv: string;
  url: string;
  licence: string;
}

/** The one note the page owes readers about text the Worker itself produced (WP6), not about a source. */
export interface ObradaEntry {
  naslov: string;
  tekst: string;
}

/** A source considered for the dogadanja module and left out for a robots.txt reason (R-P5) -- named, not silently dropped. */
export interface DogadanjaDroppedEntry {
  naziv: string;
  url: string;
  reason: string;
}

export const IZVORI: IzvorEntry[] = data.sources;
export const DOGADANJA_SOURCES: DogadanjaSourceEntry[] = data.dogadanjaSources;
export const DOGADANJA_DROPPED: DogadanjaDroppedEntry[] = data.dogadanjaDropped;
export const OBRADA: ObradaEntry = data.obrada;

/**
 * §5 of the filed proposal and docs/izvori.md both point readers at /izvori
 * for "the full per-source list with addresses and licences" of the
 * dogadanja module (R-F7); this renders it, one row per real `data.source`
 * value plus the two sources named and reasoned away for robots.txt (R-P5),
 * nested under the module's own summary row.
 */
function renderDogadanjaSources(): string {
  const rows = DOGADANJA_SOURCES.map(
    (source) =>
      `<li><a href="${escapeAttribute(source.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(source.naziv)}</a> — Licenca: ${escapeHtml(source.licence)}</li>`,
  ).join('\n');
  const dropped = DOGADANJA_DROPPED.map(
    (entry) =>
      `<li>${escapeHtml(entry.naziv)} (<a href="${escapeAttribute(entry.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(entry.url)}</a>) — ${escapeHtml(entry.reason)}</li>`,
  ).join('\n');
  return `<h3>Sedam izvora modula, pojedinačno</h3>
  <ul class="izvor-podizvori">
${rows}
  </ul>
  <h3>Isključeno zbog robots.txt</h3>
  <ul class="izvor-iskljuceno">
${dropped}
  </ul>`;
}

export function renderIzvoriHtml(sources: readonly IzvorEntry[] = IZVORI): string {
  return `<nav class="page-nav" aria-label="Skupine izvora"><a href="#izvor-zet-rt">Prijevoz</a><a href="#izvor-dhmz-now">Vrijeme</a><a href="#izvor-dogadanja">Događanja</a><a href="#city-sources-title">Gradski katalog</a><a href="#izvor-obrada-naslov">Obrada podataka</a></nav>` + sources
    .map(
      (source) => `<article class="izvor" id="izvor-${escapeAttribute(source.module)}">
  <h2>${escapeHtml(source.naziv)}</h2>
  <p class="izvor-text">${escapeHtml(source.text)}</p>
  <p class="izvor-meta">Licenca: ${escapeHtml(source.licence)} · <a href="${escapeAttribute(source.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(source.url)}</a></p>
  ${source.module === 'dogadanja' ? renderDogadanjaSources() : ''}
</article>`,
    )
    .join('\n')+renderObrada()+renderCitySources();
}
/** The ticker's lines are machine-condensed; the page says so, beside the sources they come from. */
function renderObrada(): string {
  return `<section class="izvor-obrada" aria-labelledby="izvor-obrada-naslov">
  <h2 id="izvor-obrada-naslov">${escapeHtml(OBRADA.naslov)}</h2>
  <p>${escapeHtml(OBRADA.tekst)}</p>
</section>`;
}
function renderCitySources():string{
  const references=REFERENCE_SOURCES.map(s=>({id:s.id,name:s.name,url:s.catalogue,licence:s.licence}));
  const rows=[...references,...Object.values(LIVE_SOURCES)].map(s=>`<li id="city-source-${escapeAttribute(s.id)}"><a href="${escapeAttribute(s.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(s.name)}</a>: ${escapeHtml(s.licence)}</li>`).join('\n');
  return `<section aria-labelledby="city-sources-title"><h2 id="city-sources-title">Mjesta, priče i uvjeti u gradu</h2>
    <p>Katalog gradskih mjesta osvježava se zasebno od događanja i položaja vozila. Registar nije provjera radnog vremena, pristupačnosti ili trenutačnog stanja. BAJS brojevi imaju vrijeme opažanja; zrak je preliminarni indeks pojedine postaje; dolasci ZET-a procjena su iz ZET-ovih podataka o vozilima, a polasci bez praćenog vozila i sve ploče HŽPP-a ostaju vozni red.</p>
    <ul>${rows}</ul>
    <p>Ulične priče prenose objavljene opise, uz naselje. Baština se povezuje preko registarske oznake; geometrija označava obuhvat zaštite, ne ulaz ni pravo pristupa. Nepotvrđene lokacije ostaju u popisu bez oznake na karti.</p>
    <p>Ti izvori isporučuju se aplikaciji kroz javni katalog, bez novog skupa na /open. Navođenje izvora ne dodjeljuje dodatna prava ponovne uporabe; gdje uvjeti nisu navedeni, to ostaje izričito označeno.</p></section>`;
}
