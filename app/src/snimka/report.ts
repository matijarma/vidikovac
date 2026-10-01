// The report of /snimka/: the hero numbers, Zaslon, Tijek and Što se vidjelo.
// Lane S3 replaces this file; until then the mount only marks the report's
// slots as ready so the page never stays busy.
import type { Mount } from './context';

export const mountReport: Mount = (_ctx, root) => {
  for (const el of root.querySelectorAll<HTMLElement>('[data-sn-mount]:not([data-sn-mount="stage"]), [data-sn="kpis"]')) el.removeAttribute('aria-busy');
  return () => {};
};
