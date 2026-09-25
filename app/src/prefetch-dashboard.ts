// Build step (vite.config.ts dashboardGraphPlugin) and its runtime half: the /s/ page hands over to /d/, whose
// module graph (about 160 kB gzipped over a dozen files) is fetched only then, over the same link the check just
// used. The built /s/ page carries the graph's scripts as `<link rel="modulepreload">` inside an inert
// `<template id="dashboard-graph">` at the end of its body, and app/src/entries/scan.ts moves them into the head
// only while the page will stay a while: no code in the fragment (the person is about to scan or type) or a code
// the room refused. A code on its way to /d/ warms nothing: on a slow link the warm-up took the connections the
// redemption needed and the answer came later than with no warm-up at all (round 3 review, B1). Modulepreload,
// not prefetch, because across the navigation Chromium revalidates and reuses (a 304 per file) only what was
// loaded as a module; a prefetch link or a fetch() of the same file was fetched again in full (the probe in
// review.local/companion/iterate/round3/phone/harness/prefetch-probe3.spec.ts). Stylesheets are not warmed.

/** What the plugin reads of Rollup's bundle: entry chunks, their static imports and the modules they hold. */
export interface BundleChunkLike {
  type: 'chunk' | 'asset';
  fileName: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  /** The chunk's modules by id: an HTML entry's chunk has the page's own html as its facade and the entry script inside. */
  modules?: Readonly<Record<string, unknown>>;
  imports?: readonly string[];
  viteMetadata?: { importedCss?: Set<string> | readonly string[] };
}

/** The template's id on /s/, and the mark it carries once its links have been moved into the head. */
export const DASHBOARD_GRAPH_ID = 'dashboard-graph';

/** Every file of the entry's static graph in load order (the entry first, then its imports, depth first), and its stylesheets. */
export function staticGraph(bundle: Readonly<Record<string, BundleChunkLike>>, entryFileName: string): { scripts: string[]; styles: string[] } {
  const scripts: string[] = [];
  const styles = new Set<string>();
  const visit = (name: string): void => {
    if (scripts.includes(name)) return;
    const chunk = bundle[name];
    if (!chunk || chunk.type !== 'chunk') return;
    scripts.push(name);
    for (const css of chunk.viteMetadata?.importedCss ?? []) styles.add(css);
    for (const imported of chunk.imports ?? []) visit(imported);
  };
  visit(entryFileName);
  return { scripts, styles: [...styles] };
}

/** The entry chunk carrying the module whose id ends with `entrySuffix` ("/entries/dashboard.ts"): Vite's HTML entries
 *  keep the page's html as the chunk's facade and the entry script among its modules. */
export function entryChunkFor(bundle: Readonly<Record<string, BundleChunkLike>>, entrySuffix: string): BundleChunkLike | undefined {
  return Object.values(bundle).find((chunk) => chunk.type === 'chunk' && chunk.isEntry === true
    && ((chunk.facadeModuleId ?? '').endsWith(entrySuffix) || Object.keys(chunk.modules ?? {}).some((id) => id.endsWith(entrySuffix))));
}

/** One inert link per script of the graph, as the template carries them. */
export function dashboardGraphLinks(html: string, bundle: Readonly<Record<string, BundleChunkLike>>, entrySuffix = '/entries/dashboard.ts'): string[] {
  const entry = entryChunkFor(bundle, entrySuffix);
  if (!entry) return [];
  const own = (file: string): boolean => html.includes(`/${file}"`) || html.includes(`/${file}'`);
  return staticGraph(bundle, entry.fileName).scripts.filter((file) => !own(file))
    .map((file) => `<link rel="modulepreload" crossorigin fetchpriority="low" href="/${file}">`);
}

/**
 * The inert template with the graph's links appended before `</body>` of `html`; scripts the page already links are
 * skipped, and a page with no `</body>`, a bundle without that entry or a graph with nothing to add is returned as it was.
 */
export function withDashboardGraph(html: string, bundle: Readonly<Record<string, BundleChunkLike>>, entrySuffix = '/entries/dashboard.ts'): string {
  if (!html.includes('</body>')) return html;
  const links = dashboardGraphLinks(html, bundle, entrySuffix);
  if (links.length === 0) return html;
  return html.replace('</body>', `<template id="${DASHBOARD_GRAPH_ID}">\n${links.join('\n')}\n</template>\n</body>`);
}

/**
 * The runtime half: moves the template's links into the head, once; the browser then fetches and compiles /d/'s
 * scripts at the lowest priority. Returns how many links it added: 0 when the page has no template, or already did.
 */
export function activateDashboardGraph(doc: Document): number {
  const template = doc.getElementById(DASHBOARD_GRAPH_ID);
  if (!template || !('content' in template) || template.getAttribute('data-active') === '1') return 0;
  template.setAttribute('data-active', '1');
  const links = [...(template as HTMLTemplateElement).content.querySelectorAll('link')];
  for (const link of links) doc.head.appendChild(doc.importNode(link, true));
  return links.length;
}
