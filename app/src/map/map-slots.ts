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
import type { CityMapHandle, MapFactory, MapLine, MapPoint } from './city-map';

export interface MapSlotOptions {
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
  /** Destroys every slot no `slot()` call has asked for since the last sweep. */
  sweep(): void;
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
        return existing.container;
      }
      const container = document.createElement('div');
      container.className = options.className;
      if (options.testid) container.dataset.testid = options.testid;
      const handle = factory({
        container,
        ariaLabel: options.ariaLabel,
        points: options.points,
        lines: options.lines,
        reducedMotion: options.reducedMotion,
      });
      slots.set(options.id, { container, handle, used: true });
      return container;
    },
    sweep() {
      for (const [id, slot] of [...slots]) {
        if (slot.used) slot.used = false;
        else drop(id, slot);
      }
    },
    destroy() {
      for (const [id, slot] of [...slots]) drop(id, slot);
    },
  };
}
