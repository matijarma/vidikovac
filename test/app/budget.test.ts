// R-L4 / R-F3: the filed promise (docs/prijava/prijedlog-projekta.md §1.10)
// is under 200 kB transferred per screen load in lightweight mode. This test
// measures it against a real production build rather than trusting anyone's
// arithmetic: it builds the app into a scratch directory with Vite's manifest
// on, walks the module graph each lightweight entry actually loads, and sums
// what the wire would carry -- the entry HTML, every JS chunk reachable by
// *static* import (never through the MapLibre or fonts dynamic imports,
// which the lightweight path never follows), and every stylesheet those
// chunks own -- each gzipped at level 6, the level a CDN edge uses.
//
// A second assertion walks the same graph and fails if the lightweight graph
// reaches for the fonts chunk, the MapLibre chunk or the network artefact at
// all: a graph that references them would fetch them on some path, and the
// budget would be an accident rather than a property.
import { build } from 'vite';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The promise, in bytes on the wire (200 kB, decimal, as the proposal writes it). */
const BUDGET_BYTES = 200_000;
const GZIP_LEVEL = 6;

/** The two screens a lightweight device loads: the public screen and the phone. */
const ENTRIES = ['kiosk/index.html', 'd/index.html'] as const;
/** Manifest keys of the chunks the lightweight path must never reference. */
const FORBIDDEN_CHUNKS = ['src/ui/fonts.css', 'src/map/maplibre-entry.ts'] as const;
const NETWORK_ARTEFACT = 'zet-network.json';

interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}
type Manifest = Record<string, ManifestChunk>;

interface Measured { path: string; bytes: number; gzip: number }

const root = resolve(import.meta.dirname, '../..');
let outDir: string;
let manifest: Manifest;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'vidikovac-budget-'));
  await build({
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, manifest: true },
  });
  manifest = JSON.parse(readFileSync(join(outDir, '.vite/manifest.json'), 'utf8')) as Manifest;
}, 180_000);

afterAll(() => {
  // The directory came from mkdtemp, but resolve and verify it before a
  // recursive removal so an accidental variable change cannot leave tmp.
  if (!outDir) return;
  const target = resolve(outDir);
  const temporaryRoot = resolve(tmpdir());
  if (!target.startsWith(`${temporaryRoot}\\`) && !target.startsWith(`${temporaryRoot}/`)) {
    throw new Error('Refusing to remove a budget directory outside the OS temporary directory.');
  }
  rmSync(target, { recursive: true, force: true });
});

function measure(path: string): Measured {
  const raw = readFileSync(join(outDir, path));
  return { path, bytes: raw.byteLength, gzip: gzipSync(raw, { level: GZIP_LEVEL }).byteLength };
}

/** Every manifest key reachable from `entry` over static imports only. */
function staticGraph(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (key: string): void => {
    if (seen.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`manifest has no chunk ${key}`);
    seen.add(key);
    for (const dep of chunk.imports ?? []) walk(dep);
  };
  walk(entry);
  return [...seen];
}

/** The files the wire carries for one screen: the HTML, the graph's JS, its
 *  CSS, and every font file that CSS pulls in (R-L4: "fonts included"). A
 *  woff2 is already compressed, so its gzip size is its transfer size. */
function wireFiles(entry: string): string[] {
  const files = new Set<string>([entry]);
  for (const key of staticGraph(entry)) {
    const chunk = manifest[key]!;
    files.add(chunk.file);
    for (const css of chunk.css ?? []) {
      files.add(css);
      for (const font of fontFiles(join(outDir, css))) files.add(font);
    }
  }
  return [...files];
}

/** Every `url(...)` a stylesheet points at a font file, as a dist-relative path. */
function fontFiles(cssPath: string): string[] {
  const css = readFileSync(cssPath, 'utf8');
  return [...css.matchAll(/url\((['"]?)([^'")]+\.woff2?)\1\)/g)].map((m) => m[2]!.replace(/^\//, ''));
}

function breakdown(entry: string): { rows: Measured[]; total: number } {
  const rows = wireFiles(entry).map(measure);
  return { rows, total: rows.reduce((sum, r) => sum + r.gzip, 0) };
}

function print(entry: string, rows: Measured[], total: number): void {
  const lines = rows.map((r) => `  ${r.gzip.toString().padStart(7)} gz  ${r.bytes.toString().padStart(8)} raw  ${r.path}`);
  console.log(`[budget] /${entry.replace('index.html', '')} lightweight graph\n${lines.join('\n')}\n  ${total.toString().padStart(7)} gz  total (budget ${BUDGET_BYTES})`);
}

describe('the lightweight promise (R-L4, R-F3): under 200 kB per screen load', () => {
  for (const entry of ENTRIES) {
    it(`/${entry.replace('index.html', '')} transfers under ${BUDGET_BYTES} bytes gzipped`, () => {
      expect(existsSync(join(outDir, entry)), `${entry} must be built`).toBe(true);
      const { rows, total } = breakdown(entry);
      print(entry, rows, total);
      expect(total, `the lightweight graph of ${entry} is ${total} bytes gzipped`).toBeLessThan(BUDGET_BYTES);
    });

    it(`/${entry.replace('index.html', '')} never references the fonts chunk, the MapLibre chunk or the network artefact`, () => {
      const graph = staticGraph(entry);
      for (const forbidden of FORBIDDEN_CHUNKS) {
        expect(graph, `${entry} statically imports ${forbidden}`).not.toContain(forbidden);
      }
      // The HTML must not preload or link them either: Vite writes a
      // <link> for every static CSS and a modulepreload for every static
      // chunk, so the wire graph is what the HTML says it is.
      const html = readFileSync(join(outDir, entry), 'utf8');
      for (const forbidden of FORBIDDEN_CHUNKS) {
        const file = manifest[forbidden]?.file;
        if (file) expect(html, `${entry} links ${file}`).not.toContain(file);
        for (const css of manifest[forbidden]?.css ?? []) expect(html, `${entry} links ${css}`).not.toContain(css);
      }
      expect(html).not.toContain(NETWORK_ARTEFACT);
      expect(html).not.toContain('.woff2');
      // Nor may any stylesheet on the wire carry an @font-face: the system
      // stack is the lightweight typography (R-F3).
      for (const file of wireFiles(entry).filter((f) => f.endsWith('.css'))) {
        const css = readFileSync(join(outDir, file), 'utf8');
        expect(css, `${file} declares a webfont`).not.toContain('@font-face');
        expect(css, `${file} references a font file`).not.toContain('.woff2');
      }
      // And the artefact is never a build-time asset of any chunk on the graph.
      for (const key of graph) {
        for (const asset of manifest[key]?.assets ?? []) expect(asset, `${key} bundles ${asset}`).not.toContain(NETWORK_ARTEFACT);
      }
    });
  }
});

describe('full map JavaScript budget, including the separate MapLibre v6 worker', () => {
  for (const entry of ENTRIES) {
    it(`/${entry.replace('index.html', '')} stays under 600 kB compressed when the map opens`, () => {
      const keys = new Set([...staticGraph(entry), ...staticGraph('src/map/maplibre-entry.ts')]);
      const files = new Set([...keys].map((key) => manifest[key]!.file).filter((file) => /\.m?js$/.test(file)));
      // Vite emits ?worker&url as an asset, not as a manifest import.
      // Omitting this file would undercount the real initial map payload.
      const workers = readdirSync(join(outDir, 'assets')).filter((file) => /^maplibre-gl-worker-.*\.js$/.test(file));
      expect(workers.length, 'the real map worker must be measured').toBeGreaterThan(0);
      for (const worker of workers) files.add(`assets/${worker}`);
      const rows = [...files].map(measure);
      const total = rows.reduce((sum, row) => sum + row.gzip, 0);
      console.log(`[budget] /${entry.replace('index.html', '')} full-map JS + worker: ${total} gzip bytes`);
      expect(total, 'page, map library, shared chunks and worker together').toBeLessThan(600_000);
    });
  }
});
