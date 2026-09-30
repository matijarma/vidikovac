// Page entry for /dev/, DEV mode's grid (worker/routes/dev.ts describes DEV; core/dev-mode.ts
// keeps the flag). Opening the page turns DEV on for the tab by itself, and every frame and link
// on it carries ?DEV. Four frames side by side, each at its own size scaled to its cell: the wall
// at 1920 x 1080, the phone at 390 x 844, the desk at 1280 x 800 and Hitno at 390 x 844. The two
// /d/ frames hold a DEV session each; the wall shows this network's DEV screen, which both steer.
import { bootPage } from '../boot';
import { showDev, turnDevOn } from '../core/dev-mode';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import '../ui/tokens.css';
import '../ui/base.css';
import '../ui/dev.css';

const FRAMES = [
  { id: 'screen', src: '/kiosk/?DEV', width: 1920, height: 1080 },
  { id: 'phone', src: '/d/?DEV', width: 390, height: 844 },
  { id: 'desktop', src: '/d/?DEV', width: 1280, height: 800 },
  { id: 'hitno', src: '/hitno?DEV', width: 390, height: 844 },
] as const;

const { i18n } = bootPage({ page: 'dev' });
try { turnDevOn(window.sessionStorage); } catch { /* storage disabled: the frames carry ?DEV all the same */ }
showDev(i18n, 'all');

const root = document.querySelector<HTMLElement>('#dev-grid')!;
const cols = FRAMES.map((frame) => `minmax(0, ${(frame.width / frame.height).toFixed(4)}fr)`).join(' ');
// The labels are catalogue words, looked up by literal key so the catalogue's reader test sees each.
const LABELS: Record<(typeof FRAMES)[number]['id'], string> = {
  screen: i18n.t('dev.screen'), phone: i18n.t('dev.phone'), desktop: i18n.t('dev.desktop'), hitno: i18n.t('dev.hitno'),
};
root.innerHTML = `<h1 class="visually-hidden">${escapeHtml(i18n.t('dev.all'))}</h1>`
  + `<div class="dev-cells" style="--cols: ${cols}">`
  + FRAMES.map((frame) => `<figure class="dev-cell" data-testid="dev-cell" data-surface="${frame.id}" style="--w: ${frame.width}; --h: ${frame.height}">`
    + `<figcaption>${escapeHtml(LABELS[frame.id])} · ${frame.width} × ${frame.height}</figcaption>`
    + `<div class="dev-frame-box"><iframe src="${escapeAttribute(frame.src)}" title="${escapeAttribute(LABELS[frame.id])}" width="${frame.width}" height="${frame.height}" data-testid="dev-frame" data-surface="${frame.id}"></iframe></div>`
    + `</figure>`).join('')
  + `</div>`;

// Each frame is scaled to its cell's width; the cell's aspect ratio gives the height.
const fit = (box: HTMLElement): void => {
  const width = Number(box.parentElement?.style.getPropertyValue('--w')) || 1;
  box.style.setProperty('--k', String(box.clientWidth / width));
};
const boxes = [...root.querySelectorAll<HTMLElement>('.dev-frame-box')];
const observer = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => { for (const entry of entries) fit(entry.target as HTMLElement); }) : null;
for (const box of boxes) { fit(box); observer?.observe(box); }
if (!observer) window.addEventListener('resize', () => boxes.forEach(fit));
