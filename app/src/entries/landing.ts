// Static content is the page. This entry enhances locale/theme, image
// selection, four-chapter motion, and the separately labelled public data.
import { fetchTeaser } from '../api';
import { bootPage } from '../boot';
import { syncCaptureImages, watchCaptureErrors } from '../landing/images';
import { mountLandingLive, type LandingLive } from '../landing/live';
import { mountStory, type StoryHandle } from '../landing/story';
import { detectLagano, markLagano } from '../ui/lagano';
import '../ui/base.css';
import '../ui/signage.css';

function storage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}
function canWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const available = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return available;
  } catch { return false; }
}

if (typeof document !== 'undefined' && document.body?.classList.contains('ld-page')) {
  const lightweight = detectLagano({
    search: location.search, storage: storage(),
    navigator: { deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory },
    matchMedia: (query) => window.matchMedia(query), canWebgl,
  });
  markLagano(document.documentElement, lightweight);
  let live: LandingLive | undefined;
  let story: StoryHandle | undefined;
  const { i18n, theme } = bootPage({
    page: 'landing',
    onLocaleChange: () => { sync(); live?.repaint(); story?.refresh(); },
  });

  function sync() {
    syncCaptureImages(document, i18n, theme.getResolvedTheme());
    document.title = `Kaj ima? · ${i18n.t('landing.title')}`;
    document.querySelector('meta[name=description]')?.setAttribute('content', i18n.t('landing.description'));
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', i18n.t('landing.description'));
    document.querySelector('meta[property="og:locale"]')?.setAttribute('content', i18n.getLocale() === 'en' ? 'en_GB' : 'hr_HR');
  }
  sync();
  const offTheme = theme.onChange(sync);
  const offImages = watchCaptureErrors(document, i18n);
  if (!lightweight) void import('../ui/fonts.css');
  story = mountStory(document, lightweight);

  const healthControllers = new Set<AbortController>();
  async function fetchHealth(): Promise<{ ok?: boolean; time?: string }> {
    const controller = new AbortController();
    healthControllers.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('health-unavailable');
      return await response.json() as { ok?: boolean; time?: string };
    } finally {
      window.clearTimeout(timeout);
      healthControllers.delete(controller);
    }
  }
  live = mountLandingLive({ root: document, i18n, fetchTeaser, fetchHealth });
  live.setPageVisible(!document.hidden);
  const region = document.querySelector('[data-live-region]');
  let observer: IntersectionObserver | undefined;
  if (region && typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      live?.setVisible(entries.some((entry) => entry.isIntersecting));
    }, { rootMargin: '160px 0px', threshold: 0 });
    observer.observe(region);
  } else {
    live.setVisible(true);
  }
  const onVisibility = () => live?.setPageVisible(!document.hidden);
  const onPageShow = () => { onVisibility(); story?.refresh(); };
  const onPageHide = (event: PageTransitionEvent) => {
    live?.setPageVisible(false);
    if (event.persisted) return;
    live?.destroy(); story?.destroy(); observer?.disconnect();
    offTheme(); offImages(); theme.destroy();
    healthControllers.forEach((controller) => controller.abort());
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide, { once: false });
  window.addEventListener('pageshow', onPageShow);
}
