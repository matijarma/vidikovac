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
// Read before mount() spends the fragment: whether a code is on its way to /d/.
const codeOnItsWay = codeFromHash(hash) !== null;
let page = mount();
// The one Manrope family: at once when the person is going to read this page, and only after FONTS_BEHIND_CODE_MS
// when a code came in the fragment, since that page hands over to /d/ within a second or two and its five font
// files (105 kB) were sharing a slow link with the check and with /d/'s own graph (round 3, phone F3). A check
// that fails, or crawls, still gets its fonts once the wait is over.
const FONTS_BEHIND_CODE_MS = 3_000;
if (!codeOnItsWay) void import('../ui/fonts.css');
else setTimeout(() => { void import('../ui/fonts.css'); }, FONTS_BEHIND_CODE_MS);

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
