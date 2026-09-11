// Prose pages need no behaviour beyond the theme, the language toggle and the
// stylesheet; everything they say is in the HTML so it survives without JS.
import { bootPage } from '../boot';
import { createLanguageToggle } from '../i18n/toggle';
import '../ui/page.css';

const { i18n } = bootPage({ page: 'static' });
document.querySelector('[data-testid=lang-slot]')?.appendChild(createLanguageToggle(i18n));
