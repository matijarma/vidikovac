// Build step (vite.config.ts printMediaPlugin): a stylesheet that is nothing but `@media print { ... }` is linked
// with media="print", so it no longer blocks the first render of the page that imports it (ui/print.css on /d/
// and the static pages: 1.6 kB, render-blocking before, lane/v-lh P4). The browser still fetches it, at low
// priority, and applies it when printing (Ctrl+P and the export's printAct alike). A sheet with anything outside
// the print block is left as Vite wrote it.

/** Comments out, whitespace trimmed: nothing but one `@media print { … }` block, braces balanced to the end. */
export function printOnlyCss(css: string): boolean {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const head = /^@media\s+print\s*\{/.exec(body);
  if (!head) return false;
  let depth = 0;
  for (let i = head[0].length - 1; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i === body.length - 1;
    }
  }
  return false;
}

/** Adds media="print" to each `<link rel="stylesheet">` whose file (read through `cssOf`) is print-only. */
export function markPrintStylesheets(html: string, cssOf: (href: string) => string | undefined): string {
  return html.replace(/<link\b[^>]*>/g, (tag) => {
    if (!/\brel=["']?stylesheet\b/.test(tag) || /\bmedia=/.test(tag)) return tag;
    const href = /\bhref=["']([^"']+)["']/.exec(tag)?.[1];
    const css = href === undefined ? undefined : cssOf(href);
    return css !== undefined && printOnlyCss(css) ? tag.replace(/\s*\/?>$/, (end) => ` media="print"${end}`) : tag;
  });
}
