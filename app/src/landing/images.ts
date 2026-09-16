import type { I18n } from '../i18n/i18n';
import type { ResolvedTheme } from '../ui/theme';

/** Rewrite only the locale/theme portion: preserve art direction, srcset
 *  widths, lazy loading, and each figure's independently chosen sizes. */
export function syncCaptureImages(root: ParentNode, i18n: I18n, theme: ResolvedTheme): void {
  const locale = i18n.getLocale() === 'en' ? 'en' : 'hr';
  for (const picture of root.querySelectorAll<HTMLElement>('picture[data-capture]')) {
    const rewrite = (value: string) => value.replace(/-(hr|en)-(light|dark)-/g, `-${locale}-${theme}-`);
    for (const node of picture.querySelectorAll('source, img')) {
      for (const attribute of ['src', 'srcset']) {
        const current = node.getAttribute(attribute);
        if (current && rewrite(current) !== current) node.setAttribute(attribute, rewrite(current));
      }
      if (node instanceof HTMLImageElement && node.dataset.captureAlt) {
        node.alt = i18n.t(`landing.alt.${node.dataset.captureAlt}`);
      }
    }
  }
}

export function watchCaptureErrors(root: ParentNode, i18n: I18n): () => void {
  const cleanups: (() => void)[] = [];
  for (const picture of root.querySelectorAll<HTMLElement>('picture[data-capture]')) {
    const img = picture.querySelector('img');
    if (!img) continue;
    function failed() {
      if (picture.querySelector('.ld-media-error')) return;
      picture.dataset.failed = '1';
      const message = document.createElement('span');
      message.className = 'ld-media-error';
      message.dataset.i18n = 'landing.imageUnavailable';
      message.textContent = i18n.t('landing.imageUnavailable');
      picture.appendChild(message);
    }
    function loaded() {
      delete picture.dataset.failed;
      picture.querySelector('.ld-media-error')?.remove();
    }
    img.addEventListener('error', failed);
    img.addEventListener('load', loaded);
    if (img.complete && img.naturalWidth === 0) failed();
    cleanups.push(() => { img.removeEventListener('error', failed); img.removeEventListener('load', loaded); });
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
