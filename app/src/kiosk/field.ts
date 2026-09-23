// The field: the one window onto the kvart (R-KP1). A labelled section whose
// only child is the map's box -- the controller re-hosts the one live map
// container into it and nothing else is ever drawn on the picture (the only
// overlay is MapLibre's attribution, which is the map's own child). No
// chapters, no chip, no rail, no swap: the field is built once with the
// composition and stands until the phase changes.
//
// Under lagano there is no map at all (R-L2), so the field is the lines board
// instead, exactly the board the paired Promet view and the old scene drew:
// `li.k-line` x BOARD_ROWS and a "još N" line (R-KP8 keeps the contract,
// e2e/lagano.spec.ts proves it in a real engine).
//
// The field also measures itself for the camera: fieldZoom (kiosk/mapview.ts)
// derives the zoom from the map host's laid-out width, so the composition,
// not a constant, decides how much ground the picture spans (R-KP2).
import type { FrameStops } from '../../../shared/city/frame';
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { ScreenStop } from '../core/contracts';
import type { I18n } from '../i18n/i18n';
import { linesMarkup } from './markup';
import { linesAtStop } from './local';
import type { KioskStrings } from './strings';

/** The lagano board's rows: ten fit the board's height with the overflow line at 1080p (R-V1, measured in e2e/lagano.spec.ts). */
export const BOARD_ROWS = 10;

export interface FieldDeps {
  /** R-L2: no map under lagano; the field is the lines board. */
  lightweight?: boolean;
}

export interface FieldModel {
  modules: readonly ModuleSnapshot[];
  stop: ScreenStop | null;
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
}

export interface FieldHandle {
  element: HTMLElement;
  /** The map's box, the one element the controller hosts the map container in; null under lagano, which has no map. */
  readonly mapHost: HTMLElement | null;
  /** The lagano lines board; null when the field carries a map. */
  readonly boardHost: HTMLElement | null;
  /** The map host's laid-out width in CSS px: fieldZoom's input. 0 before layout (a pre-paint mount, happy-dom) and under lagano, when the caller falls back to the composition's design width. */
  measureWidth(): number;
  /** The map host's laid-out height in CSS px: with the width, the ground the field shows, which sets the street names' padding (mapview.ts labelPadding). 0 before layout, as the width. */
  measureHeight(): number;
  /** Contract 3: how many distinct major street names the map has placed, written on the map host as data-major-labels for the e2e's proof (roads_labels_major, at most 8). */
  setMajorLabels(count: number): void;
  /** The probe contract (§15.6): the Kadar the map frames, 4, 6 or 8 stops, written on the map host as data-frame beside data-major-labels. Under lagano too: the hidden host keeps the selectors of both fields alike. */
  setFrame(frame: FrameStops): void;
  /** The field's label and, under lagano, the board. */
  update(model: FieldModel): void;
  destroy(): void;
}

export function mountField(host: HTMLElement, deps: FieldDeps = {}): FieldHandle {
  const lightweight = deps.lightweight === true;
  const element = document.createElement('section');
  element.className = 'k-field';
  element.dataset.testid = 'kiosk-live';
  if (lightweight) element.dataset.board = '1';
  // The hidden host stays in the lagano DOM so the same selectors read both fields; it is never measured and never hosts anything.
  element.innerHTML = `<div class="k-map-host" data-testid="kiosk-map-host"${lightweight ? ' hidden' : ''}></div>${lightweight ? '<div class="k-lines k-lines--board" data-testid="kiosk-lines"></div>' : ''}`;
  host.appendChild(element);
  const mapHostEl = element.querySelector<HTMLElement>('.k-map-host')!;
  const board = element.querySelector<HTMLElement>('.k-lines--board');
  let lastBoard = '';
  let lastLabel = '';
  return {
    element,
    mapHost: lightweight ? null : mapHostEl,
    boardHost: board,
    measureWidth: () => mapHostEl.clientWidth,
    measureHeight: () => mapHostEl.clientHeight,
    setMajorLabels(count) {
      const value = String(count);
      if (mapHostEl.dataset.majorLabels !== value) mapHostEl.dataset.majorLabels = value;
    },
    setFrame(frame) {
      const value = String(frame);
      if (mapHostEl.dataset.frame !== value) mapHostEl.dataset.frame = value;
    },
    update(model) {
      // The field is named by what it shows: the stop, or the lines title while the screen has no stop yet.
      const label = model.stop?.name ?? model.strings.lines.title;
      if (label !== lastLabel) {
        element.setAttribute('aria-label', label);
        lastLabel = label;
      }
      if (!board) return;
      const html = linesMarkup(linesAtStop(model.modules, model.stop, model.i18n, BOARD_ROWS), model.stop, model.strings, model.locale);
      if (html === lastBoard) return;
      board.innerHTML = html;
      lastBoard = html;
    },
    destroy() {
      element.remove();
    },
  };
}
