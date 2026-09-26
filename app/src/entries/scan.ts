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
import { scan as scanRequest } from '../api';
import { bootPage } from '../boot';
import { activateDashboardGraph } from '../prefetch-dashboard';
import { codeFromHash, createScanPage, type ScanPageHandle } from '../scan';
import { isQrScanSupported } from '../ui/qrScanner';
import '../ui/base.css';
import '../ui/signage.css';
import '../ui/toast.css';

const root = document.querySelector<HTMLElement>('#scan')!;
// The fragment is read once: after the first attempt the code is spent, so a
// language switch must not re-post it.
let hash = location.hash;

const { i18n } = bootPage({ page: 'scan', onLocaleChange: () => remount() });
// Read before mount() spends the fragment: a code on its way is posted at mount, and the page hands over to /d/
// the moment the room answers.
const codeOnItsWay = codeFromHash(hash) !== null;
let page = mount();
// The one Manrope family, at once: a slow link never finishes it before the hop and the hop cancels it, a fast link
// has it cached for /d/, which then never swaps its fonts (round 3 review, N3).
void import('../ui/fonts.css');
// /d/'s scripts are warmed only while this page will stay a while: no code on its way (the person is about to scan
// or type, seconds the link is idle) and after a refused code (the same). Never beside a redemption in flight: on a
// narrow link the eleven files took the connections the check needed, and the answer came later than with no
// warm-up at all (round 3 review, B1). The links come inert from the build (prefetch-dashboard.ts).
if (!codeOnItsWay) activateDashboardGraph(document);

function mount(): ScanPageHandle {
  const handle = createScanPage(root, {
    i18n,
    hash,
    navigate: (url) => {
      location.assign(url);
    },
    scannerSupported: isQrScanSupported(),
    scan: async (code) => {
      const result = await scanRequest(code);
      if ('error' in result) activateDashboardGraph(document);
      return result;
    },
  });
  hash = '';
  return handle;
}

function remount(): void {
  page.destroy();
  page = mount();
}
