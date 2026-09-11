// R-16: the CSP is `script-src 'self'` with no inline script anywhere, so the
// decision that must happen before first paint ships as its own tiny module,
// loaded from <head> on every page. It writes data-theme and
// data-theme-resolved on <html> (the stored preference, the OS answer for
// 'auto', the Zagreb sun for 'solar') and then detaches its listeners: the
// controller the page keeps is the one bootPage() creates a moment later.
import { createThemeController } from '../ui/theme';

createThemeController().destroy();
