// The homepage is not a session. Only the public teaser and health endpoint
// are read, when this region is in view. Source freshness and warning
// severity are independent; a stale safety feed cannot certify an all-clear.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { TeaserResponse } from '../api';
import type { I18n } from '../i18n/i18n';
import { vehicleCount } from '../layers/shared';

export type Freshness = 'loading' | 'live' | 'stale' | 'down';
export interface StripLine {
  text: string;
  detail: string;
  freshness: Freshness;
  severity: 'normal' | 'warning';
}
export type StripTexts = Record<'weather' | 'safety' | 'transit', StripLine>;
export const LIVE_INTERVAL_MS = 60_000;
const DISPLAYED = ['dhmz-now', 'zet-rt', 'dhmz-cap'] as const;

export function sourceFreshness(snapshot: ModuleSnapshot | undefined): Freshness {
  if (!snapshot || snapshot.status === 'down') return 'down';
  if (snapshot.status === 'stale' || Object.values(snapshot.sources ?? {}).some((s) => s.status !== 'live')) return 'stale';
  return 'live';
}

function readableModules(value: unknown): ModuleSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ModuleSnapshot => {
    if (!entry || typeof entry !== 'object') return false;
    const m = entry as Partial<ModuleSnapshot>;
    return DISPLAYED.some((id) => id === m.module)
      && ['live', 'stale', 'down'].includes(m.status ?? '')
      && Array.isArray(m.items)
      && m.items.every((item) => item !== null && typeof item === 'object' && typeof item.kind === 'string');
  });
}

function timestamp(value: string | undefined, i18n: I18n): string {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed)
    ? new Intl.DateTimeFormat(i18n.getLocale() === 'en' ? 'en-GB' : 'hr-HR', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zagreb',
    }).format(parsed)
    : '';
}

function sourceDetail(snapshot: ModuleSnapshot, i18n: I18n, observation?: string): string {
  const observed = timestamp(observation, i18n);
  if (observed) return i18n.t('landing.live.measured', { time: observed });
  const source = timestamp(snapshot.sourceUpdatedAt, i18n);
  if (source) return i18n.t('landing.live.sourceAt', { time: source });
  const fetched = timestamp(snapshot.fetchedAt, i18n);
  return fetched ? i18n.t('landing.live.fetchedAt', { time: fetched }) : '';
}

export function liveStripTexts(modules: readonly ModuleSnapshot[], now: number, i18n: I18n): StripTexts {
  const by = (id: ModuleSnapshot['module']) => modules.find((m) => m.module === id);
  const unavailable = (): StripLine => ({ text: i18n.t('landing.live.unavailable'), detail: '', freshness: 'down', severity: 'normal' });
  let weather = unavailable();
  const obs = by('dhmz-now');
  const reading = obs?.items.find((item) => typeof item.data?.temp === 'number' && Number.isFinite(item.data.temp));
  if (obs && reading && sourceFreshness(obs) !== 'down') {
    const temp = new Intl.NumberFormat(i18n.getLocale(), { maximumFractionDigits: 1 }).format(reading.data!.temp as number);
    weather = { text: `${temp} °C`, detail: sourceDetail(obs, i18n, reading.at), freshness: sourceFreshness(obs), severity: 'normal' };
  }
  let transit = unavailable();
  const zet = by('zet-rt');
  if (zet && sourceFreshness(zet) !== 'down') {
    const count = vehicleCount(zet);
    if (count !== null && Number.isFinite(count)) {
      transit = { text: i18n.t('landing.live.vehicles', { count }), detail: sourceDetail(zet, i18n), freshness: sourceFreshness(zet), severity: 'normal' };
    }
  }
  let safety = { ...unavailable(), text: i18n.t('landing.live.unconfirmed') };
  const cap = by('dhmz-cap');
  if (cap && sourceFreshness(cap) !== 'down') {
    let invalidDate = cap.items.some((item) => item.kind !== 'warning');
    const active = cap.items.filter((item) => {
      if (item.kind !== 'warning') return false;
      const start = item.at ? Date.parse(item.at) : -Infinity;
      const end = item.until ? Date.parse(item.until) : Infinity;
      if (Number.isNaN(start) || Number.isNaN(end)) { invalidDate = true; return false; }
      return start <= now && end >= now;
    });
    const freshness = invalidDate ? 'stale' : sourceFreshness(cap);
    safety = {
      text: active.length > 0
        ? i18n.t(freshness === 'live' ? 'landing.live.warnings' : 'landing.live.warningsStale', { count: active.length })
        : i18n.t(freshness === 'live' ? 'landing.live.warningsNone' : 'landing.live.unconfirmed'),
      detail: sourceDetail(cap, i18n), freshness,
      severity: active.length ? 'warning' : 'normal',
    };
  }
  return { weather, transit, safety };
}

/** Down/omitted sources keep their last usable values, explicitly stale. */
export function mergeLiveSources(previous: readonly ModuleSnapshot[], next: readonly ModuleSnapshot[], now: number): ModuleSnapshot[] {
  return DISPLAYED.flatMap((id) => {
    const incoming = next.find((m) => m.module === id);
    if (incoming && incoming.status !== 'down') return [incoming];
    const old = previous.find((m) => m.module === id && m.status !== 'down');
    if (old) return [{ ...old, status: 'stale' as const, staleSince: old.staleSince ?? new Date(now).toISOString() }];
    return incoming ? [incoming] : [];
  });
}

export interface LandingLiveDeps {
  root: ParentNode;
  i18n: I18n;
  fetchTeaser: () => Promise<TeaserResponse>;
  fetchHealth: () => Promise<{ ok?: boolean; time?: string }>;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
}
export interface LandingLive {
  setVisible(visible: boolean): void;
  setPageVisible(visible: boolean): void;
  refresh(): Promise<void>;
  repaint(): void;
  destroy(): void;
}

export function mountLandingLive(deps: LandingLiveDeps): LandingLive {
  const { root, i18n } = deps;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer = deps.clearTimeout ?? ((timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>));
  let modules: ModuleSnapshot[] = [];
  let visible = false;
  let pageVisible = true;
  let started = false;
  let busy = false;
  let destroyed = false;
  let lastFinished = 0;
  let health: 'unknown' | 'ok' | 'down' = 'unknown';
  let checkedAt: string | undefined;
  let timer: unknown = null;
  const refreshButton = root.querySelector<HTMLButtonElement>('[data-live-refresh]');
  const healthEl = root.querySelector<HTMLElement>('#health');

  function cancelTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function paint() {
    if (destroyed) return;
    // Old values stay visible during a refresh, but do not certify current
    // safety while the network is still deciding whether they are current.
    const displayModules = busy ? mergeLiveSources(modules, [], now()) : modules;
    const texts = liveStripTexts(displayModules, now(), i18n);
    for (const key of ['weather', 'transit', 'safety'] as const) {
      const value = root.querySelector<HTMLElement>(`[data-live=${key}]`);
      const detail = root.querySelector<HTMLElement>(`[data-live-detail=${key}]`);
      const state = root.querySelector<HTMLElement>(`[data-live-state=${key}]`);
      const line = texts[key];
      if (!started || (busy && modules.length === 0)) {
        line.text = i18n.t('landing.live.loading');
        line.freshness = 'loading';
      }
      if (value) {
        value.removeAttribute('data-i18n');
        value.textContent = line.text;
        value.dataset.freshness = line.freshness;
        value.dataset.severity = line.severity;
      }
      if (detail) detail.textContent = line.detail;
      if (state) {
        state.dataset.freshness = line.freshness;
        state.textContent = line.freshness === 'live' ? i18n.t('landing.live.live')
          : line.freshness === 'stale' ? i18n.t('landing.live.stale') : '';
      }
    }
    if (refreshButton) {
      refreshButton.hidden = false;
      refreshButton.disabled = busy;
      refreshButton.textContent = i18n.t(busy ? 'landing.live.loading' : 'landing.live.retry');
    }
    if (healthEl && started && !busy) {
      const fresh = Object.values(texts).every((line) => line.freshness === 'live');
      const label = health === 'down' ? 'landing.live.serverDown'
        : health !== 'ok' || modules.length === 0 ? 'landing.live.healthDown'
        : fresh ? 'landing.live.healthGood' : 'landing.live.healthPartial';
      const checked = timestamp(checkedAt, i18n);
      healthEl.textContent = [i18n.t(label), checked ? i18n.t('landing.live.checked', { time: checked }) : ''].filter(Boolean).join(' · ');
    }
  }
  function schedule() {
    cancelTimer();
    if (destroyed || busy || !visible || !pageVisible) return;
    const delay = started ? Math.max(0, LIVE_INTERVAL_MS - (now() - lastFinished)) : 0;
    timer = setTimer(() => { timer = null; void refresh(); }, delay);
  }
  async function refresh() {
    if (destroyed || busy || !visible || !pageVisible) return;
    cancelTimer();
    started = true;
    busy = true;
    paint();
    const [teaser, server] = await Promise.allSettled([
      Promise.resolve().then(deps.fetchTeaser),
      Promise.resolve().then(deps.fetchHealth),
    ]);
    if (destroyed) return;
    modules = mergeLiveSources(modules, teaser.status === 'fulfilled' ? readableModules(teaser.value?.modules) : [], now());
    health = server.status === 'fulfilled' && server.value.ok === true ? 'ok' : 'down';
    checkedAt = server.status === 'fulfilled' && server.value.time ? server.value.time : new Date(now()).toISOString();
    lastFinished = now();
    busy = false;
    paint();
    schedule();
  }
  const onRefresh = () => { void refresh(); };
  refreshButton?.addEventListener('click', onRefresh);
  paint();
  return {
    setVisible(next) { visible = next; schedule(); },
    setPageVisible(next) { pageVisible = next; schedule(); },
    refresh,
    repaint: paint,
    destroy() { destroyed = true; cancelTimer(); refreshButton?.removeEventListener('click', onRefresh); },
  };
}
