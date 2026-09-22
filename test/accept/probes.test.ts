// The DOM probe contract of the companion plan (docs/companion-2026-09-22.md
// §15.6) as one exported array, and a static presence scan over app/src that
// prints the red list: one row per probe, the owning package in the title, so a
// failing row names who is late. Accept tier: red by design until WP1–WP4 emit
// their markup (and WP0 retires the wall's stop-presentation button).
//
// The scan is a presence proxy, not a DOM check: a required probe is green when
// every test id, class and data attribute its selector names appears in the code
// of app/src/**/*.ts (comments do not count: a doc comment naming a probe emits
// nothing); a retired probe is green when its name appears nowhere (comments
// included, so a stale reference keeps the row red). The e2e specs under
// e2e/accept/ check the real DOM.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

export type ProbeOwner = 'WP0' | 'WP1' | 'WP2' | 'WP3' | 'WP4';
export type ProbeKind = 'required' | 'retired';
export interface Probe {
  /** Where the element lives: 'wall header', 'timeline', 'phone Sada', … */
  surface: string;
  /** The selector the specs use (§15.6 spelling; alternatives such as `=promet|kultura` dropped). */
  selector: string;
  /** The package that emits (required) or removes (retired) it. */
  owner: ProbeOwner;
  kind: ProbeKind;
}

const req = (surface: string, owner: ProbeOwner, selector: string): Probe => ({ surface, selector, owner, kind: 'required' });
const ret = (surface: string, owner: ProbeOwner, selector: string): Probe => ({ surface, selector, owner, kind: 'retired' });

export const PROBES: readonly Probe[] = Object.freeze([
  // Wall header
  req('wall header', 'WP3', '[data-testid=kiosk-context]'),
  req('wall header', 'WP1', '[data-testid=kiosk-sentence][data-kicker][data-valid-until]'),
  req('wall header', 'WP1', '[data-testid=kiosk-sentence-kicker]'),
  req('wall header', 'WP1', '[data-testid=kiosk-sentence-text]'),
  req('wall header', 'WP3', 'button[data-testid=kiosk-brand]'),
  // Timeline (wall and phone; WP4 reuses the markup)
  req('timeline', 'WP1', '[data-testid=nearby]'),
  req('timeline', 'WP1', '[data-testid=nearby-head]'),
  req('timeline', 'WP1', 'ol[data-testid=nearby-rows]'),
  req('timeline', 'WP1', 'li.nearby-row[data-id][data-kind][data-when][data-always][data-live][data-source]'),
  req('timeline', 'WP1', '.nearby-row .nearby-title'),
  req('timeline', 'WP1', '.nearby-row .nearby-when'),
  req('timeline', 'WP1', '.nearby-row .nearby-sub'),
  // Wall map
  req('wall map', 'WP2', '[data-testid=kiosk-map][data-map-status][data-zoom][data-pills][data-bodies][data-feed]'),
  req('wall map', 'WP2', '[data-testid=kiosk-map][data-markers][data-unlabelled]'),
  req('wall map', 'WP2', '[data-testid=kiosk-map] [data-symbol]'),
  req('wall map', 'WP2', '[data-testid=kiosk-map-host][data-frame][data-major-labels]'),
  req('wall map', 'WP1', '[data-testid=map-note]'),
  // Wall legend (WP1 mounts it, WP2 owns the keys)
  req('wall legend', 'WP1', '.k-map-legend'),
  // QR card
  req('QR card', 'WP1', '[data-testid=kiosk-qr]'),
  req('QR card', 'WP1', '[data-testid=kiosk-code]'),
  // Footer
  req('footer', 'WP1', '[data-testid=safety-strip]'),
  req('footer', 'WP1', '[data-testid=strip-verdict]'),
  req('footer', 'WP1', '[data-testid=strip-pharmacy] [data-symbol=pharmacy]'),
  req('footer', 'WP1', '[data-testid=strip-sources]'),
  // Setup
  req('setup', 'WP3', '[data-testid=kiosk-setup]'),
  req('setup', 'WP3', '[data-testid=setup-place]'),
  req('setup', 'WP3', '[data-testid=setup-suggestions]'),
  req('setup', 'WP3', '[data-testid=setup-suggestion]'),
  req('setup', 'WP3', '[data-testid=setup-preview]'),
  req('setup', 'WP3', '[data-testid=setup-create]'),
  // Settings (opened by a long press on kiosk-brand)
  req('settings', 'WP3', '[data-testid=kiosk-settings-panel]'),
  req('settings', 'WP3', '[data-testid=toggle-place]'),
  req('settings', 'WP3', '[data-testid=toggle-frame][data-value]'),
  req('settings', 'WP3', '[data-testid=toggle-view][data-value]'),
  req('settings', 'WP3', '[data-testid=toggle-theme]'),
  req('settings', 'WP3', '[data-testid=toggle-rhythm][data-value]'),
  // Read-only touch (D3)
  req('touch', 'WP2', '[data-testid=stop-board]'),
  // Phone
  req('phone Sada', 'WP4', '[data-testid=sada-place]'),
  req('phone Sada', 'WP4', '[data-testid=sada-sentence][data-kicker]'),
  req('phone Sada', 'WP4', '[data-testid=sada-map-band]'),
  req('phone Sada', 'WP4', '[data-testid=day-departures] > li.sada-departure[data-live]'),
  req('phone header', 'WP4', '[data-testid=share-city][data-action=share-city]'),
  req('phone header', 'WP4', '[data-testid=share-code]'),
  req('phone end', 'WP4', '[data-testid=session-ended]'),
  req('tabs', 'WP4', '[data-testid=tab-more]'),
  req('tabs', 'WP4', '[data-testid=dir-kultura]'),
  // Retired: asserted absent (16 names)
  ret('wall', 'WP1', '[data-testid=kiosk-highlight]'),
  ret('wall', 'WP1', '[data-testid=kiosk-panel-weather]'),
  ret('wall', 'WP1', '[data-testid=kiosk-ticker]'),
  ret('wall', 'WP3', '[data-testid=kiosk-theme]'),
  ret('wall', 'WP3', '[data-testid=kiosk-settings]'),
  ret('wall', 'WP1', '[data-testid=pair-copy]'),
  ret('wall', 'WP1', '[data-testid=corner-qr]'),
  ret('wall', 'WP1', '[data-testid=join-code]'),
  ret('wall', 'WP1', '[data-action=pause-highlights]'),
  ret('wall', 'WP1', '.k-highlight-credit'),
  ret('phone', 'WP4', '.day-stop-prompt'),
  ret('phone', 'WP4', '.city-filter-disclosure'),
  ret('phone', 'WP4', '.t-map-menu'),
  ret('phone', 'WP4', '[data-testid=frozen-line]'),
  ret('desktop', 'WP4', '.ki-domains'),
  ret('wall', 'WP0', '[data-testid=kiosk-stop-presentation]'),
]);

export interface ProbeTokens {
  testids: string[];
  classes: string[];
  /** data-* attribute names other than data-testid. */
  attrs: string[];
  /** Values of non-testid attributes written as `[data-x=value]`. */
  values: string[];
}

/** The names a selector asks for, split by how they appear in source. */
export function probeTokens(selector: string): ProbeTokens {
  const out: ProbeTokens = { testids: [], classes: [], attrs: [], values: [] };
  const withoutBrackets = selector.replace(/\[([^\]]*)\]/g, (_, body: string) => {
    const [name, value] = body.split('=');
    if (name === 'data-testid' && value) out.testids.push(value);
    else if (name.startsWith('data-')) {
      out.attrs.push(name);
      if (value) out.values.push(value);
    }
    return ' ';
  });
  for (const match of withoutBrackets.matchAll(/\.([A-Za-z][\w-]*)/g)) out.classes.push(match[1]);
  return out;
}

/** The one name a retired probe stands for: its test id, its class, or its attribute value. */
export function retiredName(selector: string): string {
  const t = probeTokens(selector);
  const name = t.testids[0] ?? t.classes[0] ?? t.values[0];
  if (!name) throw new Error(`retired probe without a name: ${selector}`);
  return name;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const camel = (attr: string): string => attr.replace(/^data-/, '').replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const wholeToken = (name: string): RegExp => new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`);

/** `data-testid="x"`, `[data-testid=x]`, `testid: 'x'`, `'data-testid': 'x'`, `dataset.testid = 'x'`, `setAttribute('data-testid', 'x')`. */
const testidPattern = (id: string): RegExp => new RegExp(`testid["']?\\s*[:=,]\\s*["'\`]?${escape(id)}(?![\\w-])`);
/** `data-kicker`, `dataset.kicker`, `dataset['kicker']`. */
const attrPattern = (attr: string): RegExp =>
  new RegExp(`${escape(attr)}(?![\\w-])|dataset\\.${camel(attr)}(?!\\w)|dataset\\[['"]${camel(attr)}['"]\\]`);

/** The tokens of a required probe that no source mentions (empty = the probe is emitted). */
export function missingTokens(selector: string, sources: readonly string[]): string[] {
  const t = probeTokens(selector);
  const checks: Array<[string, RegExp]> = [
    ...t.testids.map((id): [string, RegExp] => [`data-testid=${id}`, testidPattern(id)]),
    ...t.classes.map((c): [string, RegExp] => [`.${c}`, wholeToken(c)]),
    ...t.attrs.map((a): [string, RegExp] => [a, attrPattern(a)]),
    ...t.values.map((v): [string, RegExp] => [v, wholeToken(v)]),
  ];
  return checks.filter(([, re]) => !sources.some((source) => re.test(source))).map(([label]) => label);
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (name.endsWith('.ts')) out.push(rel);
  }
  return out;
}
/** The source as code: every comment dropped, string and template literals kept as written. */
export function withoutComments(file: string, source: string): string {
  return ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
}

const FILES = walk('app/src').sort();
const SOURCES = new Map(FILES.map((file) => [file, readFileSync(join(ROOT, file), 'utf8')] as const));
const CODE = [...SOURCES].map(([file, source]) => withoutComments(file, source));

describe('the probe contract itself', () => {
  it('lists 46 required probes and the 16 retired names of §15.6', () => {
    expect(PROBES.filter((p) => p.kind === 'required')).toHaveLength(46);
    expect(PROBES.filter((p) => p.kind === 'retired').map((p) => retiredName(p.selector))).toEqual([
      'kiosk-highlight', 'kiosk-panel-weather', 'kiosk-ticker', 'kiosk-theme', 'kiosk-settings', 'pair-copy',
      'corner-qr', 'join-code', 'pause-highlights', 'k-highlight-credit', 'day-stop-prompt',
      'city-filter-disclosure', 't-map-menu', 'frozen-line', 'ki-domains', 'kiosk-stop-presentation',
    ]);
  });
  it('carries dir-kultura and toggle-frame[data-value] among the required probes', () => {
    const required = PROBES.filter((p) => p.kind === 'required').map((p) => p.selector);
    expect(required).toContain('[data-testid=dir-kultura]');
    expect(required).toContain('[data-testid=toggle-frame][data-value]');
  });
  it('has one row per selector and every selector names something to scan for', () => {
    expect(new Set(PROBES.map((p) => p.selector)).size).toBe(PROBES.length);
    for (const p of PROBES) {
      const t = probeTokens(p.selector);
      expect(t.testids.length + t.classes.length + t.attrs.length, p.selector).toBeGreaterThan(0);
    }
  });
  it('reads the source forms app/src uses for test ids and data attributes', () => {
    expect(missingTokens('[data-testid=a-b]', ['<p data-testid="a-b">'])).toEqual([]);
    expect(missingTokens('[data-testid=a-b]', ["el.dataset.testid = 'a-b';"])).toEqual([]);
    expect(missingTokens('[data-testid=a-b]', ["attrs: { 'data-testid': 'a-b' }"])).toEqual([]);
    expect(missingTokens('[data-testid=a-b]', ['<p data-testid="a-b-c">'])).toEqual(['data-testid=a-b']);
    expect(missingTokens('li.row-x[data-valid-until]', ['<li class="row-x">', 'el.dataset.validUntil = s;'])).toEqual([]);
    expect(missingTokens('li.row-x[data-valid-until]', ['<li class="row-xy">'])).toEqual(['.row-x', 'data-valid-until']);
    expect(retiredName('[data-action=pause-highlights]')).toBe('pause-highlights');
  });
  it('reads code, not comments, for a required probe', () => {
    const code = withoutComments('x.ts', "// <li class=\"row-x\">\n/** data-testid=\"a-b\" */\nconst s = `<p data-testid=\"c-d\">`;");
    expect(missingTokens('.row-x', [code])).toEqual(['.row-x']);
    expect(missingTokens('[data-testid=a-b]', [code])).toEqual(['data-testid=a-b']);
    expect(missingTokens('[data-testid=c-d]', [code])).toEqual([]);
  });
});

const red: string[] = [];

describe('probe presence in app/src (red until the owning package lands)', () => {
  for (const probe of PROBES) {
    if (probe.kind === 'required') {
      it(`${probe.owner} emits ${probe.selector}`, () => {
        const missing = missingTokens(probe.selector, CODE);
        if (missing.length) red.push(`${probe.owner}  ${probe.surface.padEnd(12)}  emits    ${probe.selector}  (missing: ${missing.join(', ')})`);
        expect(missing, `${probe.owner} (${probe.surface}) must emit ${probe.selector}; nothing in app/src mentions ${missing.join(', ')}`).toEqual([]);
      });
    } else {
      it(`${probe.owner} retires ${probe.selector}`, () => {
        const name = retiredName(probe.selector);
        const re = wholeToken(name);
        const still = FILES.filter((file) => re.test(SOURCES.get(file)!));
        if (still.length) red.push(`${probe.owner}  ${probe.surface.padEnd(12)}  retires  ${probe.selector}  (still in: ${still.join(', ')})`);
        expect(still, `${probe.owner} must retire ${probe.selector}; '${name}' is still in ${still.join(', ')}`).toEqual([]);
      });
    }
  }
});

afterAll(() => {
  const lines = red.length
    ? [`Probe contract: ${red.length} of ${PROBES.length} probes red`, ...[...red].sort()]
    : [`Probe contract: all ${PROBES.length} probes green`];
  console.log(lines.join('\n'));
});
