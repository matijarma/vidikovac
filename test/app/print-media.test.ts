// ui/print.css is entirely `@media print`, yet Vite linked it as an ordinary stylesheet, so it blocked the first
// render of /d/ and the static pages (lane/v-lh P4). The build marks such a sheet media="print"
// (app/src/print-media.ts through vite.config.ts): fetched at low priority, applied when printing, never blocking.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markPrintStylesheets, printOnlyCss } from '../../app/src/print-media';

const PRINT_CSS = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'print.css'), 'utf8');

describe('printOnlyCss', () => {
  it('ui/print.css as written is print-only', () => {
    expect(printOnlyCss(PRINT_CSS)).toBe(true);
  });
  it('the minified form Vite writes, and a comment before the block', () => {
    expect(printOnlyCss('@media print{.a{display:none!important}:root{color-scheme:light!important}}')).toBe(true);
    expect(printOnlyCss('/* x */ @media print { .a { b: c } }\n')).toBe(true);
  });
  it('anything outside the block, another medium, or unbalanced braces is not', () => {
    expect(printOnlyCss('@media print{.a{b:c}}.d{e:f}')).toBe(false);
    expect(printOnlyCss('.d{e:f}@media print{.a{b:c}}')).toBe(false);
    expect(printOnlyCss('@media screen{.a{b:c}}')).toBe(false);
    expect(printOnlyCss('@media print and (min-width: 1px){.a{b:c}}')).toBe(false);
    expect(printOnlyCss('@media print{.a{b:c}')).toBe(false);
    expect(printOnlyCss('')).toBe(false);
  });
});

describe('markPrintStylesheets', () => {
  const files: Record<string, string> = {
    '/assets/print-B9EY0c1t.css': '@media print{.ki-head{display:none!important}}',
    '/assets/d-B2rfwNAk.css': '.ki{display:grid}@media print{.ki{display:block}}',
  };
  const html = '<head><link rel="stylesheet" crossorigin href="/assets/d-B2rfwNAk.css">\n<link rel="stylesheet" crossorigin href="/assets/print-B9EY0c1t.css">\n<link rel="modulepreload" crossorigin href="/assets/print-x.js"><link rel="stylesheet" href="/assets/print-B9EY0c1t.css" media="all"></head>';
  const out = markPrintStylesheets(html, (href) => files[href]);
  it('marks the print-only sheet and nothing else', () => {
    expect(out).toContain('<link rel="stylesheet" crossorigin href="/assets/print-B9EY0c1t.css" media="print">');
    expect(out).toContain('<link rel="stylesheet" crossorigin href="/assets/d-B2rfwNAk.css">');
    expect(out).toContain('<link rel="modulepreload" crossorigin href="/assets/print-x.js">');
  });
  it('never overrides a media the page wrote itself, and leaves an unknown file alone', () => {
    expect(out).toContain('href="/assets/print-B9EY0c1t.css" media="all">');
    expect(markPrintStylesheets('<link rel="stylesheet" href="/nowhere.css">', () => undefined)).toBe('<link rel="stylesheet" href="/nowhere.css">');
  });
});
