// The column's statements (kiosk/say.ts): the eight candidates, the ranker's
// weights and hysteresis, honest absence, and the markup contract (4/5).
import { describe, expect, it } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { rankStatements, SAY_KINDS, sayMarkup, shorten, type SayInput, type Slot } from '../../app/src/kiosk/say';
import { kioskStrings } from '../../app/src/kiosk/strings';

const NOW = Date.parse('2026-09-11T12:00:00Z'); // 14:00 in Zagreb
const EVENING = Date.parse('2026-09-11T20:30:00Z'); // 22:30 in Zagreb
const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11', '12', '13', '14', '17'], district: 'gornji-grad-medvescak' };
const attr = { text: 'Izvor: test', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };
const i18n = createDefaultI18n('hr');
const strings = kioskStrings('hr');

type Item = ModuleSnapshot['items'][number];
function snap(module: ModuleId, items: Item[], status: ModuleSnapshot['status'] = 'live', extra: Partial<ModuleSnapshot> = {}): ModuleSnapshot {
  return { module, tier: 'open', status, fetchedAt: new Date(NOW - 30_000).toISOString(), sourceUpdatedAt: new Date(NOW - 300_000).toISOString(), attribution: attr, items, ...extra };
}
function item(module: ModuleId, id: string, kind: Item['kind'], title: string, extra: Partial<Item> = {}): Item {
  return { id, module, kind, tier: 'open', title, ...extra };
}
/** A point `metres` due south of the stop (a pure latitude offset), so a distance is deterministic without depending on the map projection's exact constants. */
const south = (metres: number): [number, number] => [STOP.lon, STOP.lat - metres / ((Math.PI / 180) * 6_378_137)];

const ZET = snap('zet-rt', [
  item('zet-rt', 'vozila', 'vehicle', '200 vozila u pokretu', { data: { vehicles: 200 } }),
  item('zet-rt', 'vehicle:1', 'vehicle', '6', { geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: '6', routeType: 0 } }),
  item('zet-rt', 'vehicle:2', 'vehicle', '11', { geo: { type: 'Point', coordinates: [15.978, 45.8125] }, data: { routeId: '11', routeType: 0 } }),
  item('zet-rt', 'route:6', 'vehicle', '6', { data: { routeId: '6', medianDelaySeconds: 240 } }), // "kasni 4 min", the worse of the two
  item('zet-rt', 'route:13', 'vehicle', '13', { data: { routeId: '13', medianDelaySeconds: 180 } }), // "kasni 3 min"
  item('zet-rt', 'route:11', 'vehicle', '11', { data: { routeId: '11', medianDelaySeconds: -5 } }), // under the 120 s headline threshold
]);
const CLOSURE = snap('prometnice', [
  item('prometnice', 'c1', 'closure', 'Ilica', { geo: { type: 'Point', coordinates: south(350) }, summary: 'oba smjera', until: '2026-09-11T16:00:00Z' }),
]);
const SESSION = item('dogadanja', 'skupstina:1', 'event', '15. sjednica Gradske skupštine', { at: '2026-09-12T06:30:00Z', dateBasis: 'event', data: { source: 'skupstina', precision: 'time' } });
const WORKS_ROW = item('dogadanja', 'komunalne:1', 'event', 'Obnova vodovoda, Ilica', { at: '2026-09-01T00:00:00Z', dateBasis: 'updated', data: { source: 'komunalne', phase: 'Radovi u tijeku', district: STOP.district } });
const ZET_NOTICE = item('dogadanja', 'zet-promet:1', 'event', 'Obustava prometa za liniju 14', { at: '2026-09-11T09:00:00Z', dateBasis: 'published', data: { source: 'zet-promet' } });
const KVARTOVSKA = item('dogadanja', 'kvartovske:1', 'event', 'Novi parkić u Dubravi', { dateBasis: 'unknown', data: { source: 'kvartovske' } });
const QUAKE = item('emsc', 'q1', 'quake', 'Potres', { at: '2026-09-11T10:00:00Z', data: { mag: 3.4, depth: 8, region: 'Petrinja' } });

const MODULES: ModuleSnapshot[] = [
  ZET,
  CLOSURE,
  snap('dogadanja', [SESSION, WORKS_ROW, ZET_NOTICE, KVARTOVSKA]),
  snap('emsc', [QUAKE]),
];
const LAST_RUN = {
  status: 'live' as const, fetchedAt: '2026-09-11T12:00:00Z', sourceUpdatedAt: '2026-09-10T03:00:00Z', validUntil: '2026-09-20T00:00:00Z',
  routes: {
    '6': { '2026-09-11': '24:15' }, // 00:15
    '11': { '2026-09-11': '24:05' }, // 00:05: soonest
    '12': { '2026-09-11': '22:00' }, // already left by 22:30
    '13': { '2026-09-11': '25:00' }, // 01:00
    '14': { '2026-09-11': '24:30' }, // 00:30
  },
};

function input(over: Partial<SayInput> = {}): SayInput {
  return { modules: MODULES, stop: STOP, now: NOW, lastRun: null, strings, i18n, locale: 'hr', slots: 3, badgeCap: 12, valueChars: 56, ...over };
}
const withModule = (modules: readonly ModuleSnapshot[], id: ModuleId, patch: Partial<ModuleSnapshot>): ModuleSnapshot[] => modules.map((m) => (m.module === id ? { ...m, ...patch } : m));
const keysOf = (slots: readonly Slot[]): string[] => slots.map((s) => s.key);
const statementOf = (slots: readonly Slot[], say: string): Slot['statement'] | undefined => slots.find((s) => s.statement.say === say)?.statement;

describe('shorten: cut at a word boundary, never mid-word', () => {
  it('leaves a short title untouched and cuts a long one at the last space before the budget', () => {
    expect(shorten('Ilica', 10)).toBe('Ilica');
    expect(shorten('Obnova vodovodne mreže u Ilici', 20)).toBe('Obnova vodovodne…');
    expect(shorten('Obnova vodovodne mreže u Ilici', 20).length).toBeLessThanOrEqual(20);
  });
});

describe('rankStatements: 14:00, the full fixture', () => {
  it('ranks transit, quake and closure into the top three; the transit value names the two worst lines, worst first, each an unbreakable run so a two-line value breaks only at " · " (R-KP22); six badges, no "+N"', () => {
    const slots = rankStatements(input(), []);
    expect(keysOf(slots)).toEqual(['say:transit', 'say:quake', 'say:closure']);
    const transit = statementOf(slots, 'transit')!;
    expect(transit.value).toBe('6\u00a0kasni\u00a04\u00a0min · 13\u00a0kasni\u00a03\u00a0min');
    expect(transit.value.split(' · ').every((run) => !run.includes(' '))).toBe(true);
    expect(transit.tone).toBe('late');
    expect(transit.context).toContain('ZET');
    expect(transit.badgesMarkup!.match(/class="k-line-badge line"/g)).toHaveLength(6);
    expect(transit.badgesMarkup).not.toContain('k-say-more');
    const quake = statementOf(slots, 'quake')!;
    expect(quake.value).toBe('Magnituda\u00a03,4 · Petrinja');
    expect(quake.context).toBe('EMSC · 12:00 · dubina 8 km');
    const closure = statementOf(slots, 'closure')!;
    expect(closure.value).toBe('Ilica');
    expect(closure.context).toBe('350\u00a0m · oba smjera · do 18:00');
    expect(closure.weight).toBe(90); // 350 m is inside the 500 m street radius
  });

  it('a badge cap below the route count shows the cap in rider order and folds the rest into "+N"; the markup wraps the row as the kiosk-lines testid', () => {
    const slots = rankStatements(input({ badgeCap: 4 }), []);
    const transit = statementOf(slots, 'transit')!;
    expect(transit.badgesMarkup!.match(/class="k-line-badge line"/g)).toHaveLength(4);
    expect(transit.badgesMarkup).toContain('<span class="k-say-more">+2</span>');
    const html = sayMarkup(slots, { strings, locale: 'hr', loading: false });
    expect(html).toContain('<span class="k-say-badges" data-testid="kiosk-lines">');
    expect(html.indexOf('k-say-badges')).toBeLessThan(html.indexOf('k-say-more'));
  });

  it('assembly reads "sutra HH:MM"; zet and works are ranked but outside the top three', () => {
    const slots = rankStatements(input({ slots: 8 }), []);
    const assembly = statementOf(slots, 'assembly')!;
    expect(assembly.context).toBe('sutra 08:30 · Skupština Grada Zagreba');
    expect(assembly.weight).toBe(60); // under 24 h ahead
    expect(statementOf(slots, 'zet')!.value).toBe('Obustava prometa za liniju 14');
    expect(statementOf(slots, 'works')!.context).toContain('Grad Zagreb');
    expect(statementOf(slots, 'kvart')!.value).toBe('Novi parkić u Dubravi');
  });
});

describe('SAY_KINDS: the handheld\u2019s "all" is every kind a candidate can produce, once each', () => {
  it('names each of the eight kinds exactly once, and every statement the two fixtures produce is one of them', () => {
    expect(new Set(SAY_KINDS).size).toBe(SAY_KINDS.length);
    const produced = new Set([
      ...rankStatements(input({ slots: SAY_KINDS.length }), []).map((s) => s.statement.say),
      ...rankStatements(input({ now: EVENING, lastRun: LAST_RUN, slots: SAY_KINDS.length }), []).map((s) => s.statement.say),
    ]);
    expect([...produced].sort()).toEqual([...SAY_KINDS].sort());
  });
});

describe('rankStatements: 22:30, last departures', () => {
  it('lastrun enters above zet and above a still-open closure with four pairs, soonest first', () => {
    // The day's closure ends at 18:00; this one runs into the night so the evening order can be read against it (R-KP24).
    const openClosure = withModule(MODULES, 'prometnice', { items: [{ ...CLOSURE.items[0]!, until: '2026-09-11T22:00:00Z' }] });
    const slots = rankStatements(input({ now: EVENING, lastRun: LAST_RUN, slots: 8, modules: openClosure }), []);
    expect(keysOf(slots)).toContain('say:closure');
    const keys = keysOf(slots);
    expect(keys).toContain('say:lastrun');
    expect(keys.indexOf('say:lastrun')).toBeLessThan(keys.indexOf('say:zet'));
    // R-KP24: in its window the last departure outranks the closure too, so a wall with a two-line transit value still shows it.
    expect(keys.indexOf('say:lastrun')).toBeLessThan(keys.indexOf('say:closure'));
    const lastrun = statementOf(slots, 'lastrun')!;
    expect(lastrun.value).toBe('11\u00a000:05 · 6\u00a000:15 · 14\u00a000:30 · 13\u00a001:00');
    expect(lastrun.valueMarkup!.match(/class="k-say-pair"/g)).toHaveLength(4);
    expect(lastrun.context).toBe(i18n.t('tiles.scheduled'));
  });
});

describe('rankStatements: hysteresis (a shown statement keeps its slot unless outweighed by >= 15)', () => {
  const base: ModuleSnapshot[] = [ZET, snap('prometnice', []), snap('dogadanja', [WORKS_ROW]), snap('emsc', [QUAKE])];
  const round = (modules: readonly ModuleSnapshot[], previous: readonly Slot[]) => rankStatements(input({ modules, slots: 3 }), previous);

  it('a works statement (40) in slot three stays when a weaker kvart (20) appears, and yields only to a stronger newcomer (zet, 80)', () => {
    const first = round(base, []);
    expect(keysOf(first)).toEqual(['say:transit', 'say:quake', 'say:works']);

    const withKvart = withModule(base, 'dogadanja', { items: [WORKS_ROW, KVARTOVSKA] });
    const second = round(withKvart, first);
    expect(keysOf(second)).toEqual(['say:transit', 'say:quake', 'say:works']); // kvart (20) never outranks works (40)

    const withZet = withModule(withKvart, 'dogadanja', { items: [WORKS_ROW, KVARTOVSKA, ZET_NOTICE] });
    const third = round(withZet, second);
    expect(keysOf(third)).toEqual(['say:transit', 'say:quake', 'say:zet']); // 80 - 40 = 40 >= 15: works yields
  });
});

describe('rankStatements: honest absence', () => {
  it('a down zet-rt keeps the transit slot with the honest word and no tone claim beyond "unknown"', () => {
    const modules = withModule(MODULES, 'zet-rt', { status: 'down', items: [] });
    const slots = rankStatements(input({ modules, slots: 8 }), []);
    const transit = statementOf(slots, 'transit')!;
    expect(transit.value).toBe(strings.paired.sourceDown);
    expect(transit.state).toBe('down');
    // Honest data: no nearby-vehicle count and no timestamp beside the down
    // word -- both would be computed over the down snapshot's own (empty)
    // items, i.e. a confirmed zero and a fetch time the source never gave.
    expect(transit.context).toBeUndefined();
    const markup = sayMarkup(slots.filter((s) => s.statement.say === 'transit'), { strings, locale: 'hr', loading: false });
    expect(markup).toContain('data-state="down"');
    expect(markup).not.toContain('k-say-context');
  });

  it('an expired last-run table says nothing (honest absence, not a stale board)', () => {
    const expired = { ...LAST_RUN, validUntil: '2026-09-11T20:00:00Z' }; // 22:00, before EVENING (22:30)
    const slots = rankStatements(input({ now: EVENING, lastRun: expired, slots: 8 }), []);
    expect(keysOf(slots)).not.toContain('say:lastrun');
  });

  it('a quake under magnitude 3.0 is not a statement at all (R-KP9)', () => {
    const modules = withModule(MODULES, 'emsc', { items: [{ ...QUAKE, data: { ...QUAKE.data, mag: 2.1 } }] });
    const slots = rankStatements(input({ modules, slots: 8 }), []);
    expect(keysOf(slots)).not.toContain('say:quake');
  });
});

describe('sayMarkup: the contract 4 shape, escaping and the loading skeleton', () => {
  const escapee: Slot = {
    key: 'say:closure',
    statement: {
      key: 'say:closure', domain: 'mobility', say: 'closure', weight: 70,
      label: strings.say.closure, value: 'Ilica <1> "test"', context: '350 m', tone: 'komunalno',
      aria: 'Zatvoreno, Ilica <1> "test", 350 m',
    },
  };

  it('escapes every text value and attribute; valueMarkup, when present, is trusted through untouched', () => {
    const markup = sayMarkup([escapee], { strings, locale: 'hr', loading: false });
    expect(markup).toContain('<article class="k-say" data-key="say:closure" data-domain="mobility" data-tone="komunalno" data-testid="kiosk-say" data-say="closure" aria-label="Zatvoreno, Ilica &lt;1&gt; &quot;test&quot;, 350 m">');
    expect(markup).toContain('<span class="k-say-kicker">Zatvoreno</span>');
    expect(markup).toContain('<p class="k-say-value" data-replace data-sig="Ilica &lt;1&gt; &quot;test&quot;">Ilica &lt;1&gt; &quot;test&quot;</p>');
    expect(markup).toContain('<p class="k-say-context">350 m</p>');
    expect(markup).not.toContain('<Ilica'); // never unescaped
    const withMarkup: Slot = { ...escapee, statement: { ...escapee.statement, valueMarkup: '<span class="k-say-pair">trusted</span>' } };
    const trustedMarkup = sayMarkup([withMarkup], { strings, locale: 'hr', loading: false });
    expect(trustedMarkup).toContain('data-sig="Ilica &lt;1&gt; &quot;test&quot;"><span class="k-say-pair">trusted</span></p>');
  });

  it('omits the context paragraph and the badges span when the statement carries neither', () => {
    const bare: Slot = { key: 'say:kvart', statement: { key: 'say:kvart', domain: 'civic', say: 'kvart', weight: 20, label: 'Kvart', value: 'Vijest', aria: 'Kvart, Vijest' } };
    const markup = sayMarkup([bare], { strings, locale: 'hr', loading: false });
    expect(markup).not.toContain('k-say-context');
    expect(markup).not.toContain('k-say-badges');
    expect(markup).not.toContain('data-tone');
    expect(markup).not.toContain('data-state');
  });

  it('renders one skeleton while loading with nothing ranked yet, and nothing at all when not loading and empty', () => {
    expect(sayMarkup([], { strings, locale: 'hr', loading: true })).toBe(
      '<article class="k-say" data-skeleton aria-hidden="true"><span class="sk k-say-sk-label"></span><span class="sk k-say-sk-value"></span><span class="sk k-say-sk-context"></span></article>',
    );
    expect(sayMarkup([], { strings, locale: 'hr', loading: false })).toBe('');
  });
});
