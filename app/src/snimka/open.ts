// Otvoreni podaci iz snimke (question q3, "Što je grad mogao znati u svakoj
// minuti?"): the signals the recording derived, the downloads exactly as the
// manifest lists them (manifest.files.exports: never a hash written here),
// the catalogue line, how to rebuild the set, the promise of the application
// and what the downloads leave out (plan section 4, decision S-14).
import { SNIMKA_API, type ExportRef, type SnimkaManifest } from '../../../shared/snimka';
import { escapeHtml } from '../ui/dom/escape';
import type { Mount } from './context';
import { count, type Forms } from './format';
import { SN, fill } from './strings';

const O = SN.open;

/** Strings Appendix B lacks (new for the read-through; the orchestrator may move them into strings.ts). */
export const OPEN_TEXT = {
  /** The second, stable link of a download (the alias the catalogue uses). */
  latest: 'Stalna poveznica',
  latestNamed: 'Stalna poveznica: {title}',
  /** The forms of "{rows} redaka" for one and a few rows. */
  rowForms: ['redak', 'retka', 'redaka'] as Forms,
  catalogEntry: 'Skup u popisu otvorenih podataka',
  brief: 'Opis cjevovoda',
  commit: 'Predaja {commit}',
} as const;
const T = OPEN_TEXT;

const KB = 1000;
const MB = 1000 * 1000;
const ONE_DECIMAL = new Intl.NumberFormat('hr-HR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const WHOLE = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 0 });

/** A file's size in words: "3 KB" (never under 1 KB for a file that has bytes), "1,4 MB", "12 MB"; decimal units. */
export function sizeWords(bytes: number): string {
  if (!(bytes >= 0)) return SN.strip.noValue;
  if (bytes < MB) return fill(SN.size.kb, { n: WHOLE.format(Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / KB))) });
  const mb = bytes / MB;
  // 999,95 KB rounds to 1000 KB: such a file is already a megabyte.
  return fill(SN.size.mb, { n: mb < 10 ? ONE_DECIMAL.format(Math.round(mb * 10) / 10) : WHOLE.format(Math.round(mb)) });
}

export interface Download { name: string; title: string; format: string; size: string; rows: string | null; href: string; latest: string; text: string }

/** The downloads of the manifest in its own order: the hashed link, the stable alias, the words of the list. */
export function downloadsOf(manifest: Pick<SnimkaManifest, 'files'>): Download[] {
  return manifest.files.exports.map((ref: ExportRef) => {
    const format = ref.format.toUpperCase();
    const size = sizeWords(ref.bytes);
    return {
      name: ref.name, title: ref.title, format, size,
      rows: ref.rows === null ? null : count(ref.rows, T.rowForms),
      href: `${SNIMKA_API}${ref.path}`,
      latest: `${SNIMKA_API}exports/latest/${ref.name}.${ref.format}`,
      text: fill(O.download, { title: ref.title, format, size }),
    };
  });
}

/** The rows of the signals table: what, from what, how often, for whom. */
export function signalRows(): [signal: string, source: string, cadence: string, use: string][] {
  const s = O.source;
  const c = O.cadence;
  const r = O.row;
  return [
    [r.state, `${s.zet}; ${s.kajima}`, c.minute, r.stateUse],
    [r.fleet, s.zet, c.five, r.fleetUse],
    [r.feed, s.zet, c.minute, r.feedUse],
    [r.bikes, s.nextbike, c.five, r.bikesUse],
    [r.closures, s.city, c.change, r.closuresUse],
    [r.voice, s.kajima, c.minute, r.voiceUse],
  ];
}

/** The commit as people read it: twelve characters of a full hash, anything else as it is. */
export function shortCommit(commit: string): string {
  return /^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 12) : commit;
}

const REPO = 'https://github.com/matijarma/vidikovac';

function signalsTable(): string {
  const head = [O.signal, O.signalSource, O.signalCadence, O.signalUse];
  return `<div class="st-table sn-small-table sn-open-signals"><div class="st-table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(O.title)}"><table>` +
    `<caption class="visually-hidden">${escapeHtml(O.title)}</caption>` +
    `<thead><tr>${head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${signalRows().map((row) => `<tr>${row.map((cell, i) => (i === 0 ? `<th scope="row">${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`)).join('')}</tr>`).join('')}</tbody>` +
    '</table></div></div>';
}

function downloadsList(manifest: SnimkaManifest): string {
  const items = downloadsOf(manifest)
    .map((d) => `<li class="sn-open-item" data-export="${escapeHtml(d.name)}">` +
      `<a class="sn-open-file" href="${escapeHtml(d.href)}" download>${escapeHtml(d.text)}</a>` +
      `<span class="sn-open-meta">${d.rows ? `<span class="sn-open-rows">${escapeHtml(d.rows)}</span>` : ''}` +
      `<a class="sn-open-latest" href="${escapeHtml(d.latest)}" aria-label="${escapeHtml(fill(T.latestNamed, { title: d.title }))}">${escapeHtml(T.latest)}</a></span></li>`)
    .join('');
  return `<h3 class="sn-open-h">${escapeHtml(O.downloads)}</h3><ul class="sn-open-list" data-sn="downloads">${items}</ul>` +
    `<p class="sn-open-licence">${escapeHtml(O.licence)}</p>`;
}

export const mountOpen: Mount = (ctx, root) => {
  const m = ctx.manifest;
  const commit = shortCommit(m.build.commit);
  const commitLink = /^[0-9a-f]{7,40}$/.test(m.build.commit)
    ? ` <a class="st-link" href="${REPO}/commit/${escapeHtml(m.build.commit)}" rel="noopener noreferrer" target="_blank">${escapeHtml(fill(T.commit, { commit }))}<span class="visually-hidden"> ${escapeHtml(SN.news.newTab)}</span><span aria-hidden="true">↗</span></a>`
    : '';
  const wrap = ctx.doc.createElement('div');
  wrap.className = 'sn-open-body';
  wrap.innerHTML =
    signalsTable() +
    `<div class="sn-open-cols"><div class="sn-open-downloads">${downloadsList(m)}</div>` +
    '<div class="sn-open-notes">' +
    `<p class="sn-open-catalog">${escapeHtml(O.catalog)} <a class="st-link" href="/open/catalog.json">${escapeHtml(O.catalogLink)}</a> · <a class="st-link" href="/open/#snimka-2026-09">${escapeHtml(T.catalogEntry)}</a></p>` +
    `<h3 class="sn-open-h">${escapeHtml(O.repro)}</h3>` +
    `<p class="sn-open-repro" data-sn="repro">${escapeHtml(fill(O.reproText, { commit }))}${commitLink} <a class="st-link" href="${REPO}/blob/main/docs/snimka-2026-10.md" rel="noopener noreferrer" target="_blank">${escapeHtml(T.brief)}<span class="visually-hidden"> ${escapeHtml(SN.news.newTab)}</span><span aria-hidden="true">↗</span></a></p>` +
    `<p class="sn-open-promise">${escapeHtml(O.promise)}</p>` +
    `<p class="sn-open-excluded">${escapeHtml(O.notIncluded)}</p>` +
    '</div></div>';
  root.replaceChildren(wrap);
  root.removeAttribute('aria-busy');
  root.dataset.snOpen = 'ready';
  return () => { delete root.dataset.snOpen; };
};
