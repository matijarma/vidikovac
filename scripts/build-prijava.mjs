#!/usr/bin/env node
// Builds the written project proposal ("pisani prijedlog projekta") as an HTML
// document that reads like the app, from the Markdown masters in docs/prijava:
//
//   docs/prijava/prijedlog-projekta.md        chapters 1-8, direction, author's note
//   docs/prijava/plan-provedbe.md             appendix 9  (M0-M7)
//   docs/prijava/obrazac-3-financijski-plan.md appendix 10 (budget)
//   docs/prijava/rizici-i-odgovori.md         appendix 11 (expected questions)
//
// plus the figures under docs/prijava/figures (inline SVG and HTML fragments
// with their manifests), the app's tokens and tile grammar as they were when the
// proposal was submitted (docs/prijava/src/*-2026-09-16.css, copies of app/src/ui
// at 4e96dd2), and the document chrome in docs/prijava/src (template, stylesheet,
// script, figure placement, data snapshot).
//
// Two variants come out of one source:
//   file    docs/prijava/prijedlog-projekta.html   self-contained: fonts as data URIs,
//                                                   script inline; opens from disk, prints to A4.
//                                                   The submitted record: written only with
//                                                   --file, never by a plain rebuild.
//   hosted  app/prijava/index.html + prijava.js     served at /prijava/ under the app's CSP
//                                                   (script-src 'self', font-src 'self'):
//                                                   external module script, /fonts/manrope files.
//
// The hosted page alone carries the development-notes layer: a button at the top of
// the document and an aside, hidden until the button is pressed, rendered from
// docs/prijava/razvojne-biljeske.md into the fragment docs/prijava/src/biljeske.html.
// The submitted text around the layer is the same markup, byte for byte, as without
// it (test/docs/prijava.test.ts).
//
// The Markdown is the master text: nothing in this script writes prose. Run with
// `node scripts/build-prijava.mjs` after editing any master; commit the outputs.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...parts) => join(ROOT, ...parts);
const read = (rel) => readFileSync(P(rel), 'utf8');

const SRC = 'docs/prijava/src';
const FIG = 'docs/prijava/figures';

// ---------------------------------------------------------------------------
// Markdown subset -> HTML. Only what the masters use: ATX headings, paragraphs,
// `- ` and `1. ` lists, pipe tables, **strong**, `code`, bare URLs, " -- ".
// ---------------------------------------------------------------------------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/\(0[–-]\d+ bodova\)/g, '')
    .replace(/[čć]/g, 'c').replace(/đ/g, 'd').replace(/š/g, 's').replace(/ž/g, 'z')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inline(text) {
  let s = esc(text);
  // Long dashes: the masters write " -- " between list items; copy rules forbid it and U+2014 in
  // static pages, so it becomes an en dash. Never an em dash.
  s = s.replace(/ -- /g, ' – ');
  // Plan markers before generic strong: **(plan: M2)** -> a pill.
  s = s.replace(/\*\*\(plan: (M\d+[a-z]?)\)\*\*/g, '<span class="plan" title="isporuka financiranog razdoblja, mjesec plana provedbe">plan: $1</span>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bare URLs (not already inside a code span or href).
  s = s.replace(/(^|[\s(·>])(https?:\/\/[^\s<)]+?)([.,;:]?)(?=$|[\s<)·])/g, (m, pre, url, tail) => {
    if (url.endsWith('.')) { tail = '.' + tail; url = url.slice(0, -1); }
    return `${pre}<a href="${url}">${url}</a>${tail}`;
  });
  return s;
}

function parseBlocks(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('<!--')) { while (i < lines.length && !lines[i].includes('-->')) i++; i++; continue; }
    const h = /^(#{1,6}) (.*)$/.exec(line);
    if (h) { blocks.push({ type: 'h', level: h[1].length, text: h[2].trim() }); i++; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      blocks.push({ type: 'table', rows });
      continue;
    }
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ''));
      blocks.push({ type: 'ol', items });
      continue;
    }
    // Paragraph: consecutive non-blank lines that start no other block.
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6} |\||- |\d+\. |<!--)/.test(lines[i])) buf.push(lines[i++]);
    blocks.push({ type: 'p', lines: buf });
  }
  return blocks;
}

function renderTable(rows) {
  const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  const th = head.map((c) => `<th scope="col">${inline(c)}</th>`).join('');
  const tr = body.map((r) => `<tr>${r.map((c, j) => (j === 0 ? `<th scope="row">${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('\n');
  return `<div class="tbl" tabindex="0"><table><thead><tr>${th}</tr></thead><tbody>\n${tr}\n</tbody></table></div>`;
}

/** The `**Label:** value` header lines of the main master become the cover's meta list. */
function parseCoverMeta(paragraph) {
  const out = [];
  for (const line of paragraph.lines) {
    const re = /\*\*([^*]+?):\*\*\s*([^*]+?)(?=\s*\*\*|$)/g;
    let m;
    while ((m = re.exec(line))) out.push({ label: m[1].trim(), value: m[2].trim().replace(/\s*·\s*$/, '') });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Figures: manifests give title/desc/caption; placement says where each goes.
// ---------------------------------------------------------------------------
function loadManifests() {
  const out = new Map();
  if (!existsSync(P(FIG))) return out;
  for (const name of readdirSync(P(FIG))) {
    if (!/^manifest-.*\.json$/.test(name)) continue;
    for (const entry of JSON.parse(read(`${FIG}/${name}`))) out.set(entry.id, entry);
  }
  return out;
}

function figureMarkup(id, manifests, warnings) {
  const meta = manifests.get(id);
  const file = meta?.file ? `${FIG}/${meta.file.replace(/^.*figures[\\/]/, '')}` : null;
  const candidates = file ? [file] : [`${FIG}/${id}.svg`, `${FIG}/${id}.html`];
  const path = candidates.find((c) => existsSync(P(c)));
  if (!path) { warnings.push(`figure missing: ${id}`); return `<!-- figure ${id} not built -->`; }
  let body = read(path).replace(/^<\?xml[^>]*>\s*/, '').trim();
  const kind = path.endsWith('.svg') ? 'svg' : 'html';
  // A mock reproduces the app's DOM, h1 included; the document has one h1, the cover's.
  if (kind === 'html') body = body.replace(/<h1(?=[\s>])/g, '<p data-mock-h="1"').replace(/<\/h1>/g, '</p>');
  const caption = meta?.caption ? `<figcaption>${esc(meta.caption)}</figcaption>` : '';
  // SVG bodies scroll sideways on narrow screens (prijava.css), so they take focus for keyboard scrolling.
  const bodyAttrs = kind === 'svg' ? ` tabindex="0" role="group" aria-label="${esc(meta?.title ?? id)}"` : '';
  return `<figure class="fig" id="fig-${id}" data-kind="${kind}"><div class="fig-body"${bodyAttrs}>${body}</div>${caption}</figure>`;
}

// ---------------------------------------------------------------------------
// Development notes since submission (hosted page only). The master is a short
// Markdown file: an h1, an intro paragraph, then one `## <date> · <title>` entry
// per period with paragraphs, **strong**, `code` and [text](https://...) links.
// ---------------------------------------------------------------------------
const MONTHS = { 'siječnja': 1, 'veljače': 2, 'ožujka': 3, 'travnja': 4, 'svibnja': 5, 'lipnja': 6, 'srpnja': 7, 'kolovoza': 8, 'rujna': 9, 'listopada': 10, 'studenoga': 11, 'prosinca': 12 };
/** "14. rujna 2026." or "17.–21. rujna 2026." → ISO date of the first day, or null. */
export function noteDate(text) {
  const m = /^(\d{1,2})\.(?:–\d{1,2}\.)? (\p{L}+) (\d{4})\.$/u.exec(text.trim());
  if (!m || !MONTHS[m[2]]) return null;
  return `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function noteInline(text) {
  return esc(text)
    .replace(/ -- /g, ' – ')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

/** The notes master as { intro: string[], entries: { date, iso, title, paragraphs }[] }. */
export function parseNotes(md) {
  const intro = [];
  const entries = [];
  for (const b of parseBlocks(md)) {
    if (b.type === 'h' && b.level === 2) {
      const [date, ...rest] = b.text.split(' · ');
      entries.push({ date: date.trim(), iso: noteDate(date), title: rest.join(' · ').trim(), paragraphs: [] });
    } else if (b.type === 'p') {
      (entries.length ? entries[entries.length - 1].paragraphs : intro).push(b.lines.join(' '));
    }
  }
  return { intro, entries };
}

function notesMarkup(warnings) {
  const { intro, entries } = parseNotes(read('docs/prijava/razvojne-biljeske.md'));
  const body = [
    ...intro.map((p) => `<p>${noteInline(p)}</p>`),
    ...entries.map((e) => {
      if (!e.iso) warnings.push(`note without a date: ${e.date}`);
      const id = `biljeska-${e.iso ?? slugify(e.date)}`;
      return `<article class="note" aria-labelledby="${id}-h"><h3 id="${id}-h"><time datetime="${e.iso ?? ''}">${esc(e.date)}</time> · ${noteInline(e.title)}</h3>\n`
        + e.paragraphs.map((p) => `<p>${noteInline(p)}</p>`).join('\n') + '</article>';
    }),
  ].join('\n');
  return read(`${SRC}/biljeske.html`).trim().replace('<!--@NOTES_BODY-->', () => body);
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------
function renderDocument({ blocks, placement, manifests, warnings, headingIds }) {
  const out = [];
  const sectionStack = []; // { level, text, pending: [placements], seenP: 0, seenTable: 0 }
  const placementsFor = (text) => placement.filter((p) => p.section === text);

  const flush = (level) => {
    while (sectionStack.length && sectionStack[sectionStack.length - 1].level >= level) {
      const s = sectionStack.pop();
      for (const p of s.pending) if (p.position === 'end') out.push(figureMarkup(p.id, manifests, warnings));
      out.push('</section>');
    }
  };

  for (const b of blocks) {
    if (b.type === 'h') {
      if (b.level === 1) continue; // the document title is the cover
      flush(b.level);
      const id = headingIds.get(b.text) ?? slugify(b.text);
      const pending = placementsFor(b.text);
      sectionStack.push({ level: b.level, text: b.text, pending, seenP: 0, seenTable: 0 });
      out.push(`<section class="sec sec-h${b.level}" id="${id}" aria-labelledby="${id}-h">`);
      out.push(`<h${b.level} id="${id}-h">${inline(b.text)}</h${b.level}>`);
      continue;
    }
    const cur = sectionStack[sectionStack.length - 1];
    if (b.type === 'p') {
      out.push(`<p>${inline(b.lines.join(' '))}</p>`);
      if (cur && ++cur.seenP === 1) for (const p of cur.pending) if (p.position === 'after-first-paragraph') out.push(figureMarkup(p.id, manifests, warnings));
    } else if (b.type === 'table') {
      const replacing = cur?.pending.find((p) => p.position === 'replace-first-table' && cur.seenTable === 0);
      cur && cur.seenTable++;
      if (replacing) out.push(figureMarkup(replacing.id, manifests, warnings));
      else {
        out.push(renderTable(b.rows));
        if (cur && cur.seenTable === 1) for (const p of cur.pending) if (p.position === 'after-first-table') out.push(figureMarkup(p.id, manifests, warnings));
      }
    } else if (b.type === 'ul' || b.type === 'ol') {
      out.push(`<${b.type}>${b.items.map((it) => `<li>${inline(it)}</li>`).join('\n')}</${b.type}>`);
    }
  }
  flush(0);
  return out.join('\n');
}

/** Appendix masters: their h1 becomes a numbered h2, their h2 an h3, h3 stays h3. */
function appendixBlocks(rel, number, title, { dropLead = 0 } = {}) {
  const blocks = parseBlocks(read(rel)).map((b) => {
    if (b.type !== 'h') return b;
    if (b.level === 1) return { type: 'h', level: 2, text: `${number}. ${title}` };
    if (b.level === 2) return { ...b, level: 3 };
    return b;
  });
  // A master may open with a line that only makes sense standalone (e.g. the risks doc's
  // "Osam prigovora koje očekujemo" lead): dropLead skips that many paragraphs after the h1.
  if (dropLead) {
    let dropped = 0;
    return blocks.filter((b, i) => !(i > 0 && b.type === 'p' && dropped < dropLead && ++dropped));
  }
  return blocks;
}

function buildToc(tocSpec, headingIds) {
  return tocSpec.map(({ label, heading }) => {
    const id = headingIds.get(heading) ?? slugify(heading);
    return `<a class="toc-link" href="#${id}" data-target="${id}">${esc(label)}</a>`;
  }).join('');
}

function fontFaces(variant) {
  const dir = 'app/public/fonts/manrope';
  const ranges = {
    latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  };
  let css = '';
  for (const w of [400, 500, 700]) {
    for (const sub of ['latin-ext', 'latin']) {
      const file = `manrope-${w}-normal-${sub}.woff2`;
      const src = variant === 'file'
        ? `url(data:font/woff2;base64,${readFileSync(P(dir, file)).toString('base64')}) format('woff2')`
        : `url('/fonts/manrope/${file}') format('woff2')`;
      css += `@font-face{font-family:'Manrope';font-style:normal;font-weight:${w};font-display:swap;src:${src};unicode-range:${ranges[sub]};}\n`;
    }
  }
  return css;
}

function stylesheet(variant) {
  const parts = [
    fontFaces(variant),
    // The app's sheets as submitted (16 September 2026), not today's: the document keeps its look.
    read(`${SRC}/tokens-2026-09-16.css`),
    read(`${SRC}/signage-2026-09-16.css`),
    existsSync(P(`${FIG}/figures-b.css`)) ? read(`${FIG}/figures-b.css`) : '',
    existsSync(P(`${FIG}/mocks.css`)) ? read(`${FIG}/mocks.css`) : '',
    read(`${SRC}/prijava.css`),
  ];
  // Comments go: the app's sheets explain themselves at length, and a static page may carry no " -- ".
  return parts.join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n');
}

/** Both variants as strings, nothing written. `notes: false` renders the hosted page without the layer. */
export function render({ notes = true } = {}) {
  const warnings = [];
  const manifests = loadManifests();
  const placement = JSON.parse(read(`${SRC}/figures.json`));
  const snapshot = read(`${SRC}/snapshot.json`).trim();
  const template = read(`${SRC}/template.html`);
  const script = read(`${SRC}/prijava.js`);

  const main = parseBlocks(read('docs/prijava/prijedlog-projekta.md'));
  const title = main.find((b) => b.type === 'h' && b.level === 1)?.text ?? 'Kaj ima?';
  const coverMeta = parseCoverMeta(main.find((b) => b.type === 'p'));
  // Body = everything after the cover paragraph; appendices slot in before the author's note.
  const firstP = main.findIndex((b) => b.type === 'p');
  const body = main.filter((_, i) => i !== firstP);
  const noteAt = body.findIndex((b) => b.type === 'h' && b.level === 2 && /^Opaska autora/.test(b.text));
  const appendices = [
    ...appendixBlocks('docs/prijava/plan-provedbe.md', 9, 'Plan provedbe'),
    ...appendixBlocks('docs/prijava/obrazac-3-financijski-plan.md', 10, 'Financijski plan (Obrazac 3)'),
    ...appendixBlocks('docs/prijava/rizici-i-odgovori.md', 11, 'Pitanja koja očekujemo i odgovori ugrađeni u proizvod'),
  ];
  const blocks = noteAt >= 0 ? [...body.slice(0, noteAt), ...appendices, ...body.slice(noteAt)] : [...body, ...appendices];

  const headingIds = new Map();
  for (const b of blocks) if (b.type === 'h') headingIds.set(b.text, slugify(b.text));

  const tocSpec = JSON.parse(read(`${SRC}/toc.json`));
  const toc = buildToc(tocSpec, headingIds);
  const bodyHtml = renderDocument({ blocks, placement, manifests, warnings, headingIds });
  const coverMetaHtml = coverMeta.map((m) => `<div class="cover-row"><dt>${esc(m.label)}</dt><dd>${inline(m.value)}</dd></div>`).join('\n');

  const qrPath = `${FIG}/qr-s.svg`;
  const qr = existsSync(P(qrPath))
    ? read(qrPath).replace(/^<\?xml[^>]*>\s*/, '').replace(/^<svg[^>]*>/, (tag) => tag.replace(/\s(width|height)="[^"]*"/g, '')).trim()
    : (warnings.push('qr-s.svg missing'), '<span class="invite-qr-missing">QR</span>');

  const notesHtml = notes ? notesMarkup(warnings) : '';
  let file = '';
  let hosted = '';
  for (const variant of ['file', 'hosted']) {
    const head = `<style>\n${stylesheet(variant)}\n</style>`;
    const scriptTag = variant === 'file'
      ? `<script>\n${script}\n</script>`
      : `<script type="module" src="./prijava.js"></script>`;
    let html = template
      .replaceAll('<!--@VARIANT-->', () => variant)
      .replace('<!--@TITLE-->', () => esc(title))
      .replace('<!--@HEAD-->', () => head)
      .replace('<!--@TOC-->', () => toc)
      // The layer sits on the hosted page only; in the file the marker leaves no trace.
      .replace('<!--@NOTES-->', () => (variant === 'hosted' && notesHtml ? `${notesHtml}\n  ` : ''))
      .replace('<!--@COVER_META-->', () => coverMetaHtml)
      .replace('<!--@BODY-->', () => bodyHtml)
      .replace('<!--@QR-->', () => qr)
      .replace('<!--@SNAPSHOT-->', () => snapshot)
      .replace('<!--@SCRIPT-->', () => scriptTag);
    if (variant === 'file') file = html;
    // The app's CSP is script-src 'self': no inline classic scripts survive on the hosted page
    // (a figure may carry a tiny progressive-enhancement script; its CSS fallback stands).
    else hosted = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  }
  return { file, hosted, script, warnings, headings: [...headingIds.entries()] };
}

/**
 * Writes the hosted page and its script. The self-contained file is the submitted
 * record (built 16 September 2026), so a rebuild leaves it alone; `{ file: true }`
 * (`--file`) writes it too.
 */
export function build({ file = false } = {}) {
  const { file: fileHtml, hosted, script, warnings, headings } = render();
  const outputs = [];
  if (file) {
    writeFileSync(P('docs/prijava/prijedlog-projekta.html'), fileHtml);
    outputs.push({ variant: 'file', path: 'docs/prijava/prijedlog-projekta.html', bytes: Buffer.byteLength(fileHtml) });
  }
  mkdirSync(P('app/prijava'), { recursive: true });
  writeFileSync(P('app/prijava/index.html'), hosted);
  writeFileSync(P('app/prijava/prijava.js'), script);
  outputs.push({ variant: 'hosted', path: 'app/prijava/index.html', bytes: Buffer.byteLength(hosted) });
  return { outputs, warnings, headings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { outputs, warnings } = build({ file: process.argv.includes('--file') });
  for (const o of outputs) console.log(`${o.variant.padEnd(7)} ${o.path} ${(o.bytes / 1024).toFixed(0)} KB`);
  for (const w of warnings) console.warn(`warning: ${w}`);
}
