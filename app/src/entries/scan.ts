// Page entry for /s/. The page's five stylesheets (tokens, base, signage, scan,
// qrScanner) are <link>s in app/s/index.html's <head>, so the first paint is
// styled before this module has even been fetched. base.css and signage.css
// are imported here as well: test/app/signage-css.test.ts pins that the entry
// of every page showing a badge imports the signage sheet directly after
// base.css, one contract across the entries. Rollup keeps one copy of each
// module, so the built page links every sheet once, in the head's order; only
// Vite's dev server paints the two a second time, after scan.css, which is why
// scan.css never relies on following base.css at equal specificity. The entry
// adds what a link cannot: the toast sheet for bootPage's queue, and the one
// Manrope family as a dynamic import, so the font sheet arrives after the
// first paint and never in front of it. With the theme module in <head> these
// are the page's only two scripts, both external (R-16).
import { bootPage } from '../boot';
import { createScanPage, type ScanPageHandle } from '../scan';
import { isQrScanSupported } from '../ui/qrScanner';
import '../ui/base.css';
import '../ui/signage.css';
import '../ui/toast.css';

const root = document.querySelector<HTMLElement>('#scan')!;
// The fragment is read once: after the first attempt the code is spent, so a
// language switch must not re-post it.
let hash = location.hash;

const { i18n } = bootPage({ page: 'scan', onLocaleChange: () => remount() });
let page = mount();
void import('../ui/fonts.css');

function mount(): ScanPageHandle {
  const handle = createScanPage(root, {
    i18n,
    hash,
    navigate: (url) => {
      location.assign(url);
    },
    scannerSupported: isQrScanSupported(),
  });
  hash = '';
  return handle;
}

function remount(): void {
  page.destroy();
  page = mount();
}
