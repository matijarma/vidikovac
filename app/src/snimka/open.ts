// Podaci i izvori (plan v3, decision V3-24): what the recording computes that
// ZET and the City do not publish (a lede and three sentences tied to the
// files), the downloads as the manifest lists them (one link per file, the
// stable alias exports/latest/<name>.<ext>, the file name visible; three
// primary rows and the other six under "Ostale datoteke"), the catalogue,
// how to rebuild the set and how to cite it; then the sources: one <dl> from
// manifest.attribution (a short name; what was taken and how it was adapted;
// the licence and a separate link to the source) and the manifest's notes,
// deduplicated. The entry fills the attribution and the notes slots with the
// builders below; mountOpen fills the downloads.
import { SNIMKA_API, type Attribution, type ExportRef, type SnimkaManifest } from '../../../shared/snimka';
import { escapeHtml } from '../ui/dom/escape';
import type { Mount } from './context';
import { SN, fill } from './strings';

const O = SN.open;

const KB = 1000;
const MB = 1000 * 1000;
const ONE_DECIMAL = new Intl.NumberFormat('hr-HR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const WHOLE = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 0 });

/** A file's size in words: "3 kB" (never under 1 kB for a file that has bytes), "1,4 MB", "12 MB"; decimal units. */
export function sizeWords(bytes: number): string {
  if (!(bytes >= 0)) return SN.strip.noValue;
  const kb = Math.round(bytes / KB);
  // 999,6 kB would read 1.000 kB: such a file is already a megabyte.
  if (kb < 1000) return fill(SN.size.kb, { n: WHOLE.format(Math.max(bytes > 0 ? 1 : 0, kb)) });
  const mb = bytes / MB;
  return fill(SN.size.mb, { n: mb < 10 ? ONE_DECIMAL.format(Math.round(mb * 10) / 10) : WHOLE.format(Math.round(mb)) });
}

/** The three files most readers want, in this order, with their own titles (open.file.*). */
export const PRIMARY_EXPORTS = [['series', O.file.series], ['routes-5min', O.file.routes], ['bikes-5min', O.file.bikes]] as const;

export interface Download { name: string; file: string; title: string; format: string; size: string; href: string; primary: boolean }

/** The downloads of the manifest: the three primary files first (in PRIMARY_EXPORTS order), then the others in the
 *  manifest's order; each one link, the stable alias, with its file name, format name and size. */
export function downloadsOf(manifest: Pick<SnimkaManifest, 'files'>): Download[] {
  const primary = new Map<string, string>(PRIMARY_EXPORTS);
  const rank = (ref: ExportRef): number => { const i = PRIMARY_EXPORTS.findIndex(([n]) => n === ref.name); return i < 0 ? PRIMARY_EXPORTS.length : i; };
  return [...manifest.files.exports]
    .map((ref, i) => ({ ref, i }))
    .sort((a, b) => rank(a.ref) - rank(b.ref) || a.i - b.i)
    .map(({ ref }) => ({
      name: ref.name,
      file: `${ref.name}.${ref.format}`,
      title: primary.get(ref.name) ?? ref.title,
      format: O.format[ref.format] ?? ref.format,
      size: sizeWords(ref.bytes),
      href: `${SNIMKA_API}exports/latest/${ref.name}.${ref.format}`,
      primary: primary.has(ref.name),
    }));
}

/** The commit as people read it: twelve characters of a full hash, anything else as it is. */
export function shortCommit(commit: string): string {
  return /^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 12) : commit;
}

export const REPO = 'https://github.com/matijarma/vidikovac';

const NEW_TAB = `<span class="visually-hidden"> ${escapeHtml(SN.news.newTab)}</span>`;
/** A link to GitHub: a new tab, marked "↗" (internal links carry "→", other links nothing). */
const github = (href: string, text: string): string =>
  `<a class="st-link sn-open-link" href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(text)}${NEW_TAB}<span aria-hidden="true">↗</span></a>`;

function itemHtml(d: Download): string {
  const closures = d.name === 'closures' ? `<span class="sn-open-note">${escapeHtml(O.closuresNote)}</span>` : '';
  return `<li class="sn-open-item" data-export="${escapeHtml(d.name)}">` +
    `<a class="sn-open-file" href="${escapeHtml(d.href)}" download="${escapeHtml(d.file)}">` +
    `<span class="sn-open-title">${escapeHtml(d.title)}</span>` +
    `<span class="sn-open-meta"><span class="sn-open-name">${escapeHtml(d.file)}</span> · <span class="sn-open-size">${escapeHtml(d.format)}, ${escapeHtml(d.size)}</span></span>` +
    `</a>${closures}</li>`;
}

/** "Katalog (DCAT-AP): /open/catalog.json" with the path as the link. */
function catalogLine(): string {
  const path = '/open/catalog.json';
  const at = O.catalog.indexOf(path);
  const before = at < 0 ? `${O.catalog} ` : O.catalog.slice(0, at);
  return `<p class="sn-open-catalog">${escapeHtml(before)}<a class="st-link sn-open-link" href="${path}">${escapeHtml(path)}</a></p>`;
}

/** "Ponovljivo: npm run build:snimka iz inačice koda {commit} · opis izrade skupa": the commit and the brief link to GitHub. */
export function reproHtml(commitFull: string): string {
  const commit = shortCommit(commitFull);
  const [before, after = ''] = O.repro.split('{commit}');
  const commitPart = /^[0-9a-f]{7,40}$/.test(commitFull) ? github(`${REPO}/commit/${commitFull}`, commit) : `<code>${escapeHtml(commit)}</code>`;
  return `<p class="sn-open-repro" data-sn="repro">${escapeHtml(before ?? '')}${commitPart}${escapeHtml(after)} · ${github(`${REPO}/blob/main/docs/snimka-2026-10.md`, O.reproBrief)}</p>`;
}

export const mountOpen: Mount = (ctx, root) => {
  const m = ctx.manifest;
  const downloads = downloadsOf(m);
  const primary = downloads.filter((d) => d.primary);
  const others = downloads.filter((d) => !d.primary);
  const wrap = ctx.doc.createElement('div');
  wrap.className = 'sn-open-body';
  wrap.innerHTML =
    `<ul class="sn-open-says">${[O.s1, O.s2, O.s3].map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` +
    '<div class="sn-open-downloads">' +
    `<h3 class="sn-open-h">${escapeHtml(O.downloads)}</h3>` +
    `<ul class="sn-open-list" data-sn="downloads">${primary.map(itemHtml).join('')}</ul>` +
    (others.length
      ? `<details class="sn-open-others"><summary class="sn-open-summary">${escapeHtml(fill(O.others, { n: others.length }))}</summary>` +
        `<ul class="sn-open-list" data-sn="downloads-other">${others.map(itemHtml).join('')}</ul>` +
        catalogLine() + reproHtml(m.build.commit) +
        `<p class="sn-open-cite">${escapeHtml(O.cite)}</p></details>`
      : '') +
    `<p class="sn-open-excluded">${escapeHtml(O.notIncluded)}</p>` +
    '</div>';
  root.replaceChildren(wrap);
  root.removeAttribute('aria-busy');
  root.dataset.snOpen = 'ready';
  return () => { delete root.dataset.snOpen; };
};

// ---- the sources: attribution and notes (filled by the entry) ------------------------------

/** The short name of each source as the list names it (the manifest's own text follows in the description). */
export const SOURCE_NAMES: Readonly<Record<string, string>> = {
  zet: 'ZET · GTFS-RT',
  'zet-rss': 'ZET · obavijesti',
  nextbike: 'nextbike (BAJS)',
  'zagreb-closures': 'Grad Zagreb',
  dhmz: 'DHMZ',
  news: 'Jutarnji, Večernji, N1',
  court: 'Županijski sud',
  osm: 'OpenStreetMap',
  kajima: 'Kaj ima?',
};

/** Sources whose own text is English: ZET's licence sentence is quoted verbatim and labelled so; OpenStreetMap's credit
 *  is only marked as English. */
const VERBATIM = new Set(['zet']);
const ENGLISH = new Set(['zet', 'osm']);

/** One source as the list reads it; `id` is a string so a source the contract adds later (the court) names itself. */
export type SourceEntry = Omit<Attribution, 'id'> & { id: string };

/** The attribution as one description list: per source a short name, what was taken and how it was adapted, and the
 *  licence with a separate link to the source. */
export function attributionHtml(attribution: readonly SourceEntry[]): string {
  const items = attribution.map((a) => {
    const name = SOURCE_NAMES[a.id] ?? a.text;
    const text = VERBATIM.has(a.id)
      ? `<span class="sn-attr-verbatim">${escapeHtml(SN.attribution.verbatim)}:</span> <q lang="en" class="sn-attr-quote">${escapeHtml(a.text)}</q>`
      : ENGLISH.has(a.id) ? `<span lang="en">${escapeHtml(a.text)}</span>` : escapeHtml(a.text);
    const adaptation = a.adaptation ? `<span class="sn-attr-adaptation">${escapeHtml(a.adaptation)}</span>` : '';
    const link = a.url
      ? ` <a class="sn-attr-link" href="${escapeHtml(a.url)}" rel="noopener noreferrer">${escapeHtml(SN.attribution.source)}<span class="visually-hidden">: ${escapeHtml(name)}</span> <span aria-hidden="true">↗</span></a>`
      : '';
    return `<div class="sn-attr-item" data-source="${escapeHtml(a.id)}"><dt class="sn-attr-name">${escapeHtml(name)}</dt>` +
      `<dd class="sn-attr-what">${text}${adaptation}</dd>` +
      `<dd class="sn-attr-licence"><span class="sn-attr-tag">${escapeHtml(a.licence)}</span>${link}</dd></div>`;
  });
  return `<dl class="sn-attr">${items.join('')}</dl>`;
}

/** The manifest's notes and its comparison days' notes, each once (the manifest already repeats some), in order. */
export function notesOf(manifest: Pick<SnimkaManifest, 'notes' | 'comparisons'>): string[] {
  return [...new Set([...manifest.notes, ...manifest.comparisons.flatMap((c) => c.notes)])];
}

/** The notes in a disclosure, open where there is room for it (`open` decides: desktop yes, phones no). */
export function notesHtml(notes: readonly string[], open: boolean): string {
  if (!notes.length) return '';
  return `<details class="sn-attr-notes"${open ? ' open' : ''}><summary class="sn-attr-summary">${escapeHtml(fill(SN.attribution.notes, { n: notes.length }))}</summary>` +
    `<ul class="sn-attr-notes-list">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul></details>`;
}
