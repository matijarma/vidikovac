// Progressive choreography: each chapter's words and static image exist
// before JS. The sticky stage is decorative and never owns focus or content.
export interface StoryHandle { refresh(): void; destroy(): void }

/** Read actual geometry so fast scrolls and history/anchor jumps cannot leave
 *  a scene behind. Not a scroll listener: called by the intersection observer. */
export function chapterAtLine(boxes: readonly { top: number; bottom: number }[], line: number): number {
  if (!boxes.length) return 0;
  const containing = boxes.findIndex((box) => box.top <= line && box.bottom > line);
  if (containing >= 0) return containing;
  return boxes.reduce((best, box, index) => Math.abs(box.top - line) < Math.abs(boxes[best]!.top - line) ? index : best, 0);
}

export function mountStory(doc: Document = document, lightweight = false): StoryHandle {
  const win = doc.defaultView;
  const body = doc.body;
  const stage = doc.querySelector<HTMLElement>('[data-story-stage]');
  const chapters = [...doc.querySelectorAll<HTMLElement>('.ld-chapter')];
  if (!win || !stage || !chapters.length || typeof win.IntersectionObserver !== 'function') {
    return { refresh() {}, destroy() {} };
  }
  const wide = win.matchMedia('(min-width: 60rem) and (min-height: 45rem)');
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  let observer: IntersectionObserver | null = null;
  let reveal: IntersectionObserver | null = null;
  let resize: ResizeObserver | null = null;
  let enabled = false;
  let observedHeight = 0;
  let destroyed = false;
  let raf = 0;
  const animations = new Set<Animation>();
  const seen = new WeakSet<Element>();

  function selectScene() {
    if (!enabled || destroyed) return;
    const line = win!.innerHeight * .5;
    const boxes = chapters.map((chapter) => chapter.getBoundingClientRect());
    stage!.dataset.chapter = String(chapterAtLine(boxes, line));
  }
  function refresh() {
    if (destroyed) return;
    const header = doc.querySelector<HTMLElement>('.ld-head');
    const headerHeight = header?.getBoundingClientRect().height ?? 80;
    body.style.setProperty('--ld-header-height', `${headerHeight}px`);
    const rootSize = Number.parseFloat(win!.getComputedStyle(doc.documentElement).fontSize);
    const fits = chapters.every((chapter) => (chapter.querySelector('.ld-chapter-copy')?.getBoundingClientRect().height ?? Infinity) < win!.innerHeight - headerHeight - 100);
    const next = !lightweight && !reduced.matches && wide.matches && rootSize <= 20 && fits;
    if (next !== enabled || (next && observedHeight !== win!.innerHeight)) {
      observer?.disconnect();
      enabled = next;
      if (enabled) {
        // A narrow horizontal observation band selects the chapter at the
        // viewport midpoint, independently of chapter height or scroll speed.
        observedHeight = win!.innerHeight;
        const margin = Math.floor(observedHeight * .48);
        observer = new win!.IntersectionObserver(selectScene, { rootMargin: `-${margin}px 0px -${margin}px 0px`, threshold: 0 });
        chapters.forEach((chapter) => observer!.observe(chapter));
        body.dataset.storyMotion = '1';
      } else {
        delete body.dataset.storyMotion;
        animations.forEach((animation) => animation.cancel());
        animations.clear();
      }
    }
    selectScene();
  }
  function scheduleRefresh() {
    if (!raf) raf = win!.requestAnimationFrame(() => { raf = 0; refresh(); });
  }
  function stopAnimations() {
    if (reduced.matches) {
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    }
    scheduleRefresh();
  }

  // Short, once-only reveals leave no hidden content if the API fails.
  reveal = new win.IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || seen.has(entry.target)) continue;
      seen.add(entry.target);
      reveal?.unobserve(entry.target);
      if (lightweight || reduced.matches || typeof entry.target.animate !== 'function') continue;
      if (enabled && entry.target.closest('.ld-chapter')) continue;
      const animation = entry.target.animate([
        { opacity: .45, transform: 'translateY(14px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 480, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      animations.add(animation);
      void animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
    }
  }, { threshold: .12 });
  doc.querySelectorAll('.ld-chapter-figure, .ld-feature').forEach((el) => reveal!.observe(el));
  if (typeof win.ResizeObserver === 'function') {
    resize = new win.ResizeObserver(scheduleRefresh);
    const header = doc.querySelector('.ld-head');
    if (header) resize.observe(header);
    chapters.forEach((chapter) => {
      const copy = chapter.querySelector('.ld-chapter-copy');
      if (copy) resize!.observe(copy);
    });
  }
  wide.addEventListener('change', scheduleRefresh);
  reduced.addEventListener('change', stopAnimations);
  win.addEventListener('resize', scheduleRefresh);
  win.addEventListener('pageshow', scheduleRefresh);
  win.addEventListener('hashchange', scheduleRefresh);
  refresh();
  void doc.fonts?.ready.then(scheduleRefresh);
  return {
    refresh: scheduleRefresh,
    destroy() {
      destroyed = true;
      observer?.disconnect(); reveal?.disconnect(); resize?.disconnect();
      win.cancelAnimationFrame(raf);
      animations.forEach((animation) => animation.cancel());
      wide.removeEventListener('change', scheduleRefresh);
      reduced.removeEventListener('change', stopAnimations);
      win.removeEventListener('resize', scheduleRefresh);
      win.removeEventListener('pageshow', scheduleRefresh);
      win.removeEventListener('hashchange', scheduleRefresh);
      delete body.dataset.storyMotion;
    },
  };
}
