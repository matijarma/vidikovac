// Prose pages need no behaviour beyond the theme, the lightweight signal and
// the stylesheets; everything they say is in the HTML so it survives without
// JS. The prose is Croatian only (no translation, no toggle), so this entry
// never touches document.documentElement.lang: lang="hr" stays as written.
import { detectLagano, markLagano } from '../ui/lagano';
import { createThemeController } from '../ui/theme';
import '../ui/signage.css';
import '../ui/page.css';
import '../ui/print.css';

function safeLocalStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

// A WebGL context is the cheapest real probe for an old or weak GPU, which
// deviceMemory and prefers-reduced-data both miss on their own.
function canWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl'));
  } catch { return false; }
}

// Decided once, here, and passed down as a dependency exactly like every other entry (R-L1).
const lightweight = detectLagano({
  search: location.search,
  storage: safeLocalStorage(),
  navigator: { deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory },
  matchMedia: (query) => globalThis.matchMedia(query),
  canWebgl,
});
markLagano(document.documentElement, lightweight);
// The head module resolved the theme before first paint; this controller keeps `auto` and `solar` live while the page is open.
createThemeController();
// The one Manrope family stays off the lightweight graph (R-F3).
if (!lightweight) void import('../ui/fonts.css');
