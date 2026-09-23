// @vitest-environment happy-dom
// The map's one word (companion WP4, [O-51], slop #11): the tab, the document
// title and the wall's paired pill all say Karta, read from layers.u-pokretu;
// "Promet" stays the kicker and subject word. The desk has no link into Karta:
// it stands beside Sada on the page (chunk E).
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { MORE_LAYERS, PHONE_TABS, statusLineMarkup, tabbarMarkup, type ShellState } from '../../app/src/experience/chrome';
import { kioskStrings } from '../../app/src/kiosk/strings';

/** The destination word for u-pokretu (WP6's trust guard carries the same constant in the accept tier). */
export const TRANSPORT_TAB_WORD = 'Karta';

const shell = (over: Partial<ShellState> = {}): ShellState => ({
  layer: 'grad-sada', directory: false, phase: 'live', frozen: false, reconnecting: false, secondsLeft: 600, totalSeconds: 600,
  expiresAt: null, countdownHidden: false, paused: false, loading: false, canShare: true, label: null, role: 'scanner',
  participants: 1, error: null, lastRefresh: null, mapFull: false, notice: null, sourcesDown: 0, surface: 'phone',
  stopName: null, hasScreen: false, canCast: false, castReason: null, castSent: false,
  notify: {} as ShellState['notify'], notifyActive: 0, notifyKeys: [],
  ...over,
});

describe('the map has one word: Karta', () => {
  it('layers.u-pokretu is TRANSPORT_TAB_WORD in hr, "Map" in en, and the kicker keeps Promet', () => {
    expect(TRANSPORT_TAB_WORD).toBe('Karta');
    expect(hr.layers['u-pokretu']).toBe(TRANSPORT_TAB_WORD);
    expect(en.layers['u-pokretu']).toBe('Map');
    expect(hr.kiosk.sentence.kicker.promet).toBe('Promet');
  });
  it('the phone tab and the wall pill read the same word; the desk header carries no link into Karta', () => {
    const i18n = createDefaultI18n('hr');
    const tabs = document.createElement('div');
    tabs.innerHTML = tabbarMarkup(i18n, shell());
    expect([...tabs.querySelectorAll('.ki-tab')].map((t) => t.textContent?.trim())).toEqual(['Sada', TRANSPORT_TAB_WORD, 'Još']);
    const desk = document.createElement('div');
    desk.innerHTML = statusLineMarkup(i18n, shell({ surface: 'desktop' }));
    expect(desk.querySelector('[data-testid=desk-karta], [data-key=karta]')).toBeNull();
    expect(desk.textContent).not.toContain(TRANSPORT_TAB_WORD);
    expect(kioskStrings('hr').layers['u-pokretu']).toBe(TRANSPORT_TAB_WORD);
    expect(i18n.t('session.documentTitle', { app: i18n.t('common.appName'), layer: i18n.t('layers.u-pokretu') })).toBe(`Kaj ima? · ${TRANSPORT_TAB_WORD}`);
  });
  it('tabs are Sada and Karta, and Događanja leads Još', () => {
    expect(PHONE_TABS.map((t) => t.layer)).toEqual(['grad-sada', 'u-pokretu']);
    expect(MORE_LAYERS).toEqual(['kultura', 'zrak-i-nebo', 'uprava-i-pravo', 'sigurnost']);
  });
});
