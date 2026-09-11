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

export const IZVORI: IzvorEntry[] = data.sources;

export function renderIzvoriHtml(sources: readonly IzvorEntry[] = IZVORI): string {
  return sources
    .map(
      (source) => `<article class="izvor" id="izvor-${escapeAttribute(source.module)}">
  <h2>${escapeHtml(source.naziv)}</h2>
  <p class="izvor-text">${escapeHtml(source.text)}</p>
  <p class="izvor-meta">Licenca: ${escapeHtml(source.licence)} · <a href="${escapeAttribute(source.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(source.url)}</a></p>
</article>`,
    )
    .join('\n');
}
