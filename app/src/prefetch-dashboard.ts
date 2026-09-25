// Build step (vite.config.ts dashboardPrefetchPlugin): the /s/ page hands over to /d/ within a second or two of a
// scan, and /d/'s module graph (about 160 kB gzipped over twenty files) was fetched only then, over the same slow
// link the check had just used (round 3, phone F3: the /d/ shell 2 s behind the hop on slow 4G). The built /s/
// page therefore carries one `<link rel="modulepreload">` per script of /d/'s static graph and one
// `<link rel="prefetch">` per stylesheet, at the end of its body, after the page's own scripts. Modulepreload,
// not prefetch, for the scripts: across the navigation Chromium revalidates and reuses only what was loaded as a
// module (a 304 per file), while a `rel="prefetch"` or a plain fetch() of the same file was fetched again in full
// (round 3, the probe in review.local/companion/iterate/round3/phone/harness/prefetch-probe3.spec.ts). Files /s/
// links itself are left out.

/** What the plugin reads of Rollup's bundle: entry chunks, their static imports and the stylesheets they carry. */
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

/**
 * The warm-up links for `entrySuffix`'s graph appended before `</body>` of `html`: modulepreload for its scripts,
 * prefetch for its stylesheets. Files the page already links are skipped, and a page with no `</body>` or a bundle
 * without that entry is returned as it was.
 */
export function withDashboardPrefetch(html: string, bundle: Readonly<Record<string, BundleChunkLike>>, entrySuffix = '/entries/dashboard.ts'): string {
  const entry = entryChunkFor(bundle, entrySuffix);
  if (!entry || !html.includes('</body>')) return html;
  const { scripts, styles } = staticGraph(bundle, entry.fileName);
  const own = (file: string): boolean => html.includes(`/${file}"`) || html.includes(`/${file}'`);
  const links = [
    ...scripts.filter((file) => !own(file)).map((file) => `<link rel="modulepreload" crossorigin href="/${file}">`),
    ...styles.filter((file) => !own(file)).map((file) => `<link rel="prefetch" as="style" href="/${file}">`),
  ];
  if (links.length === 0) return html;
  return html.replace('</body>', `${links.join('\n')}\n</body>`);
}
