// /izvori is built at build time from this JSON (vite.config.ts calls
// renderIzvoriHtml in transformIndexHtml), so the attribution page is readable
// with JavaScript switched off and cannot drift from the data the panels use.
import data from './data/izvori.json';
import { escapeAttribute, escapeHtml } from './ui/dom/escape';

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

/** A source considered for the dogadanja module and left out for a robots.txt reason (R-P5) -- named, not silently dropped. */
export interface DogadanjaDroppedEntry {
  naziv: string;
  url: string;
  reason: string;
}

export const IZVORI: IzvorEntry[] = data.sources;
export const DOGADANJA_SOURCES: DogadanjaSourceEntry[] = data.dogadanjaSources;
export const DOGADANJA_DROPPED: DogadanjaDroppedEntry[] = data.dogadanjaDropped;

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
  return sources
    .map(
      (source) => `<article class="izvor" id="izvor-${escapeAttribute(source.module)}">
  <h2>${escapeHtml(source.naziv)}</h2>
  <p class="izvor-text">${escapeHtml(source.text)}</p>
  <p class="izvor-meta">Licenca: ${escapeHtml(source.licence)} · <a href="${escapeAttribute(source.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(source.url)}</a></p>
  ${source.module === 'dogadanja' ? renderDogadanjaSources() : ''}
</article>`,
    )
    .join('\n');
}
