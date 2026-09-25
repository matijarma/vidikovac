// @vitest-environment happy-dom
// Postavke as click-toggles (kiosk/settings.ts) with every dependency faked:
// the rows, the send queue against the DO's one-frame-per-five-seconds rule,
// refusals and timeouts repainting from the DO's truth, the long press on the
// brand, the wall's reading of a screen record, and the browser's own
// preferences (kiosk/prefs.ts). The kiosk's wiring of all this is in
// test/app/kiosk.test.ts.
import { describe, expect, it, vi } from 'vitest';
import '../../shared/kiosk/external-text';
import type { ScreenMetadata, ScreenPlaceInput } from '../../worker/protocol';
import { SCREEN_SET_MIN_MS } from '../../worker/protocol';
import { FRAME_RADIUS_M, frameRadiusM, frameSpanM, frameStopsFrom } from '../../shared/city/frame';
import type { ScreenPlace } from '../../shared/city/place';
import type { ScreenSetInput } from '../../app/src/beacon';
import { LONG_PRESS_MS } from '../../app/src/kiosk/constants';
import { FIELD_SPAN_M, HANDHELD_SPAN_M } from '../../app/src/kiosk/mapview';
import {
  DEFAULT_RHYTHM, DEFAULT_WALL_VIEW, nextInCycle, readRhythm, readView, RHYTHM_STORAGE_KEY, VIEW_STORAGE_KEY, writeRhythm, writeView,
  type Rhythm, type WallView,
} from '../../app/src/kiosk/prefs';
import {
  bindLongPress, LONG_PRESS_SLOP_PX, mountSettings, placeText, samePlace, SAVE_TIMEOUT_MS, SETTINGS_IDLE_MS, SETTINGS_SEND_DELAY_MS,
  wallPlaceOf, wallSpanM, type PlaceFieldOptions, type SettingsScreen,
} from '../../app/src/kiosk/settings';
import { kioskStrings } from '../../app/src/kiosk/strings';
import type { ThemePreference } from '../../app/src/ui/theme';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const isTram = (routeId: string): boolean => Number(routeId) < 100;
const TRG = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11', '12', '13', '14', '17'] };
const ZAPRUDE = { id: '200_1', name: 'Zapruđe', lon: 15.99, lat: 45.77, routes: ['7'] };
const KVATERNIKOV: ScreenPlace = { kind: 'tram', name: 'Kvaternikov trg', lon: 15.9981, lat: 45.8149, stopId: '236_2' };
const ZAPRUDE_PLACE: ScreenPlace = { kind: 'tram', name: 'Zapruđe', lon: 15.99, lat: 45.77, stopId: '200_1' };
/** A ring of tram stops at known distances north of a point, one name each. */
function ring(center: { lon: number; lat: number }, metres: number[]) {
  return metres.map((m, i) => ({ id: `r${i}`, name: `Stop ${i}`, lon: center.lon, lat: center.lat + m / 111_195, routes: ['4'] }));
}

/** A clock the queue and the panel run on: timers fire in due order as time advances. */
function fakeClock() {
  let now = NOW;
  let seq = 0;
  const timers: { at: number; id: number; fn: () => void; live: boolean }[] = [];
  return {
    setTimeout: (fn: () => void, ms: number): unknown => { const t = { at: now + ms, id: seq += 1, fn, live: true }; timers.push(t); return t; },
    clearTimeout: (handle: unknown): void => { if (handle) (handle as { live: boolean }).live = false; },
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        now = due.at;
        due.live = false;
        due.fn();
      }
      now = end;
    },
    now: () => now,
  };
}

const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The panel over a fake DO: `save` records the frames, `answer` is the DO storing one and sending the screen back. */
function panel(opts: { screen?: Partial<SettingsScreen>; online?: boolean; theme?: ThemePreference; locale?: string } = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const time = fakeClock();
  let screen: SettingsScreen = { place: KVATERNIKOV, frame: 6, expiresAt: NOW + 20 * 3_600_000, ...opts.screen };
  let online = opts.online ?? true;
  let theme: ThemePreference = opts.theme ?? 'solar';
  let rhythm: Rhythm = 20;
  let view: WallView = 'map';
  const sent: ScreenSetInput[] = [];
  const fields: { host: HTMLElement; options: PlaceFieldOptions; destroyed: boolean; focused: boolean }[] = [];
  const forget = vi.fn();
  const s = kioskStrings(opts.locale ?? 'hr');
  const handle = mountSettings(root, {
    strings: s,
    locale: opts.locale ?? 'hr',
    screen: () => screen,
    placeField: (host, options) => {
      const record = { host, options, destroyed: false, focused: false };
      fields.push(record);
      host.innerHTML = '<input data-testid="setup-place">';
      return { focus: () => { record.focused = true; }, destroy: () => { record.destroyed = true; } };
    },
    themePreference: () => theme,
    cycleTheme: () => { theme = theme === 'solar' ? 'auto' : theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'solar'; },
    rhythm: () => rhythm,
    setRhythm: (next) => { rhythm = next; },
    view: () => view,
    setView: (next) => { view = next; },
    save: (input) => { if (!online) return false; sent.push(input); return true; },
    forget,
    now: time.now,
    setTimeout: time.setTimeout,
    clearTimeout: time.clearTimeout,
  });
  const q = (sel: string) => handle.element.querySelector<HTMLElement>(sel)!;
  /** The DO's answer to a frame: the record now says what was sent (a stop resolved from the fixture table). */
  const resolve = (input: ScreenPlaceInput | null): ScreenPlace | null => {
    if (!input) return null;
    if (input.kind === 'address') return { kind: 'address', name: input.name, lon: input.lon, lat: input.lat, ...(input.address ? { address: input.address } : {}) };
    const stop = [KVATERNIKOV, ZAPRUDE_PLACE].find((p) => p.stopId === input.stopId)!;
    return { ...stop, ...(input.address ? { address: input.address } : {}) };
  };
  return {
    handle, root, time, sent, fields, forget, q,
    click: (testid: string) => q(`[data-testid=${testid}]`).click(),
    answer(input: ScreenSetInput = sent.at(-1)!) {
      screen = { ...screen, place: resolve(input.place), frame: input.frame };
      handle.paint();
      handle.applied();
    },
    setScreen(next: Partial<SettingsScreen>) { screen = { ...screen, ...next }; },
    goOffline: () => { online = false; },
    get rhythm() { return rhythm; },
    get view() { return view; },
    get theme() { return theme; },
  };
}

describe('Postavke: one click-toggle per row', () => {
  it('lists Mjesto, Kadar, Prikaz, Tema, Ritam and Zaslon, each toggle naming its state; no Spremi', () => {
    const p = panel();
    p.handle.open();
    const rows = [...p.handle.element.querySelectorAll<HTMLElement>('.k-settings-row')].map((el) => el.dataset.row);
    expect(rows).toEqual(['place', 'frame', 'view', 'theme', 'rhythm', 'screen']);
    expect([...p.handle.element.querySelectorAll('.k-settings-label')].map(text)).toEqual(['Mjesto', 'Kadar', 'Prikaz', 'Tema', 'Ritam', 'Zaslon']);
    expect(text(p.q('[data-testid=settings-place]'))).toBe('Kvaternikov trg');
    expect(text(p.q('[data-testid=toggle-place]'))).toBe('Promijeni');
    expect(p.q('[data-testid=toggle-frame]').dataset.value).toBe('6');
    expect(text(p.q('[data-testid=toggle-frame]'))).toBe('Kadar: 6 stajališta odavde');
    expect(p.q('[data-testid=toggle-view]').dataset.value).toBe('map');
    expect(text(p.q('[data-testid=toggle-view]'))).toBe('Prikaz: karta');
    expect(text(p.q('[data-testid=toggle-theme]'))).toBe('Tema: po suncu');
    expect(p.q('[data-testid=toggle-theme] use').getAttribute('href')).toBe('#icon-sunset');
    expect(p.q('[data-testid=toggle-rhythm]').dataset.value).toBe('20');
    expect(text(p.q('[data-testid=toggle-rhythm]'))).toBe('Ritam: 20 s');
    expect(text(p.q('[data-testid=settings-expiry]'))).toBe('Vrijedi do sub 12. 9. 10:32');
    expect(p.handle.element.querySelector('[data-testid=settings-save]')).toBeNull();
    expect(p.handle.element.querySelector('select')).toBeNull();
    expect(p.q('[data-testid=settings-error]').hidden).toBe(true);
  });

  it('reads the whole city as "Cijeli grad" and offers no second "Cijeli grad" to press', () => {
    const p = panel({ screen: { place: null } });
    p.handle.open();
    expect(text(p.q('[data-testid=settings-place]'))).toBe('Cijeli grad');
    p.click('toggle-place');
    expect(p.q('[data-testid=settings-place-city]').hidden).toBe(true);
  });

  it('cycles Kadar 6 → 8 → 4 → 6 on the button itself, the text changing at once', () => {
    const p = panel();
    p.handle.open();
    const frame = p.q('[data-testid=toggle-frame]');
    p.click('toggle-frame');
    expect(frame.dataset.value).toBe('8');
    expect(text(frame)).toBe('Kadar: 8 stajališta odavde');
    p.click('toggle-frame');
    expect(text(frame)).toBe('Kadar: 4 stajališta odavde');
    p.click('toggle-frame');
    expect(text(frame)).toBe('Kadar: 6 stajališta odavde');
  });

  it('applies Prikaz, Ritam and Tema at once in this browser, never as a frame to the DO', () => {
    const p = panel();
    p.handle.open();
    p.click('toggle-view');
    expect(p.view).toBe('schema');
    expect(text(p.q('[data-testid=toggle-view]'))).toBe('Prikaz: shema');
    expect(p.q('[data-testid=toggle-view]').dataset.value).toBe('schema');
    p.click('toggle-view');
    expect(p.view).toBe('map');
    p.click('toggle-rhythm');
    expect(p.rhythm).toBe(30);
    expect(text(p.q('[data-testid=toggle-rhythm]'))).toBe('Ritam: 30 s');
    p.click('toggle-rhythm');
    p.click('toggle-rhythm');
    expect(p.rhythm).toBe(20);
    p.click('toggle-theme');
    expect(p.theme).toBe('auto');
    expect(text(p.q('[data-testid=toggle-theme]'))).toBe('Tema: automatski');
    expect(p.q('[data-testid=toggle-theme] use').getAttribute('href')).toBe('#icon-sun-moon');
    p.time.advance(SETTINGS_SEND_DELAY_MS + SCREEN_SET_MIN_MS);
    expect(p.sent).toEqual([]);
  });

  it('speaks English from the one catalogue', () => {
    const p = panel({ locale: 'en' });
    p.handle.open();
    expect(text(p.q('[data-testid=toggle-frame]'))).toBe('Frame: 6 stops from here');
    expect(text(p.q('[data-testid=toggle-rhythm]'))).toBe('Rhythm: 20 s');
    expect(text(p.q('[data-testid=toggle-view]'))).toBe('View: map');
  });
});

describe('Postavke: the send queue and the DO’s window', () => {
  it('Kadar click changes the text at once and sends one version 2 frame after the debounce', () => {
    const p = panel();
    p.handle.open();
    p.click('toggle-frame');
    p.time.advance(SETTINGS_SEND_DELAY_MS - 1);
    expect(p.sent).toEqual([]);
    p.time.advance(1);
    expect(p.sent).toEqual([{ place: { kind: 'stop', stopId: '236_2' }, frame: 8 }]);
    // The panel waits for the DO's answer without closing, and repaints from it.
    p.answer();
    expect(p.handle.isOpen()).toBe(true);
    expect(text(p.q('[data-testid=toggle-frame]'))).toBe('Kadar: 8 stajališta odavde');
    p.time.advance(SAVE_TIMEOUT_MS * 2);
    expect(p.sent).toHaveLength(1);
    expect(p.q('[data-testid=settings-error]').hidden).toBe(true);
  });

  it('three quick clicks send one frame carrying the last state', () => {
    const p = panel();
    p.handle.open();
    p.click('toggle-frame'); // 8
    p.time.advance(300);
    p.click('toggle-frame'); // 4
    p.time.advance(300);
    p.click('toggle-place');
    p.click('settings-place-city'); // the whole city, frame 4
    expect(text(p.q('[data-testid=settings-place]'))).toBe('Cijeli grad');
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    expect(p.sent).toEqual([{ place: null, frame: 4 }]);
    p.answer();
    p.time.advance(SCREEN_SET_MIN_MS + SAVE_TIMEOUT_MS);
    expect(p.sent).toHaveLength(1);
  });

  it('three clicks that come back to where the DO already is send nothing', () => {
    const p = panel();
    p.handle.open();
    p.click('toggle-frame');
    p.click('toggle-frame');
    p.click('toggle-frame');
    p.time.advance(SETTINGS_SEND_DELAY_MS + SCREEN_SET_MIN_MS);
    expect(p.sent).toEqual([]);
  });

  it('a second change inside five seconds waits for the window, counted from the DO’s answer', () => {
    const p = panel();
    p.handle.open();
    p.click('toggle-frame'); // 8
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    expect(p.sent).toHaveLength(1);
    p.time.advance(200);
    p.answer();
    p.click('toggle-frame'); // 4
    expect(text(p.q('[data-testid=toggle-frame]'))).toBe('Kadar: 4 stajališta odavde');
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    expect(p.sent).toHaveLength(1);
    p.time.advance(SCREEN_SET_MIN_MS - SETTINGS_SEND_DELAY_MS - 1);
    expect(p.sent).toHaveLength(1);
    p.time.advance(1);
    expect(p.sent).toEqual([{ place: { kind: 'stop', stopId: '236_2' }, frame: 8 }, { place: { kind: 'stop', stopId: '236_2' }, frame: 4 }]);
  });

  it('keeps one frame in flight: a change made before the answer goes after it, the latest state winning', () => {
    const p = panel();
    p.handle.open();
    p.click('toggle-frame'); // 8
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    p.click('toggle-frame'); // 4
    p.click('toggle-frame'); // 6
    p.click('toggle-frame'); // 8 again: the frame in flight already carries it
    p.time.advance(SCREEN_SET_MIN_MS);
    expect(p.sent).toHaveLength(1);
    p.answer();
    p.time.advance(SCREEN_SET_MIN_MS);
    expect(p.sent).toHaveLength(1);
    p.click('toggle-frame'); // 4
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    expect(p.sent.map((f) => f.frame)).toEqual([8, 4]);
  });

  it('a refusal repaints the toggles from the DO’s truth with one sentence, and nothing is re-sent', () => {
    const p = panel();
    p.handle.open();
    p.click('toggle-frame');
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    // An error word that belongs to something else on the socket is not this panel's.
    p.handle.refused('auth-required');
    expect(text(p.q('[data-testid=toggle-frame]'))).toBe('Kadar: 8 stajališta odavde');
    expect(p.q('[data-testid=settings-error]').hidden).toBe(true);
    p.handle.refused('bad-frame');
    expect(text(p.q('[data-testid=toggle-frame]'))).toBe('Kadar: 6 stajališta odavde');
    expect(text(p.q('[data-testid=settings-error]'))).toBe('Poslužitelj nije prihvatio mjesto. Odaberi ponovno.');
    expect(p.handle.isOpen()).toBe(true);
    p.time.advance(SCREEN_SET_MIN_MS + SAVE_TIMEOUT_MS);
    expect(p.sent).toHaveLength(1);
    // The next click clears the sentence and is a new change of its own.
    p.click('toggle-frame');
    expect(p.q('[data-testid=settings-error]').hidden).toBe(true);
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    expect(p.sent).toHaveLength(2);
    p.handle.refused('bad-place');
    expect(text(p.q('[data-testid=settings-error]'))).toBe('Poslužitelj nije prihvatio mjesto. Odaberi ponovno.');
  });

  it('a frame dropped inside the DO’s window says so and waits the window out before the next one', () => {
    const p = panel();
    p.handle.open();
    p.click('toggle-frame');
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    p.handle.refused('screen-set-rate');
    expect(text(p.q('[data-testid=settings-error]'))).toBe('Pričekaj koji trenutak pa odaberi ponovno.');
    expect(text(p.q('[data-testid=toggle-frame]'))).toBe('Kadar: 6 stajališta odavde');
    p.click('toggle-frame');
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    expect(p.sent).toHaveLength(1);
    p.time.advance(SCREEN_SET_MIN_MS);
    expect(p.sent).toHaveLength(2);
  });

  it('no answer in eight seconds repaints from the DO’s truth; a late answer is still the truth', () => {
    const p = panel();
    p.handle.open();
    p.click('toggle-frame');
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    p.time.advance(SAVE_TIMEOUT_MS - 1);
    expect(p.q('[data-testid=settings-error]').hidden).toBe(true);
    p.time.advance(1);
    expect(text(p.q('[data-testid=settings-error]'))).toBe('Promjena nije poslana: zaslon trenutačno nema vezu s poslužiteljem. Pokušaj ponovno.');
    expect(text(p.q('[data-testid=toggle-frame]'))).toBe('Kadar: 6 stajališta odavde');
    p.time.advance(60_000);
    expect(p.sent).toHaveLength(1);
    p.answer({ place: { kind: 'stop', stopId: '236_2' }, frame: 8 });
    expect(text(p.q('[data-testid=toggle-frame]'))).toBe('Kadar: 8 stajališta odavde');
    expect(p.handle.isOpen()).toBe(true);
  });

  it('a socket that cannot carry the frame is one sentence, and the toggle goes back', () => {
    const p = panel();
    p.handle.open();
    p.goOffline();
    p.click('toggle-frame');
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    expect(p.sent).toEqual([]);
    expect(text(p.q('[data-testid=settings-error]'))).toBe('Promjena nije poslana: zaslon trenutačno nema vezu s poslužiteljem. Pokušaj ponovno.');
    expect(text(p.q('[data-testid=toggle-frame]'))).toBe('Kadar: 6 stajališta odavde');
  });

  it('a click made just before the panel closes is still sent', () => {
    const p = panel();
    p.handle.open();
    p.click('toggle-frame');
    p.handle.close();
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    expect(p.sent).toHaveLength(1);
  });

  it('forgetting the screen drops whatever was waiting', () => {
    const p = panel();
    p.handle.open();
    p.click('toggle-frame');
    p.click('settings-forget');
    expect(p.q('[data-testid=settings-forget-confirm]').hidden).toBe(false);
    p.click('settings-forget-yes');
    expect(p.forget).toHaveBeenCalledTimes(1);
    expect(p.handle.isOpen()).toBe(false);
    p.time.advance(SETTINGS_SEND_DELAY_MS + SCREEN_SET_MIN_MS);
    expect(p.sent).toEqual([]);
  });
});

describe('Postavke: Mjesto through the shared field', () => {
  it('opens the "Adresa ili stajalište" field near the place, and a picked place is one frame', () => {
    const p = panel();
    p.handle.open();
    const toggle = p.q('[data-testid=toggle-place]');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(p.q('[data-testid=settings-place-edit]').hidden).toBe(true);
    p.click('toggle-place');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(p.q('[data-testid=settings-place-edit]').hidden).toBe(false);
    expect(p.fields).toHaveLength(1);
    const [field] = p.fields;
    expect(field!.focused).toBe(true);
    expect(field!.options.initial).toEqual(KVATERNIKOV);
    expect(field!.options.near).toEqual(KVATERNIKOV);
    expect(p.handle.element.querySelector('[data-testid=setup-place]')).not.toBeNull();
    // Clearing the field, or text that matches nothing, is not a change.
    field!.options.onChange(null, 'nepostojeće');
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    expect(p.sent).toEqual([]);
    expect(p.q('[data-testid=settings-place-edit]').hidden).toBe(false);
    field!.options.onChange({ ...ZAPRUDE_PLACE, address: 'Zapruđe 12' }, '');
    expect(field!.destroyed).toBe(true);
    expect(p.q('[data-testid=settings-place-edit]').hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // The focus returns to Promijeni with the field gone, so Escape still closes the panel (round 1, 24 Sep).
    expect(document.activeElement).toBe(toggle);
    p.handle.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(p.handle.isOpen()).toBe(false);
    p.handle.open();
    expect(text(p.q('[data-testid=settings-place]'))).toBe('Zapruđe · Zapruđe 12');
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    expect(p.sent).toEqual([{ place: { kind: 'stop', stopId: '200_1', address: 'Zapruđe 12' }, frame: 6 }]);
  });

  it('sends an address place with its point, and names it by what was typed', () => {
    const p = panel({ screen: { place: null } });
    p.handle.open();
    p.click('toggle-place');
    // The whole city: the field ranks from its own city centre and prints no distance.
    expect(p.fields[0]!.options).not.toHaveProperty('near');
    p.fields[0]!.options.onChange({ kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135, address: 'Ilica 25' }, '');
    expect(text(p.q('[data-testid=settings-place]'))).toBe('Ilica 25');
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    expect(p.sent).toEqual([{ place: { kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135, address: 'Ilica 25' }, frame: 6 }]);
    p.answer();
    expect(text(p.q('[data-testid=settings-place]'))).toBe('Ilica 25');
  });

  it('"Cijeli grad" sends place null with the frame it shows', () => {
    const p = panel({ screen: { frame: 8 } });
    p.handle.open();
    p.click('toggle-place');
    p.click('settings-place-city');
    expect(p.fields[0]!.destroyed).toBe(true);
    p.time.advance(SETTINGS_SEND_DELAY_MS);
    expect(p.sent).toEqual([{ place: null, frame: 8 }]);
  });

  it('a second press on Promijeni closes the field, and so does closing the panel', () => {
    const p = panel();
    p.handle.open();
    p.click('toggle-place');
    p.click('toggle-place');
    expect(p.fields[0]!.destroyed).toBe(true);
    expect(p.q('[data-testid=settings-place-edit]').hidden).toBe(true);
    p.click('toggle-place');
    p.handle.close();
    expect(p.fields[1]!.destroyed).toBe(true);
    p.handle.open();
    expect(p.q('[data-testid=settings-place-edit]').hidden).toBe(true);
  });
});

describe('Postavke: open, close, idle', () => {
  it('closes on Escape unless the field already used it, on the close button and after 90 s untouched', () => {
    const p = panel();
    p.handle.open();
    const used = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    used.preventDefault();
    p.handle.element.dispatchEvent(used);
    expect(p.handle.isOpen()).toBe(true);
    p.handle.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(p.handle.isOpen()).toBe(false);
    p.handle.open();
    p.click('kiosk-settings-close');
    expect(p.handle.isOpen()).toBe(false);
    p.handle.open();
    p.time.advance(SETTINGS_IDLE_MS - 1);
    expect(p.handle.isOpen()).toBe(true);
    p.time.advance(1);
    expect(p.handle.isOpen()).toBe(false);
  });

  it('every click re-arms the idle close', () => {
    const p = panel();
    p.handle.open();
    p.time.advance(SETTINGS_IDLE_MS - 1_000);
    p.click('toggle-rhythm');
    p.time.advance(SETTINGS_IDLE_MS - 1_000);
    expect(p.handle.isOpen()).toBe(true);
  });
});

describe('the long press on the brand', () => {
  function brand() {
    const button = document.createElement('button');
    document.body.replaceChildren(button);
    const time = fakeClock();
    const open = vi.fn();
    const unbind = bindLongPress(button, { open, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout });
    const pointer = (type: string, init: PointerEventInit = {}) => button.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }));
    return { button, time, open, unbind, pointer };
  }

  it('opens after LONG_PRESS_MS held, not before', () => {
    const b = brand();
    b.pointer('pointerdown');
    b.time.advance(LONG_PRESS_MS - 1);
    expect(b.open).not.toHaveBeenCalled();
    b.time.advance(1);
    expect(b.open).toHaveBeenCalledTimes(1);
    b.pointer('pointerup');
    b.time.advance(LONG_PRESS_MS);
    expect(b.open).toHaveBeenCalledTimes(1);
  });

  it('a short press, a pointer that leaves or a secondary button opens nothing', () => {
    const b = brand();
    b.pointer('pointerdown');
    b.time.advance(LONG_PRESS_MS - 100);
    b.pointer('pointerup');
    b.time.advance(LONG_PRESS_MS);
    b.pointer('pointerdown');
    b.pointer('pointerleave');
    b.pointer('pointerdown');
    b.pointer('pointercancel');
    b.pointer('pointerdown', { button: 2 });
    b.button.click();
    b.time.advance(LONG_PRESS_MS * 2);
    expect(b.open).not.toHaveBeenCalled();
  });

  it(`a finger that moves more than ${LONG_PRESS_SLOP_PX} px is a swipe; a steady one within the slop still opens`, () => {
    const b = brand();
    b.pointer('pointerdown', { clientX: 100, clientY: 100 });
    b.pointer('pointermove', { clientX: 108, clientY: 108 }); // 11.3 px
    b.time.advance(LONG_PRESS_MS);
    expect(b.open).toHaveBeenCalledTimes(1);
    b.pointer('pointerup');
    b.pointer('pointerdown', { clientX: 100, clientY: 100 });
    b.pointer('pointermove', { clientX: 120, clientY: 100 });
    b.time.advance(LONG_PRESS_MS);
    expect(b.open).toHaveBeenCalledTimes(1);
  });

  it('Enter or Space on the focused brand opens at once; a held key opens once', () => {
    const b = brand();
    const key = (k: string, repeat = false) => {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, repeat });
      b.button.dispatchEvent(event);
      return event;
    };
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(b.open).toHaveBeenCalledTimes(1);
    key(' ');
    expect(b.open).toHaveBeenCalledTimes(2);
    key(' ', true);
    key('a');
    expect(b.open).toHaveBeenCalledTimes(2);
  });

  it('keeps the context menu off the held brand, and lets go of everything when unbound', () => {
    const b = brand();
    const menu = new Event('contextmenu', { bubbles: true, cancelable: true });
    b.button.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    b.pointer('pointerdown');
    b.unbind();
    b.time.advance(LONG_PRESS_MS);
    b.pointer('pointerdown');
    b.time.advance(LONG_PRESS_MS);
    expect(b.open).not.toHaveBeenCalled();
  });

  it('never stops the press: the kiosk’s first-tap listener still hears it', () => {
    const b = brand();
    const heard = vi.fn();
    document.body.addEventListener('pointerdown', heard);
    b.pointer('pointerdown');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  // The release smoke of D5.21 (24 Sep, screen-creation :7 red 4 of 4 at host load 20 to 65): a real 0.9 to
  // 1.2 s press on the brand opened nothing, because the 800 ms timer ran 600 to 3000 ms late behind the
  // map's long tasks and the release had already cleared it. The press is judged by the pointer events'
  // own timestamps on release, so a late timer never loses a press that was held long enough.
  // Review of lane/iter1-kiosk, N2: under load the timer fired before a queued pointermove past the slop arrived,
  // and 1 of 12 swipes opened Postavke. The timer now takes the open on the next beat of the same clock, after
  // whatever input the queue holds, and a release checks its own distance from the press.
  describe('a swipe whose move arrives late, after the timer (N2)', () => {
    it('opens nothing when the move past the slop lands between the timer and its beat; a steady press opens on the beat', () => {
      const b = brand();
      b.pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
      // The queued move is a timer of the same clock, registered after the press: it runs between the press's
      // timer and the beat that timer schedules.
      b.time.setTimeout(() => b.pointer('pointermove', { clientX: 100 + LONG_PRESS_SLOP_PX + 20, clientY: 100, pointerId: 1 }), LONG_PRESS_MS);
      b.time.advance(LONG_PRESS_MS);
      expect(b.open).not.toHaveBeenCalled();
      b.pointer('pointerup', { clientX: 100 + LONG_PRESS_SLOP_PX + 20, clientY: 100, pointerId: 1 });
      b.time.advance(LONG_PRESS_MS);
      expect(b.open).not.toHaveBeenCalled();
      const steady = brand();
      steady.pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
      steady.time.advance(LONG_PRESS_MS);
      expect(steady.open).toHaveBeenCalledTimes(1);
      steady.pointer('pointerup', { clientX: 102, clientY: 101, pointerId: 1 });
      steady.time.advance(LONG_PRESS_MS);
      expect(steady.open).toHaveBeenCalledTimes(1);
    });

    it('a release before the beat opens at once when it is within the slop of the press, and never when it is not', () => {
      const b = brand();
      b.pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
      // The timer fires and queues its beat; the release lands first (the test harness of kiosk.test.ts does the same).
      const timers = b.time;
      timers.setTimeout(() => b.pointer('pointerup', { clientX: 103, clientY: 100, pointerId: 1 }), LONG_PRESS_MS);
      timers.advance(LONG_PRESS_MS);
      expect(b.open).toHaveBeenCalledTimes(1);
      const far = brand();
      far.pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
      far.time.setTimeout(() => far.pointer('pointerup', { clientX: 100 + LONG_PRESS_SLOP_PX + 30, clientY: 100, pointerId: 1 }), LONG_PRESS_MS);
      far.time.advance(LONG_PRESS_MS);
      expect(far.open).not.toHaveBeenCalled();
    });
  });

  // Review N3: two fingers resting on the wall for 0.8 s opened Postavke. A press is one finger: while more than
  // one pointer is down nothing arms, and a second finger ends a press already armed; one finger alone still opens.
  describe('two fingers are not a press (N3)', () => {
    it('two pointers down together open nothing, a second finger ends an armed press, and one finger opens once they are gone', () => {
      const b = brand();
      b.pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
      b.pointer('pointerdown', { clientX: 300, clientY: 120, pointerId: 2 });
      b.time.advance(LONG_PRESS_MS * 2);
      expect(b.open).not.toHaveBeenCalled();
      b.pointer('pointerup', { clientX: 300, clientY: 120, pointerId: 2 });
      b.pointer('pointerup', { clientX: 100, clientY: 100, pointerId: 1 });
      expect(b.open).not.toHaveBeenCalled();
      // A second finger mid-press.
      b.pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
      b.time.advance(LONG_PRESS_MS / 2);
      b.pointer('pointerdown', { clientX: 300, clientY: 120, pointerId: 2 });
      b.time.advance(LONG_PRESS_MS);
      expect(b.open).not.toHaveBeenCalled();
      b.pointer('pointerup', { clientX: 300, clientY: 120, pointerId: 2 });
      b.pointer('pointerup', { clientX: 100, clientY: 100, pointerId: 1 });
      // One finger, once the other is gone.
      b.pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
      b.time.advance(LONG_PRESS_MS);
      expect(b.open).toHaveBeenCalledTimes(1);
    });
  });

  describe('a timer that runs late behind a busy main thread', () => {
    /** A pointer event stamped at `at` ms on the events' own clock (Event.timeStamp is read-only; the instance shadows it). */
    const stamped = (button: HTMLElement, type: string, at: number, init: PointerEventInit = {}): void => {
      const event = new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
      Object.defineProperty(event, 'timeStamp', { value: at, configurable: true });
      button.dispatchEvent(event);
    };

    it('opens once on release when the events say the press was held LONG_PRESS_MS, though the timer never fired', () => {
      const b = brand();
      stamped(b.button, 'pointerdown', 1_000);
      // The fake clock never reaches the timer: the main thread was busy.
      stamped(b.button, 'pointerup', 1_000 + LONG_PRESS_MS);
      expect(b.open).toHaveBeenCalledTimes(1);
      b.time.advance(LONG_PRESS_MS * 2);
      expect(b.open).toHaveBeenCalledTimes(1);
    });

    it('a release one millisecond short of LONG_PRESS_MS opens nothing', () => {
      const b = brand();
      stamped(b.button, 'pointerdown', 1_000);
      stamped(b.button, 'pointerup', 1_000 + LONG_PRESS_MS - 1);
      b.time.advance(LONG_PRESS_MS * 2);
      expect(b.open).not.toHaveBeenCalled();
    });

    it('the timer that did fire in time and the release together open once', () => {
      const b = brand();
      stamped(b.button, 'pointerdown', 1_000);
      b.time.advance(LONG_PRESS_MS);
      expect(b.open).toHaveBeenCalledTimes(1);
      stamped(b.button, 'pointerup', 1_000 + LONG_PRESS_MS + 500);
      expect(b.open).toHaveBeenCalledTimes(1);
    });

    it('a press the binding did not accept, a swipe past the slop and a pointer that left never open on release', () => {
      const button = document.createElement('button');
      document.body.replaceChildren(button);
      const time = fakeClock();
      const open = vi.fn();
      bindLongPress(button, { open, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, accept: () => false });
      stamped(button, 'pointerdown', 1_000);
      stamped(button, 'pointerup', 1_000 + LONG_PRESS_MS * 2);
      expect(open).not.toHaveBeenCalled();
      const b = brand();
      stamped(b.button, 'pointerdown', 1_000, { clientX: 100, clientY: 100 });
      b.pointer('pointermove', { clientX: 130, clientY: 100 });
      stamped(b.button, 'pointerup', 1_000 + LONG_PRESS_MS * 2);
      stamped(b.button, 'pointerdown', 5_000);
      b.pointer('pointerleave');
      stamped(b.button, 'pointerup', 5_000 + LONG_PRESS_MS * 2);
      expect(b.open).not.toHaveBeenCalled();
    });
  });
});

describe('what the wall reads from the screen record', () => {
  const base: ScreenMetadata = { kind: 'temporary', expiresAt: NOW + 1, stop: null, area: 'zagreb' };
  it('takes the DO’s place and frame; the read-path default place is not a chosen one', () => {
    expect(wallPlaceOf({ ...base, place: KVATERNIKOV, placeSet: true, frame: 8 }, isTram)).toEqual({ place: KVATERNIKOV, placeSet: true, frame: 8 });
    const trg = { kind: 'tram' as const, name: TRG.name, lon: TRG.lon, lat: TRG.lat, stopId: TRG.id };
    expect(wallPlaceOf({ ...base, place: trg, placeSet: false, frame: 6 }, isTram)).toEqual({ place: trg, placeSet: false, frame: 6 });
    // A place without placeSet came from a DO that stored it: chosen.
    expect(wallPlaceOf({ ...base, place: KVATERNIKOV }, isTram).placeSet).toBe(true);
  });
  it('reads a record from before place-v2 by its stop, frame 6', () => {
    expect(wallPlaceOf({ ...base, stop: ZAPRUDE }, isTram)).toEqual({ place: { kind: 'tram', name: 'Zapruđe', lon: 15.99, lat: 45.77, stopId: '200_1' }, placeSet: true, frame: 6 });
    expect(wallPlaceOf({ ...base, stop: { ...ZAPRUDE, routes: ['220'] } }, isTram).place?.kind).toBe('bus');
  });
  it('is the whole city for a record with no place and no stop, an explicit null, or no record', () => {
    for (const screen of [base, { ...base, place: null }, { ...base, place: null, stop: ZAPRUDE }, null, undefined]) {
      expect(wallPlaceOf(screen, isTram)).toEqual({ place: null, placeSet: false, frame: 6 });
    }
    expect(wallPlaceOf({ ...base, frame: 5 as never }, isTram).frame).toBe(6);
  });
  it('uses the frame fallback without line order, a handheld band, or the whole-city window', () => {
    const place = { kind: 'address' as const, name: 'Ilica', lon: 15.97, lat: 45.81 };
    const stops = ring(place, [300, 600, 900, 1200, 1500, 1800, 2100, 2400]);
    const wall = { place, placeSet: true, frame: 6 as const };
    const measured = frameSpanM(frameRadiusM(place, frameStopsFrom(stops, isTram), 6));
    expect(wallSpanM({ handheld: false, wall, stops, isTram })).toBe(measured);
    // A ring supplies no tram call order. The integrated camera measures the
    // along-line radius in kiosk.ts once the network arrives (decision 6).
    expect(measured).toBe(2 * FRAME_RADIUS_M[6]);
    expect(wallSpanM({ handheld: false, wall: { ...wall, frame: 4 }, stops, isTram })).toBe(2 * FRAME_RADIUS_M[4]);
    expect(wallSpanM({ handheld: false, wall, stops: null, isTram })).toBe(2 * FRAME_RADIUS_M[6]);
    expect(wallSpanM({ handheld: true, wall, stops, isTram })).toBe(HANDHELD_SPAN_M);
    expect(wallSpanM({ handheld: false, wall: { ...wall, placeSet: false }, stops, isTram })).toBe(FIELD_SPAN_M);
    expect(wallSpanM({ handheld: false, wall: { place: null, placeSet: false, frame: 6 }, stops, isTram })).toBe(FIELD_SPAN_M);
  });
  it('names a place in the Mjesto row by what the operator typed', () => {
    const s = kioskStrings('hr');
    expect(placeText(s, null)).toBe('Cijeli grad');
    expect(placeText(s, KVATERNIKOV)).toBe('Kvaternikov trg');
    expect(placeText(s, { ...KVATERNIKOV, address: 'Kvaternikova ulica 12' })).toBe('Kvaternikov trg · Kvaternikova ulica 12');
    expect(placeText(s, { kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.81 })).toBe('Ilica');
  });
  it('compares places the way the DO stores them', () => {
    expect(samePlace(KVATERNIKOV, { ...KVATERNIKOV, name: 'x', kind: 'bus' })).toBe(true);
    expect(samePlace(KVATERNIKOV, ZAPRUDE_PLACE)).toBe(false);
    expect(samePlace(KVATERNIKOV, { ...KVATERNIKOV, address: 'Kvaternikova 1' })).toBe(false);
    const ilica = { kind: 'address' as const, name: 'Ilica', lon: 15.97, lat: 45.81, address: 'Ilica 25' };
    expect(samePlace(ilica, { ...ilica, name: ' Ilica ', lon: 15.970004 })).toBe(true);
    expect(samePlace(ilica, { ...ilica, lat: 45.811 })).toBe(false);
    expect(samePlace(null, null)).toBe(true);
    expect(samePlace(null, ilica)).toBe(false);
  });
});

describe('the wall’s own preferences (kiosk/prefs.ts)', () => {
  function store(initial: Record<string, string> = {}) {
    const raw: Record<string, string> = { ...initial };
    return { raw, storage: { getItem: (k: string) => raw[k] ?? null, setItem: (k: string, v: string) => { raw[k] = v; }, removeItem: (k: string) => { delete raw[k]; } } };
  }
  it('keeps Ritam under vidikovac-kiosk-rhythm: 20, 30 or 60, else 20', () => {
    const { raw, storage } = store();
    expect(RHYTHM_STORAGE_KEY).toBe('vidikovac-kiosk-rhythm');
    expect(readRhythm(storage)).toBe(DEFAULT_RHYTHM);
    expect(DEFAULT_RHYTHM).toBe(20);
    writeRhythm(storage, 60);
    expect(raw[RHYTHM_STORAGE_KEY]).toBe('60');
    expect(readRhythm(storage)).toBe(60);
    for (const bad of ['45', 'x', '']) expect(readRhythm(store({ [RHYTHM_STORAGE_KEY]: bad }).storage)).toBe(20);
  });
  it('keeps Prikaz under vidikovac-kiosk-view: map or schema, else map', () => {
    const { raw, storage } = store();
    expect(VIEW_STORAGE_KEY).toBe('vidikovac-kiosk-view');
    expect(readView(storage)).toBe(DEFAULT_WALL_VIEW);
    writeView(storage, 'schema');
    expect(raw[VIEW_STORAGE_KEY]).toBe('schema');
    expect(readView(storage)).toBe('schema');
    expect(readView(store({ [VIEW_STORAGE_KEY]: 'satellite' }).storage)).toBe('map');
  });
  it('works without storage and with one that throws', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
    expect(readRhythm(null)).toBe(20);
    expect(readView(throwing)).toBe('map');
    expect(() => writeRhythm(throwing, 30)).not.toThrow();
    expect(() => writeView(undefined, 'schema')).not.toThrow();
  });
  it('cycles a toggle’s values and starts an unknown one from the top', () => {
    expect(nextInCycle([4, 6, 8], 8)).toBe(4);
    expect(nextInCycle([20, 30, 60], 20)).toBe(30);
    expect(nextInCycle(['map', 'schema'], 'x' as never)).toBe('map');
  });
});
