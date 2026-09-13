// One live map per panel, kept across renders.
//
// The dashboard rebuilds its layer sections on every 20-second poll. When each
// render called the map factory again, every poll allocated a new WebGL
// context: Chrome keeps about sixteen and then starts losing the oldest, so
// after roughly five minutes of a ten-minute session the map panel went black,
// and any pan or zoom the person had made was thrown away four times a minute
// (final review I3, R-54).
//
// A slot owns the container element as well as the map handle. A render asks
// for the slot by id and gets the same element back, moved into the new
// section, with the new points and lines pushed through update(). Whatever no
// render asked for between two sweeps is destroyed.
import type { CityMapHandle, CityMapOptions, MapFactory, MapLine, MapPoint } from './city-map';

/** Everything a CityMapOptions carries beyond the slot's own fields passes
 *  straight through to the factory the first time the slot is made (theme,
 *  locale, camera, the screen's stop, the selection and the callbacks), so
 *  a layer that owns a slot drives the map it gets back through `handle(id)`. */
export type MapSlotPassthrough = Omit<CityMapOptions, 'container' | 'ariaLabel' | 'points' | 'lines' | 'reducedMotion'>;

export interface MapSlotOptions extends MapSlotPassthrough {
  /** Stable per panel: the same id must mean the same map for the page's life. */
  id: string;
  ariaLabel: string;
  className: string;
  testid?: string;
  points: MapPoint[];
  lines: MapLine[];
  reducedMotion?: boolean;
}

export interface MapSlots {
  /** The container for this map, or null when the page has no map factory. */
  slot(options: MapSlotOptions): HTMLElement | null;
  /** The live map behind a slot, for the layer that owns it to select,
   *  follow and fit; null before the slot exists or without a factory. */
  handle(id: string): CityMapHandle | null;
  /** Destroys every slot no `slot()` call has asked for since the last sweep. */
  sweep(): void;
  /** Pauses every live map's motion (a frozen dashboard, R-F6). */
  pause(): void;
  destroy(): void;
}

interface Slot {
  container: HTMLElement;
  handle: CityMapHandle;
  used: boolean;
}

export function createMapSlots(factory: MapFactory | undefined): MapSlots {
  const slots = new Map<string, Slot>();

  function drop(id: string, slot: Slot): void {
    slot.handle.destroy();
    slot.container.remove();
    slots.delete(id);
  }

  return {
    slot(options) {
      if (!factory) return null;
      const existing = slots.get(options.id);
      if (existing) {
        existing.used = true;
        existing.container.setAttribute('aria-label', options.ariaLabel);
        existing.handle.update(options.points, options.lines);
        // The per-render inputs a persistent map still takes: the resolved
        // theme, the locale and the screen's stop. Each optional on the
        // handle (a stub factory in a test need not implement them) and
        // idempotent on the real one.
        if (options.theme !== undefined) existing.handle.setTheme?.(options.theme);
        if (options.locale !== undefined) existing.handle.setLocale?.(options.locale);
        if (options.stop !== undefined) existing.handle.setStop?.(options.stop);
        return existing.container;
      }
      const container = document.createElement('div');
      container.className = options.className;
      if (options.testid) container.dataset.testid = options.testid;
      const { id: _id, className: _className, testid: _testid, ...rest } = options;
      const handle = factory({ ...rest, container });
      slots.set(options.id, { container, handle, used: true });
      return container;
    },
    handle(id) {
      return slots.get(id)?.handle ?? null;
    },
    sweep() {
      for (const [id, slot] of [...slots]) {
        if (slot.used) slot.used = false;
        else drop(id, slot);
      }
    },
    pause() {
      for (const slot of slots.values()) slot.handle.pause();
    },
    destroy() {
      for (const [id, slot] of [...slots]) drop(id, slot);
    },
  };
}
