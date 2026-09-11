// Prozor: the public screen. Teaser mode rotates cards above a fixed safety
// strip and shows the rotating QR; unlocked mode renders the driver's layer with
// a small corner QR so the next person can join. Nothing here talks to the
// network directly: every dependency is injected.
import type { Attribution, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { CodeSlot, LayerId } from '../../worker/protocol';
import { fetchData as fetchDataImpl, fetchTeaser as fetchTeaserImpl } from './api';
import {
  createBeaconClient,
  parseProvisionHash,
  readBeacon,
  storeBeacon,
  type BeaconClient,
  type BeaconClientDeps,
  type BeaconCredentials,
} from './beacon';
import { codeUrl, formatCode, speakableCode } from './code';
import type { I18n } from './i18n/i18n';
import { LAYER_MODULES, renderLayer } from './layers';
import type { MapFactory } from './map/city-map';
import { createRotation, slotProgress } from './rotation';
import { createSessionClient, type SessionClient } from './session';
import { dataNumber, dataText } from './panels/panel';
import { createQr } from './ui/qr';
import { escapeHtml } from './ui/dom/escape';
// Task A10's ckan-geo module (the only open-tier feed poi items come from)
// covers city districts and civil-protection assembly points only; nothing in
// its registered layers is ever tagged as a pharmacy, so the `category`
// filter below can never match a real snapshot. Until Area A ships a tagged
// pharmacy layer, the curated on-duty list already built for /hitno (task
// D1) is the honest stand-in: it is real Grad Zagreb data, not a fixture.
import { LJEKARNE } from '../../worker/hitno/ljekarne';

/** Cross-fade interval for the teaser cards. */
export const TEASER_ROTATE_MS = 20_000;
/** Segments drawn instead of a sweep under prefers-reduced-motion. */
export const RING_SEGMENTS = 6;

export interface TeaserCard {
  id: 'weather' | 'departures' | 'air' | 'news' | 'invitation';
  title: string;
  body: string;
  attribution?: Attribution;
}

function byModule(modules: readonly ModuleSnapshot[]): Partial<Record<ModuleId, ModuleSnapshot>> {
  const out: Partial<Record<ModuleId, ModuleSnapshot>> = {};
  for (const snapshot of modules) out[snapshot.module] = snapshot;
  return out;
}

export function teaserCards(modules: readonly ModuleSnapshot[], i18n: I18n, _now: number): TeaserCard[] {
  const map = byModule(modules);
  const observation = map['dhmz-now']?.items[0];
  const temp = dataNumber(observation, 'temp');
  const news = map['hrt-news']?.items[0];
  return [
    {
      id: 'weather',
      title: i18n.t('kiosk.teaserWeather'),
      body: observation
        ? `${temp === null ? i18n.t('common.unavailable') : i18n.t('panels.temperature', { value: temp })} · ${dataText(observation, 'weather') || observation.title}`
        : i18n.t('status.loading'),
      attribution: map['dhmz-now']?.attribution,
    },
    // Departures need a GTFS stop per venue; the feature lands after stage 1 and
    // the card says so rather than showing an empty timetable.
    { id: 'departures', title: i18n.t('kiosk.teaserDepartures'), body: i18n.t('kiosk.teaserSoon') },
    { id: 'air', title: i18n.t('kiosk.teaserAir'), body: i18n.t('kiosk.teaserSoon') },
    {
      id: 'news',
      title: i18n.t('kiosk.teaserNews'),
      body: news ? news.title : i18n.t('status.loading'),
      attribution: map['hrt-news']?.attribution,
    },
    { id: 'invitation', title: i18n.t('common.appName'), body: i18n.t('kiosk.invitation') },
  ];
}

export function safetyStripText(
  modules: readonly ModuleSnapshot[],
  i18n: I18n,
): { cap: string; closures: string; pharmacy: string } {
  const map = byModule(modules);
  const warning = map['dhmz-cap']?.items[0];
  const closures = (map.prometnice?.items ?? []).filter((item) => item.kind === 'closure').length;
  const pharmacy = (map['ckan-geo']?.items ?? []).find((item) => dataText(item, 'category') === 'ljekarne');
  // Every curated entry runs both the day and the night duty shift (or, for
  // Ljekarna ZEUS, is open outright 0-24), so none is ever "more on duty" than
  // another at a given moment; with no per-kiosk location to rank by
  // distance, the first entry is a stable, always-true answer rather than an
  // arbitrary one.
  const onDuty = LJEKARNE[0];
  return {
    cap: warning
      ? `${i18n.t(`panels.severity.${warning.severity ?? 'info'}`)} · ${warning.title}`
      : i18n.t('panels.capNone'),
    closures: i18n.t('panels.closuresCount', { count: closures }),
    pharmacy: pharmacy ? pharmacy.title : onDuty ? onDuty.label : i18n.t('status.empty'),
  };
}

export interface KioskDeps {
  i18n: I18n;
  hash: string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  now?: () => number;
  codeBase?: string;
  reducedMotion?: boolean;
  mapFactory?: MapFactory;
  fetchTeaser?: () => Promise<{ modules: ModuleSnapshot[] }>;
  fetchData?: (module: ModuleId, token: string) => Promise<ModuleSnapshot>;
  createBeacon?: (deps: BeaconClientDeps) => BeaconClient;
  createSession?: (options: { roomId: string; ticket: string }) => SessionClient;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  requestFullscreen?: () => Promise<void>;
  requestWakeLock?: () => Promise<void>;
}

export interface KioskHandle {
  element: HTMLElement;
  destroy(): void;
}

export function mountKiosk(root: HTMLElement, deps: KioskDeps): KioskHandle {
  const { i18n } = deps;
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((h) => globalThis.clearInterval(h as never));

  const element = document.createElement('div');
  element.className = 'kiosk';
  element.dataset.testid = 'kiosk';
  element.dataset.mode = 'teaser';
  element.innerHTML = `
    <p class="kiosk-alert" role="alert" data-testid="kiosk-alert" hidden></p>
    <section class="kiosk-stage" data-testid="kiosk-stage">
      <div class="kiosk-teaser">
        <article class="teaser-card" data-testid="teaser-card"></article>
      </div>
      <aside class="kiosk-code">
        <div class="code-ring" data-testid="code-ring" data-motion="${deps.reducedMotion ? 'segments' : 'sweep'}"></div>
        <div class="kiosk-qr" data-testid="kiosk-qr"></div>
        <p class="kiosk-code-label">${escapeHtml(i18n.t('kiosk.codeLabel'))}</p>
        <p class="kiosk-code-value"><span data-testid="code-a"></span><span class="code-dash">-</span><span data-testid="code-b"></span></p>
        <p class="kiosk-code-hint">${escapeHtml(i18n.t('kiosk.typeCode'))}</p>
      </aside>
      <div class="kiosk-layer" data-testid="kiosk-layer" hidden></div>
      <div class="corner-qr" data-testid="corner-qr" hidden></div>
    </section>
    <footer class="kiosk-safety" data-testid="safety-strip"></footer>`;
  root.appendChild(element);

  const alertBox = element.querySelector<HTMLElement>('[data-testid=kiosk-alert]')!;
  const teaserCard = element.querySelector<HTMLElement>('[data-testid=teaser-card]')!;
  const qrBox = element.querySelector<HTMLElement>('[data-testid=kiosk-qr]')!;
  const cornerQr = element.querySelector<HTMLElement>('[data-testid=corner-qr]')!;
  const ring = element.querySelector<HTMLElement>('[data-testid=code-ring]')!;
  const codeA = element.querySelector<HTMLElement>('[data-testid=code-a]')!;
  const codeB = element.querySelector<HTMLElement>('[data-testid=code-b]')!;
  const layerBox = element.querySelector<HTMLElement>('[data-testid=kiosk-layer]')!;
  const strip = element.querySelector<HTMLElement>('[data-testid=safety-strip]')!;

  let teaser: ModuleSnapshot[] = [];
  let cards: TeaserCard[] = [];
  let cardIndex = 0;
  let currentCode: string | null = null;
  let currentSlotRef: CodeSlot | null = null;
  let session: SessionClient | null = null;
  let sessionSnapshots: Partial<Record<ModuleId, ModuleSnapshot>> = {};
  let activeLayer: LayerId = 'grad-sada';
  let unlockedToken: string | null = null;

  // The teaser fetch and the beacon socket are two independent failure
  // domains sharing one alert line. Each keeps its own entry in this map
  // instead of one shared flag, so a fix in one can never erase a warning
  // the other is still raising (e.g. the beacon going live again while the
  // teaser fetch is still failing), and a source's own resolved outage
  // always self-heals even while another source is also complaining. When
  // more than one is active, the worst (most blocking) one wins the single
  // visible line; clearing it reveals whatever is still active underneath.
  type AlertSource = 'provision' | 'revoked' | 'beacon' | 'teaser';
  const ALERT_PRIORITY: readonly AlertSource[] = ['provision', 'revoked', 'beacon', 'teaser'];
  const activeAlerts = new Map<AlertSource, string>();

  function renderAlert(): void {
    const source = ALERT_PRIORITY.find((candidate) => activeAlerts.has(candidate));
    if (source === undefined) {
      alertBox.hidden = true;
      return;
    }
    alertBox.hidden = false;
    alertBox.textContent = i18n.t(activeAlerts.get(source)!);
  }

  function showAlert(key: string, source: AlertSource): void {
    activeAlerts.set(source, key);
    renderAlert();
  }

  function clearAlert(source: AlertSource): void {
    if (!activeAlerts.delete(source)) return;
    renderAlert();
  }

  function paintTeaser(): void {
    const card = cards[cardIndex % Math.max(1, cards.length)];
    if (!card) return;
    teaserCard.classList.remove('is-in');
    teaserCard.innerHTML = `<h2 class="teaser-title">${escapeHtml(card.title)}</h2>
      <p class="teaser-body">${escapeHtml(card.body)}</p>
      ${card.attribution ? `<p class="teaser-attr">${escapeHtml(card.attribution.text)}</p>` : ''}`;
    // Restart the cross-fade by forcing a reflow before re-adding the class.
    void teaserCard.offsetWidth;
    teaserCard.classList.add('is-in');
  }

  function paintStrip(): void {
    const parts = safetyStripText(teaser, i18n);
    strip.innerHTML = `<span>${escapeHtml(i18n.t('kiosk.teaserCap'))}: ${escapeHtml(parts.cap)}</span>
      <span>${escapeHtml(i18n.t('kiosk.teaserClosures'))}: ${escapeHtml(parts.closures)}</span>
      <span>${escapeHtml(i18n.t('kiosk.safety'))}: ${escapeHtml(parts.pharmacy)}</span>`;
  }

  function paintRing(): void {
    if (deps.reducedMotion) {
      const filled = currentSlotRef ? Math.round(slotProgress(currentSlotRef, rotation.serverNow()) * RING_SEGMENTS) : 0;
      ring.innerHTML = Array.from(
        { length: RING_SEGMENTS },
        (_, i) => `<span class="ring-segment" data-testid="ring-segment" data-on="${i < filled ? 'true' : 'false'}"></span>`,
      ).join('');
      return;
    }
    ring.innerHTML = '<span class="ring-sweep"></span>';
  }

  function paintCode(): void {
    if (!currentCode) return;
    const display = formatCode(currentCode);
    codeA.textContent = display.slice(0, 4);
    codeB.textContent = display.slice(5);
    const spoken = speakableCode(currentCode);
    const qr = createQr({
      payload: codeUrl(currentCode, deps.codeBase),
      ariaLabel: i18n.t('kiosk.qrLabel', { code: spoken }),
      unavailableText: display,
    });
    qrBox.replaceChildren(qr.element);
    if (element.dataset.mode === 'unlocked') {
      const small = createQr({
        payload: codeUrl(currentCode, deps.codeBase),
        ariaLabel: i18n.t('kiosk.qrLabel', { code: spoken }),
        unavailableText: display,
      });
      cornerQr.replaceChildren(small.element);
    }
    paintRing();
  }

  function paintLayer(): void {
    layerBox.replaceChildren(
      renderLayer(activeLayer, {
        i18n,
        snapshots: sessionSnapshots,
        now: now(),
        kiosk: true,
        mapFactory: deps.mapFactory,
        reducedMotion: deps.reducedMotion,
      }),
    );
  }

  function setMode(mode: 'teaser' | 'unlocked'): void {
    element.dataset.mode = mode;
    layerBox.hidden = mode !== 'unlocked';
    cornerQr.hidden = mode !== 'unlocked';
    if (mode === 'teaser') {
      layerBox.replaceChildren();
      paintTeaser();
    }
  }

  async function refreshSessionData(): Promise<void> {
    const fetchData = deps.fetchData ?? ((module: ModuleId, token: string) => fetchDataImpl(module, token));
    if (!unlockedToken) return;
    const results = await Promise.allSettled(LAYER_MODULES[activeLayer].map((id) => fetchData(id, unlockedToken!)));
    for (const result of results) if (result.status === 'fulfilled') sessionSnapshots[result.value.module] = result.value;
    paintLayer();
  }

  async function loadTeaser(): Promise<void> {
    const fetchTeaser = deps.fetchTeaser ?? (() => fetchTeaserImpl());
    try {
      const response = await fetchTeaser();
      clearAlert('teaser'); // this poll succeeded: any outage it raised is over
      teaser = response.modules;
      cards = teaserCards(teaser, i18n, now());
      paintTeaser();
      paintStrip();
    } catch {
      showAlert('status.down', 'teaser');
    }
  }

  const rotation = createRotation({
    now,
    onSlot: (slot) => {
      currentSlotRef = slot;
      currentCode = slot?.code ?? null;
      if (slot) paintCode();
    },
    onMore: () => beacon?.requestMore(),
    setInterval: setTimer as (fn: () => void, ms: number) => unknown,
    clearInterval: clearTimer,
  });

  const credentials: BeaconCredentials | null = parseProvisionHash(deps.hash) ?? readBeacon(deps.storage);
  if (parseProvisionHash(deps.hash)) storeBeacon(deps.storage, credentials!);

  let beacon: BeaconClient | null = null;
  if (!credentials) {
    showAlert('kiosk.notProvisioned', 'provision');
  } else {
    const makeBeacon = deps.createBeacon ?? ((d: BeaconClientDeps) => createBeaconClient(d));
    beacon = makeBeacon({
      credentials,
      onCodes: (batchSlots, serverNow) => rotation.setBatch(batchSlots, serverNow),
      onUnlocked: ({ roomId, ticket }) => {
        // The corner QR keeps minting codes throughout an active session so
        // the next person can join; a second redeem mid-session (BeaconDO's
        // redeem() always opens a fresh room, task B6) must not leak the
        // still-open RoomDO connection from the session it is replacing.
        session?.close();
        const makeSession = deps.createSession ?? ((o: { roomId: string; ticket: string }) => createSessionClient(o));
        session = makeSession({ roomId, ticket });
        session.onJoined((snapshot) => {
          unlockedToken = snapshot.dataToken;
          setMode('unlocked');
          paintCode();
          void refreshSessionData();
        });
        session.onView((layer) => {
          activeLayer = layer;
          paintLayer();
          void refreshSessionData();
        });
        session.onExpired(() => {
          session = null;
          unlockedToken = null;
          sessionSnapshots = {};
          setMode('teaser');
        });
        session.connect();
      },
      onRevoked: () => showAlert('kiosk.revoked', 'revoked'),
      onStatus: (status) => {
        if (status === 'offline') showAlert('kiosk.offline', 'beacon');
        else if (status === 'live') clearAlert('beacon');
      },
    });
    beacon.connect();
  }

  // First tap only: a kiosk browser grants fullscreen and the wake lock on a
  // user gesture, and never asks again.
  const onFirstTap = (): void => {
    element.removeEventListener('pointerdown', onFirstTap);
    void (deps.requestFullscreen ?? (() => document.documentElement.requestFullscreen()))().catch(() => {});
    void (deps.requestWakeLock ?? (async () => {
      await (navigator as { wakeLock?: { request(type: 'screen'): Promise<unknown> } }).wakeLock?.request('screen');
    }))().catch(() => {});
  };
  element.addEventListener('pointerdown', onFirstTap);

  paintRing();
  paintStrip();
  void loadTeaser();
  const rotateTimer = setTimer(() => {
    if (element.dataset.mode === 'teaser') {
      cardIndex += 1;
      paintTeaser();
    }
    void loadTeaser();
  }, TEASER_ROTATE_MS);

  return {
    element,
    destroy() {
      rotation.stop();
      clearTimer(rotateTimer);
      beacon?.close();
      session?.close();
      element.remove();
    },
  };
}
