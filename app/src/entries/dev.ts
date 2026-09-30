// Page entry for /dev/, DEV mode's grid (worker/routes/dev.ts describes DEV; core/dev-mode.ts
// keeps the flag). Opening the page turns DEV on for the tab by itself, and every frame and link
// on it carries ?DEV. A header with the wordmark and its DEV mark ("Kaj ima?dev"), then the four
// surfaces two by two, each drawn at its own size and scaled to its cell: the wall at 1920 x 1080
// and the phone at 390 x 844 in the first row, Hitno on the phone at 390 x 844 and the desk at
// 1280 x 800 in the second, wide then narrow, narrow then wide (ui/dev.css fits them to the
// window). The two /d/ frames hold a DEV session each; the wall shows this network's DEV screen,
// which both steer.
import { bootPage } from '../boot';
import { devMarkSlot, showDev, turnDevOn } from '../core/dev-mode';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import '../ui/tokens.css';
import '../ui/base.css';
import '../ui/dev.css';

/** In reading order, which is the grid's order: row by row, and the one column of a narrow window. */
const FRAMES = [
  { id: 'screen', src: '/kiosk/?DEV', width: 1920, height: 1080 },
  { id: 'phone', src: '/d/?DEV', width: 390, height: 844 },
  { id: 'hitno', src: '/hitno?DEV', width: 390, height: 844 },
  { id: 'desktop', src: '/d/?DEV', width: 1280, height: 800 },
] as const;
type FrameId = (typeof FRAMES)[number]['id'];

const { i18n } = bootPage({ page: 'dev' });
try { turnDevOn(window.sessionStorage); } catch { /* storage disabled: the frames carry ?DEV all the same */ }
// The × leaves for the home page: /dev/ itself would only turn DEV on again.
void showDev(i18n, 'all', { offHref: '/' });

// The frames' aspect ratios, which ui/dev.css turns into the two rows' heights and the three columns.
const ratio = (id: FrameId): string => {
  const frame = FRAMES.find((f) => f.id === id)!;
  return (frame.width / frame.height).toFixed(4);
};
// The labels are catalogue words, looked up by literal key so the catalogue's reader test sees each.
const LABELS: Record<FrameId, string> = {
  screen: i18n.t('dev.screen'), phone: i18n.t('dev.phone'), desktop: i18n.t('dev.desktop'), hitno: i18n.t('dev.hitno'),
};
const name = i18n.t('common.appName');
const stem = name.endsWith('?') ? name.slice(0, -1) : name;
const head = document.createElement('header');
head.className = 'dev-head';
head.dataset.testid = 'dev-head';
head.innerHTML = `<a class="dev-brand" href="/">${escapeHtml(stem)}${name.endsWith('?') ? '<span class="dev-brand-mark">?</span>' : ''}</a>${devMarkSlot()}`;
document.body.prepend(head);

const root = document.querySelector<HTMLElement>('#dev-grid')!;
root.innerHTML = `<h1 class="visually-hidden">${escapeHtml(i18n.t('dev.all'))}</h1>`
  + `<div class="dev-cells" data-testid="dev-cells" style="--rw: ${ratio('screen')}; --rp: ${ratio('phone')}; --rd: ${ratio('desktop')}">`
  + FRAMES.map((frame) => `<figure class="dev-cell" data-testid="dev-cell" data-surface="${frame.id}" style="--w: ${frame.width}; --h: ${frame.height}">`
    + `<figcaption>${escapeHtml(LABELS[frame.id])} · ${frame.width} × ${frame.height}</figcaption>`
    + `<div class="dev-frame-box"><iframe src="${escapeAttribute(frame.src)}" title="${escapeAttribute(LABELS[frame.id])}" width="${frame.width}" height="${frame.height}" data-testid="dev-frame" data-surface="${frame.id}"></iframe></div>`
    + `</figure>`).join('')
  + `</div>`;

// Each frame is scaled to its cell's width; the cell's aspect ratio gives the height.
const fit = (box: HTMLElement): void => {
  const width = Number(box.parentElement?.style.getPropertyValue('--w')) || 1;
  box.style.setProperty('--scale', String(box.clientWidth / width));
};
const boxes = [...root.querySelectorAll<HTMLElement>('.dev-frame-box')];
const observer = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => { for (const entry of entries) fit(entry.target as HTMLElement); }) : null;
for (const box of boxes) { fit(box); observer?.observe(box); }
if (!observer) window.addEventListener('resize', () => boxes.forEach(fit));
