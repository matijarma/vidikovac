// Page entry for /s/. R-16: with the theme module in <head> these are the page's
// only two scripts, both external. R-37: an entry imports the three shared
// stylesheets plus the component stylesheets its page actually uses.
import { bootPage } from '../boot';
import { createScanPage, type ScanPageHandle } from '../scan';
import { isQrScanSupported } from '../ui/qrScanner';
import '../ui/tokens.css';
import '../ui/base.css';
import '../ui/fonts.css';
import '../ui/toast.css';
import '../ui/qrScanner.css';
import '../ui/scan.css';

const root = document.querySelector<HTMLElement>('#scan')!;
// The fragment is read once: after the first attempt the code is spent, so a
// language switch must not re-post it.
let hash = location.hash;

const { i18n } = bootPage({ page: 'scan', onLocaleChange: () => remount() });
let page = mount();

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
