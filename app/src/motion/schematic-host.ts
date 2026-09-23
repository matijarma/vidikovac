// One schematic per page, kept for the page's whole life -- the motion
// analogue of map/map-slots.ts. A dashboard rebuilds its layer sections on
// every poll and a kiosk repaints its stage every twenty seconds; if each
// render mounted a fresh view, every poll would throw away every mark's
// drawn position and its convergence onto the twin's plan (R-P2) and start
// all over again from the reported positions. So the page creates one host, the render moves its stable
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
import hr from '../i18n/hr.json';
import type { I18n } from '../i18n/i18n';
import { escapeHtml } from '../ui/dom/escape';
import { loadNetwork, type Network } from '../../../shared/motion/network';
import type { Fix } from './integrator';
import { DEFAULT_CROP, ROUTE_TYPE_TRAM, wholeNetworkCrop, type Crop } from './schematic';
import { mountSchematicView, type SchematicUpdate, type SchematicViewHandle } from './schematic-view';

/** R-P2's user-facing sentence in Croatian: the catalogue's motion.note,
 *  the one source the page renders (the host prints i18n.t('motion.note')),
 *  exported so the test that guards the verbatim wording reads it. */
export const HONESTY_NOTE_HR: string = hr.motion.note;

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
  /** The artefact fetched past the HTTP cache once the motion names another
   *  graph than the one drawn on (city-map.ts's option of the same name);
   *  defaults to loadNetwork over fetch with cache: 'reload'. */
  reloadNetwork?: () => Promise<Network | null>;
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
  /** The network the view was mounted on, and the graph the motion names (city-map.ts acceptNetwork). */
  let net: Network | null = null;
  let expectedNetwork: string | undefined;
  let networkBlocked = false;
  let networkRequest: Promise<void> | null = null;
  const loadingLine = `<p class="schematic-legend" data-testid="schematic-loading">${escapeHtml(i18n.t('status.loading'))}</p>`;

  function cropFor(net: Network | null): Crop {
    if (scope.kind === 'crop') return scope.crop ?? DEFAULT_CROP;
    return net ? wholeNetworkCrop(net, types) : DEFAULT_CROP;
  }

  function mountView(loaded: Network | null): void {
    if (destroyed || view) return;
    net = loaded;
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
    if (paused) view.pause();
    // Evidence that landed meanwhile may already name a newer graph than the
    // cached artefact: reconciled before the first arc, as the map does.
    if (pending && acceptNetwork(pending.data.fixes)) {
      view.update(pending.data, pending.at);
      pending = null;
    }
  }

  /** Never evaluate a new arc on old rails, the city map's acceptNetwork on
   *  this surface (review of D3, finding 3): a fix naming another graph than
   *  the view was mounted on takes the view down to the loading line, marks
   *  the host stale and reloads the artefact with cache: 'reload'; the view is
   *  remounted on the graph when its hash is the one named, and the evidence
   *  kept meanwhile replayed into it. A failed or wrong-graph load retries at
   *  the next update(). A lightweight host never fetches (R-L4). */
  function acceptNetwork(fixes: readonly Fix[]): boolean {
    if (lightweight) return true;
    expectedNetwork = fixes.find((f) => f.network)?.network ?? expectedNetwork;
    const drawnOn = net && 'graphHash' in net ? net.graphHash : undefined;
    if (!expectedNetwork || (drawnOn === expectedNetwork && !networkBlocked)) return true;
    if (!networkBlocked) {
      networkBlocked = true;
      element.dataset.networkStale = 'true';
      view?.destroy();
      view = null;
      slot.innerHTML = loadingLine;
    }
    if (!networkRequest) {
      const requested = expectedNetwork;
      const reload = deps.reloadNetwork ?? (() => loadNetwork((input, init) => fetch(input, { ...init, cache: 'reload' })));
      networkRequest = (async () => {
        const loaded = await reload();
        if (destroyed || requested !== expectedNetwork || !loaded || !('graphHash' in loaded) || loaded.graphHash !== expectedNetwork) return;
        networkBlocked = false;
        delete element.dataset.networkStale;
        mountView(loaded);
      })().catch(() => {
        // Last-good geometry is not usable for this payload. Retry next update().
      }).finally(() => {
        networkRequest = null;
        if (!destroyed && requested !== expectedNetwork && pending) acceptNetwork(pending.data.fixes);
      });
    }
    return false;
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
        slot.innerHTML = loadingLine;
        // loadNetwork() resolves null on every failure, so this only ever
        // rejects if the injected loader itself throws synchronously-late;
        // even then the honest state is a view with no geometry, not a
        // loading line that never goes away.
        load().then(mountView, () => mountView(null));
      }
      return element;
    },
    update(data, now) {
      // Before the artefact has settled the evidence waits for the view; once
      // it has, or while a replacement graph is on its way, the graph the
      // evidence names is checked first (and a failed reload retried).
      if ((view || networkBlocked) && acceptNetwork(data.fixes) && view) {
        view.update(data, now);
        return;
      }
      pending = { data, at: now };
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
