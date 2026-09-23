// The first-viewport classifier has one source (e2e/inventory.ts): the accept
// specs and the production observer import it. This file pins it to the
// verdicts recorded on 21 September at 17:38 (the walkthrough slot 1720-mon,
// three captures copied into test/fixtures/inventory/, the pairing code on the
// kiosk replaced by a placeholder), checks the rules added for the companion
// surfaces, and proves the page-side collector can be shipped into a browser:
// it references nothing but its argument and the DOM.
// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLASSES, COLLECT_IN_PAGE, COLLECT_SPEC, COUNTRE, DISCL, INSTR, INVENTORY_MARKS, PHONE_DEPARTURES, PHONE_PROBES, PHONE_SLOP_RE,
  SHARE_CITY_LABEL, TAB_LABELS, TIMELABEL, TIMEONLY, WALL_ASIDE_MARKS, WEEK_EVENTS_LABEL,
  classify, classifyInventory, firstViewport, firstViewportFailures, isUnit, summarise, unionHeight, unitsWithin,
  type InventoryClass, type InventoryElement, type InventoryPage, type PageInventory, type RawInventory,
} from '../../e2e/inventory';

const root = join(import.meta.dirname, '..', '..');
const fixture = (name: string): RawInventory => JSON.parse(readFileSync(join(root, 'test/fixtures/inventory', name), 'utf8')) as RawInventory;
const PHONE_SADA = fixture('1720-mon-phone-sada.json');
const KIOSK = fixture('1720-mon-kiosk-1920.json');
const KARTA_COLD = fixture('1720-mon-phone-karta-cold.json');

const counts = (inv: RawInventory): Record<InventoryClass, number> =>
  Object.fromEntries(CLASSES.map((c) => [c, summarise(inv).perClass[c].count])) as Record<InventoryClass, number>;

/** A Page that records what evaluate() would ship and answers with `answer`. */
function recorder(answer: unknown): { page: InventoryPage; shipped: () => { fn: string; arg: unknown } } {
  let last: { fn: string; arg: unknown } | null = null;
  const page = { evaluate: (fn: unknown, arg: unknown) => { last = { fn: String(fn), arg }; return Promise.resolve(answer); } } as unknown as InventoryPage;
  return { page, shipped: () => { if (!last) throw new Error('evaluate was not called'); return last; } };
}

/** A unit as the collector writes it, for the rule tests. */
function unit(over: Partial<InventoryElement>): InventoryElement {
  return {
    i: 0, tag: 'span', testid: null, nearestTestid: null, classes: '', role: null, ariaLabel: null, text: '', fullText: '',
    action: null, graphic: false, control: false, rect: { x: 0, y: 0, w: 100, h: 40 }, clip: { top: 0, bottom: 40, h: 40 },
    path: 'main>span', fontSize: 40, dataset: {}, ...over,
  };
}
const surface = (s: string) => ({ elements: [], surface: s, map: null });

describe('the recorded verdicts of 21 September (slot 1720-mon)', () => {
  it('phone Sada right after redemption: INSTRUCTION 1, COUNT 2, EMPTY/DISCLAIMER 3, ANSWER 6, nothing unclassified', () => {
    expect(PHONE_SADA.label).toBe('phone-sada');
    expect(counts(PHONE_SADA)).toEqual({ ANSWER: 6, CONTEXT: 8, INSTRUCTION: 1, COUNT: 2, 'NAV/CHROME': 16, INVITE: 0, 'EMPTY/DISCLAIMER': 3, UNCLASSIFIED: 0 });
    expect(summarise(PHONE_SADA).coveredHeightShare).toBe(0.671);
  });

  it('kiosk 1920×1080: INSTRUCTION 0, COUNT 0, INVITE 8, EMPTY/DISCLAIMER 6, nothing unclassified', () => {
    expect(KIOSK.label).toBe('kiosk-1920x1080');
    expect(counts(KIOSK)).toEqual({ ANSWER: 8, CONTEXT: 5, INSTRUCTION: 0, COUNT: 0, 'NAV/CHROME': 13, INVITE: 8, 'EMPTY/DISCLAIMER': 6, UNCLASSIFIED: 0 });
    expect(summarise(KIOSK).coveredHeightShare).toBe(0.883);
  });

  it('phone Karta cold open: no ANSWER at all, nothing unclassified', () => {
    expect(KARTA_COLD.label).toBe('phone-karta-cold');
    expect(counts(KARTA_COLD)).toEqual({ ANSWER: 0, CONTEXT: 3, INSTRUCTION: 0, COUNT: 1, 'NAV/CHROME': 16, INVITE: 0, 'EMPTY/DISCLAIMER': 1, UNCLASSIFIED: 0 });
    expect(summarise(KARTA_COLD).unclassified).toEqual([]);
  });

  it('shares are the union of vertical spans over the viewport height, areas the clipped boxes over the viewport', () => {
    const s = summarise(PHONE_SADA);
    for (const c of CLASSES) {
      expect(s.perClass[c].viewportHeightShare).toBeGreaterThanOrEqual(0);
      expect(s.perClass[c].viewportHeightShare).toBeLessThanOrEqual(1);
    }
    expect(s.elementCount).toBe(classifyInventory(PHONE_SADA).length);
    expect(s.elementCount).toBe(PHONE_SADA.elements.filter(isUnit).length);
  });

  it('reads today\'s surfaces as red for the reasons the research found, in sentences that name the units', () => {
    const view = (inv: RawInventory) => { const units = classifyInventory(inv); return { inventory: inv, units, summary: summarise(inv, units) }; };
    const sada = firstViewportFailures(view(PHONE_SADA));
    expect(sada).toHaveLength(2);
    expect(sada[0]).toMatch(/^phone-sada: 1 INSTRUCTION unit in the first viewport \(target 0\): "Odaberi i spremi/);
    expect(sada[1]).toMatch(/^phone-sada: 2 COUNT units/);
    // The kiosk has no instruction or count, but its aside carries the highlight's credit line (principle 5).
    const kiosk = firstViewportFailures(view(KIOSK), { wall: true });
    expect(kiosk).toHaveLength(1);
    expect(kiosk[0]).toMatch(/^kiosk-1920x1080: 1 EMPTY\/DISCLAIMER unit in the wall's aside/);
    expect(firstViewportFailures(view(KIOSK))).toEqual([]);
  });

  it('the kiosk fixture carries no pairing code that was ever live', () => {
    const text = JSON.stringify(KIOSK);
    expect(text).toContain('/s/#ABCD-EFGH');
    expect(text).not.toMatch(/8KNE|R56K/);
  });
});

describe('the text rules, verbatim from analyse.mjs', () => {
  it('INSTR, DISCL, COUNTRE, TIMELABEL, TIMEONLY classify the strings the research quoted', () => {
    expect(INSTR.test('Odaberi i spremi stajalište')).toBe(true);
    expect(INSTR.test('Skeniraj za 10 minuta grada.')).toBe(true);
    expect(DISCL.test('Podatak iz registra, nije provjera uživo.')).toBe(true);
    expect(DISCL.test('Dohvaćeno 17:36')).toBe(true);
    expect(DISCL.test('DHMZ · 17:30')).toBe(true);
    expect(DISCL.test('Trg bana Jelačića')).toBe(false);
    expect(COUNTRE.test('39 zatvaranja')).toBe(true);
    expect(COUNTRE.test('+3')).toBe(true);
    expect(COUNTRE.test('6 min')).toBe(false);
    expect(TIMELABEL.test('večeras')).toBe(true);
    expect(TIMEONLY.test('17:45')).toBe(true);
    expect([INSTR, DISCL, COUNTRE, TIMELABEL, TIMEONLY].map((re) => re.flags)).toEqual(['i', 'i', 'i', 'i', 'i']);
  });

  it('eight classes, UNCLASSIFIED last', () => {
    expect(CLASSES).toEqual(['ANSWER', 'CONTEXT', 'INSTRUCTION', 'COUNT', 'NAV/CHROME', 'INVITE', 'EMPTY/DISCLAIMER', 'UNCLASSIFIED']);
  });

  it('unionHeight counts overlapping spans once', () => {
    expect(unionHeight([{ top: 0, bottom: 10, h: 10 }, { top: 5, bottom: 20, h: 15 }, { top: 30, bottom: 40, h: 10 }, { top: 50, bottom: 50, h: 0 }])).toBe(30);
  });
});

describe('the companion surfaces (brief §15.6)', () => {
  const wall = surface('kiosk');
  it('the header: the place is CONTEXT, the sentence an ANSWER, its kicker CONTEXT (ahead of the header chrome rule)', () => {
    expect(classify(unit({ testid: 'kiosk-context', text: 'Kvaternikov trg', path: 'main>div[kiosk].kiosk>header.k-head>p[kiosk-context].k-context' }), wall)).toBe('CONTEXT');
    expect(classify(unit({ testid: 'kiosk-sentence-text', nearestTestid: 'kiosk-sentence-text', text: 'Tramvaj 6 kreće za dvije minute.', within: ['head', 'sentence'], path: 'main>div[kiosk].kiosk>header.k-head>p[kiosk-sentence].k-sentence>span[kiosk-sentence-text]' }), wall)).toBe('ANSWER');
    expect(classify(unit({ testid: 'kiosk-sentence-kicker', text: 'Promet', within: ['head', 'sentence'], path: 'main>header.k-head>p[kiosk-sentence]>span[kiosk-sentence-kicker]' }), wall)).toBe('CONTEXT');
    // Without the collector's marks (an older recording), the path decides the same.
    expect(classify(unit({ testid: 'kiosk-sentence-text', text: 'Tramvaj 6 kreće za dvije minute.', path: 'main>header.k-head>p[kiosk-sentence]>span[kiosk-sentence-text]' }), wall)).toBe('ANSWER');
  });

  it('the timeline: the head is CONTEXT; a row\'s text an ANSWER (a line number is not a count), its time CONTEXT, a caveat in it EMPTY/DISCLAIMER', () => {
    const inRow = { within: ['aside', 'nearby', 'nearbyRow'], nearestTestid: 'nearby-rows' };
    expect(classify(unit({ testid: 'nearby-head', text: 'U blizini · 2 km · ~15 min', within: ['aside', 'nearby'], path: 'aside>section[nearby]>h2[nearby-head]' }), wall)).toBe('CONTEXT');
    expect(classify(unit({ ...inRow, classes: 'nearby-title', text: 'Sopot' }), wall)).toBe('ANSWER');
    expect(classify(unit({ ...inRow, classes: 'line', text: '6' }), wall)).toBe('ANSWER');
    expect(classify(unit({ ...inRow, tag: 'time', text: '17:47' }), wall)).toBe('CONTEXT');
    expect(classify(unit({ ...inRow, classes: 'nearby-when', text: 'uvijek' }), wall)).toBe('CONTEXT');
    expect(classify(unit({ ...inRow, classes: 'nearby-sub', text: 'Podatak iz registra, nije provjera uživo.' }), wall)).toBe('EMPTY/DISCLAIMER');
    expect(classify(unit({ classes: 'nearby-title', text: 'Sopot', path: 'aside>section[nearby]>ol[nearby-rows]>li.nearby-row>span.nearby-title' }), wall)).toBe('ANSWER');
  });

  it('the map note is a caveat; the phone place is CONTEXT; "Podijeli grad" is header chrome, the code it opens an invitation; the end of a session invites', () => {
    const phone = surface('phone');
    expect(classify(unit({ testid: 'map-note', text: 'Vozila se trenutačno ne prikazuju.' }), wall)).toBe('EMPTY/DISCLAIMER');
    expect(classify(unit({ testid: 'sada-place', text: 'Trg bana Jelačića' }), phone)).toBe('CONTEXT');
    expect(classify(unit({ tag: 'button', control: true, testid: 'share-city', action: 'share-city', text: 'Podijeli grad' }), phone)).toBe('NAV/CHROME');
    expect(classify(unit({ testid: 'share-code', text: 'ABCD-EFGH' }), phone)).toBe('INVITE');
    expect(classify(unit({ tag: 'a', control: true, href: '/hitno', text: 'Hitno', within: ['sessionEnded'], nearestTestid: 'session-ended' }), phone)).toBe('INVITE');
    expect(classify(unit({ tag: 'button', control: true, classes: 'ki-tab', testid: 'tab-more', text: 'Još' }), phone)).toBe('NAV/CHROME');
  });

  it('the wall\'s aside is the list and the QR card; the footer is its own region', () => {
    const units = classifyInventory(KIOSK);
    expect(WALL_ASIDE_MARKS).toEqual(['aside', 'nearby', 'card']);
    const aside = unitsWithin(units, WALL_ASIDE_MARKS);
    expect(aside.length).toBeGreaterThan(0);
    expect(aside.every((u) => /(^|>)aside/.test(u.path))).toBe(true);
    expect(unitsWithin(units, ['footer']).every((u) => u.path.includes('[safety-strip]'))).toBe(true);
    expect(unitsWithin(units, ['footer']).length).toBeGreaterThan(0);
  });
});

describe('the phone\'s probe names and owner strings', () => {
  it('reads the §15.6 names and the byte-exact labels the phone spec asserts', () => {
    expect(PHONE_PROBES).toMatchObject({
      sadaPlace: '[data-testid=sada-place]', sadaSentence: '[data-testid=sada-sentence]', sadaMapBand: '[data-testid=sada-map-band]',
      sadaDepartures: '[data-testid=day-departures] > li.sada-departure', shareCity: '[data-testid=share-city]', shareCode: '[data-testid=share-code]',
      sessionEnded: '[data-testid=session-ended]', tabMore: '[data-testid=tab-more]', dirKultura: '[data-testid=dir-kultura]', stopBoard: '[data-testid=stop-board]',
    });
    expect(PHONE_DEPARTURES).toBe(3);
    expect(TAB_LABELS).toEqual(['Sada', 'Karta', 'Još']);
    expect(SHARE_CITY_LABEL).toBe('Podijeli grad');
    expect(WEEK_EVENTS_LABEL).toBe('Događanja ovaj tjedan');
    // Today's phone Sada carries two of the retired strings.
    const text = PHONE_SADA.elements.map((e) => e.text).join(' | ');
    expect(PHONE_SLOP_RE.test(text)).toBe(true);
  });
});

describe('the collector ships everything the page needs in its argument', () => {
  it('firstViewport evaluates COLLECT_IN_PAGE with COLLECT_SPEC and classifies what comes back', async () => {
    const { label: _label, at: _at, zagreb: _zagreb, surface: _surface, ...pageSide } = KIOSK;
    const { page, shipped } = recorder(pageSide);
    const view = await firstViewport(page, 'kiosk-again', { surface: 'kiosk' });
    const { fn, arg } = shipped();
    expect(fn).toBe(String(COLLECT_IN_PAGE));
    expect(arg).toEqual(COLLECT_SPEC);
    expect(view.inventory.label).toBe('kiosk-again');
    expect(view.summary.perClass.INVITE.count).toBe(8);
    expect(view.units.length).toBe(view.summary.elementCount);
  });

  it('the page-side source names no module identifier and runs from its own text alone', () => {
    const source = String(COLLECT_IN_PAGE);
    expect(source).not.toMatch(/\b(COLLECT_SPEC|INVENTORY_MARKS|CLASSES|INSTR|DISCL|COUNTRE|TIMELABEL|TIMEONLY|classify|isUnit|unionHeight|summarise|MARK_PATHS)\b/);
    // What Playwright does with it: the function's text, evaluated in a scope that has only the DOM.
    const shippedFn = new Function(`return (${source});`)() as typeof COLLECT_IN_PAGE;
    document.body.innerHTML = '<aside><section data-testid="nearby"><h2 data-testid="nearby-head">U blizini · 2 km · ~15 min</h2><ol><li class="nearby-row" data-kind="departure" data-id="t1"><span class="nearby-title">Sopot</span><time>17:47</time></li></ol></section></aside><p style="display:none">skrivena</p>';
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      el.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 210, bottom: 50, width: 200, height: 40, toJSON: () => ({}) }) as DOMRect;
    }
    const out: PageInventory = shippedFn(COLLECT_SPEC);
    const texts = out.elements.map((e) => e.text);
    expect(texts).toEqual(['U blizini · 2 km · ~15 min', 'Sopot', '17:47']);
    const title = out.elements.find((e) => e.text === 'Sopot')!;
    expect(title.within).toEqual(['aside', 'nearby', 'nearbyRow']);
    expect(title.path).toBe('aside>section[nearby]>ol>li.nearby-row>span.nearby-title');
    expect(out.elements.find((e) => e.tag === 'li')).toBeUndefined();
    expect(Object.keys(COLLECT_SPEC.marks).sort()).toEqual(Object.keys(INVENTORY_MARKS).sort());
    const inv: RawInventory = { label: 'dom', surface: 'kiosk', ...out };
    expect(classifyInventory(inv).map((u) => u.class)).toEqual(['CONTEXT', 'ANSWER', 'CONTEXT']);
  });
});
