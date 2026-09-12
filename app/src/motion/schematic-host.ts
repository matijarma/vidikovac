// One schematic per page, kept for the page's whole life -- the motion
// analogue of map/map-slots.ts. A dashboard rebuilds its layer sections on
// every poll and a kiosk repaints its stage every twenty seconds; if each
// render mounted a fresh view, every poll would throw away every vehicle's
// fix history and speed estimate -- the very evidence the motion model
// converges from (R-P2) -- and start all over again from the reported
// positions. So the page creates one host, the render moves its stable
// element into whatever panel or slot the current markup has, and hands it
// this poll's evidence through update().
//
// The host also owns the network artefact's arrival: fetched once, lazily,
// on the first mount() (after first paint, never from an entry chunk, and
// never at all in lightweight mode -- R-L4), with a loading line until it
// settles and the view mounted -- with the real crop, which for a session
// is the whole network and needs the geometry to compute -- only once it
// has. Whatever update() arrived meanwhile is replayed into the new view.
//
// And it carries the honesty note under the map, verbatim: the user-facing
// statement of R-P2, on both surfaces, not optional.
import type { I18n } from '../i18n/i18n';
import { escapeHtml } from '../ui/dom/escape';
import { loadNetwork, type Network } from './network';
import { DEFAULT_CROP, ROUTE_TYPE_TRAM, wholeNetworkCrop, type Crop } from './schematic';
import { mountSchematicView, type SchematicUpdate, type SchematicViewHandle } from './schematic-view';

/** R-P2's user-facing sentence, pinned here as a constant so the test that
 *  guards the verbatim wording reads the same source the page does. The
 *  catalogue carries it under motion.note; the two must agree. */
export const HONESTY_NOTE_HR = 'Položaj je izračunat iz vlastitih očitanja svakog vozila i geometrije linije; ZET ne objavljuje smjer ni brzinu.';

/** R-P1: a locked kiosk shows trams only by default. */
export const TRAMS_ONLY: ReadonlySet<number> = new Set([ROUTE_TYPE_TRAM]);

export type SchematicScope =
  /** A locked kiosk: the screen's configured centre and radius (DEFAULT_CROP
   *  until per-screen configuration exists, R-P1) and the types it shows. */
  | { kind: 'crop'; crop?: Crop; types?: ReadonlySet<number> | null }
  /** A session: the whole network, every type. */
  | { kind: 'network'; types?: ReadonlySet<number> | null };

export interface SchematicHostDeps {
  i18n: I18n;
  scope: SchematicScope;
  /** R-L1: decided once at the entry and passed down, exactly like `reducedMotion`. */
  lightweight: boolean;
  reducedMotion?: boolean;
  now?: () => number;
  /** ui/canvas.ts's `repaintOn` contract; forwarded to the view. */
  onRepaint?: (listener: () => void) => () => void;
  /** Defaults to network.ts's loadNetwork over the page's own fetch. A page
   *  with two hosts (the kiosk: the locked stage and the unlocked layer)
   *  passes one memoised loader so the artefact is fetched once. */
  loadNetwork?: () => Promise<Network | null>;
  /** See SchematicViewDeps: closes an open tap card on an idle public screen. */
  cardIdleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Loop internals, injectable for tests. */
  raf?: (cb: (t: number) => void) => number;
  cancel?: (h: number) => void;
}

export interface SchematicHost {
  /** Stable for the host's life; the caller moves it into the current render. */
  readonly element: HTMLElement;
  /** Starts the network load on the first call; returns `element` every time. */
  mount(): HTMLElement;
  /** This poll's evidence. Kept and replayed if the view is not mounted yet. */
  update(data: SchematicUpdate, now?: number): void;
  /** Stops requesting frames (a hidden stage, a frozen session). */
  pause(): void;
  resume(): void;
  destroy(): void;
}

export function createSchematicHost(deps: SchematicHostDeps): SchematicHost {
  const { i18n, scope } = deps;
  const lightweight = Boolean(deps.lightweight);
  const load = deps.loadNetwork ?? (() => loadNetwork(fetch, lightweight));
  const types = scope.types === undefined ? (scope.kind === 'crop' ? TRAMS_ONLY : null) : scope.types;

  const element = document.createElement('div');
  element.className = 'schematic-host';
  element.dataset.testid = 'schematic-host';
  element.innerHTML = `<div class="schematic-slot" data-testid="schematic-slot"></div>
    <p class="schematic-note" data-testid="schematic-note">${escapeHtml(i18n.t('motion.note'))}</p>`;
  const slot = element.querySelector<HTMLElement>('[data-testid=schematic-slot]')!;

  let started = false;
  let destroyed = false;
  let paused = false;
  let view: SchematicViewHandle | null = null;
  let pending: { data: SchematicUpdate; at: number | undefined } | null = null;

  function cropFor(net: Network | null): Crop {
    if (scope.kind === 'crop') return scope.crop ?? DEFAULT_CROP;
    return net ? wholeNetworkCrop(net, types) : DEFAULT_CROP;
  }

  function mountView(net: Network | null): void {
    if (destroyed || view) return;
    slot.replaceChildren();
    view = mountSchematicView(slot, {
      i18n,
      net,
      crop: cropFor(net),
      types,
      lightweight,
      reducedMotion: deps.reducedMotion,
      now: deps.now,
      onRepaint: deps.onRepaint,
      cardIdleMs: deps.cardIdleMs,
      setTimer: deps.setTimer,
      clearTimer: deps.clearTimer,
      raf: deps.raf,
      cancel: deps.cancel,
    });
    if (pending) {
      view.update(pending.data, pending.at);
      pending = null;
    }
    if (paused) view.pause();
  }

  return {
    element,
    mount() {
      if (started) return element;
      started = true;
      if (lightweight) {
        // R-L4: no artefact request at all; the list mounts at once, empty
        // of stops it cannot know, honest about the vehicles it can count.
        mountView(null);
      } else {
        slot.innerHTML = `<p class="schematic-legend" data-testid="schematic-loading">${escapeHtml(i18n.t('status.loading'))}</p>`;
        // loadNetwork() resolves null on every failure, so this only ever
        // rejects if the injected loader itself throws synchronously-late;
        // even then the honest state is a view with no geometry, not a
        // loading line that never goes away.
        load().then(mountView, () => mountView(null));
      }
      return element;
    },
    update(data, now) {
      if (view) view.update(data, now);
      else pending = { data, at: now };
    },
    pause() {
      paused = true;
      view?.pause();
    },
    resume() {
      paused = false;
      view?.resume();
    },
    destroy() {
      destroyed = true;
      view?.destroy();
      view = null;
      element.remove();
    },
  };
}
