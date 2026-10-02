// The dossier's entry (app/src/snimka/report.ts): the four question chips of
// Ukratko become buttons that pause, seek to their chapter, set the layer
// or the subject and bring the instrument into view, each with a link to the
// section that answers; and the curation the page and the director read
// (scripts/snimka/news-curated.json) carries a valid focus, facts and
// mentions for every headline.
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { isFocus, isMentions, type SnimkaEvent } from '../../shared/snimka';
import { QUESTIONS, askQuestion, upgradeQuestions } from '../../app/src/snimka/report';
import { createLayerStore, createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import { buildEvents } from '../../e2e/snimka-fixtures';

const html = readFileSync(new URL('../../app/snimka/index.html', import.meta.url), 'utf8');

const V2_QUESTIONS = '<nav class="chips sn-q-nav" aria-label="Ulazi u snimku" data-sn="questions">' +
  '<a class="chip sn-q-chip" href="#zamjene" data-sn-q="1" data-sn-chapter="prvo-jutro" data-sn-layer="bikes" data-sn-section="zamjene" data-sn-text="narration.q1">Što sam mogao umjesto tramvaja?</a>' +
  '<a class="chip sn-q-chip" href="#tijek" data-sn-q="2" data-sn-chapter="trece-jutro" data-sn-subject="route:17" data-sn-section="tijek" data-sn-text="narration.q2">Koliko je štrajk bio potpun?</a>' +
  '<a class="chip sn-q-chip" href="#otvoreno" data-sn-q="3" data-sn-chapter="stanje-usluge" data-sn-section="otvoreno" data-sn-text="narration.q3">Što je grad mogao znati u svakoj minuti?</a>' +
  '<a class="chip sn-q-chip" href="#vidjelo" data-sn-q="4" data-sn-section="vidjelo" data-sn-text="narration.q4">Odakle brojevi i kako ih provjeriti?</a></nav>';

function page(): { doc: Document; ctx: SnimkaContext; clock: { pause: ReturnType<typeof vi.fn>; seek: ReturnType<typeof vi.fn> }; scrolled: string[] } {
  const win = new Window({ url: 'http://localhost/snimka/' });
  const doc = win.document as unknown as Document;
  doc.write(html.replace(/<script[^>]*><\/script>/g, ''));
  // v3 removed the question chips from the page (report.ts upgradeQuestions is dead until W4b deletes it): the v2
  // markup is put back here so the module keeps its tests while it lives.
  if (!doc.querySelector('[data-sn="questions"]')) doc.getElementById('ukratko')!.insertAdjacentHTML('beforeend', V2_QUESTIONS);
  const stage = doc.querySelector('[data-sn-mount="stage"]')!;
  stage.innerHTML = '<div class="sn-stage-root" data-sn-stage=""></div>';
  const scrolled: string[] = [];
  for (const el of [...doc.querySelectorAll('[data-sn-stage], section[id], span[id][hidden]')]) {
    (el as HTMLElement).scrollIntoView = () => { scrolled.push((el as HTMLElement).id || 'stage'); };
  }
  const clock = { pause: vi.fn(), seek: vi.fn() };
  const events: SnimkaEvent[] = buildEvents().events;
  const ctx = { doc, clock, events, layers: createLayerStore({ bikes: false }), view: createViewStore(), reducedMotion: true } as unknown as SnimkaContext;
  return { doc, ctx, clock, scrolled };
}

const atOf = (id: string): number => buildEvents().events.find((e) => e.id === id)!.atSec;

describe('the four questions', () => {
  it('q1 pauses, seeks to the first morning, turns the bikes on and brings the instrument into view', () => {
    const { ctx, clock, scrolled } = page();
    expect(askQuestion(ctx, QUESTIONS[0]!)).toBe(atOf('prvo-jutro'));
    expect(clock.pause).toHaveBeenCalled();
    expect(clock.seek).toHaveBeenCalledWith(atOf('prvo-jutro') * 1000);
    expect(ctx.layers.get().bikes).toBe(true);
    expect(ctx.view.get().subject).toBeNull();
    expect(scrolled).toEqual(['stage']);
  });
  it('q2 seeks to the third morning and sets line 17 as the subject, as the user', () => {
    const { ctx, clock } = page();
    const reasons: unknown[] = [];
    ctx.view.onChange((_s, _p, reason) => reasons.push(reason));
    askQuestion(ctx, QUESTIONS[1]!);
    expect(clock.seek).toHaveBeenCalledWith(atOf('trece-jutro') * 1000);
    expect(ctx.view.get().subject).toEqual({ kind: 'route', id: '17' });
    expect(reasons).toEqual(['user']);
  });
  it('q3 seeks to the chapter of the service state; q4 seeks nothing and goes to Što se vidjelo', () => {
    const { ctx, clock, scrolled } = page();
    askQuestion(ctx, QUESTIONS[2]!);
    expect(clock.seek).toHaveBeenLastCalledWith(atOf('stanje-usluge') * 1000);
    clock.seek.mockClear();
    expect(askQuestion(ctx, QUESTIONS[3]!)).toBeNull();
    expect(clock.seek).not.toHaveBeenCalled();
    expect(clock.pause).toHaveBeenCalledTimes(2);
    expect(scrolled.at(-1)).toBe('vidjelo');
  });
  it('a chapter the events lack still pauses and scrolls, without a seek', () => {
    const { ctx, clock } = page();
    (ctx as { events: SnimkaEvent[] }).events = [];
    expect(askQuestion(ctx, QUESTIONS[0]!)).toBeNull();
    expect(clock.pause).toHaveBeenCalled();
    expect(clock.seek).not.toHaveBeenCalled();
  });
});

describe('upgradeQuestions on the page', () => {
  it('turns the four links into buttons with their text, each followed by a link to the answering section', () => {
    const { doc, ctx, clock } = page();
    const off = upgradeQuestions(ctx, doc);
    const nav = doc.querySelector<HTMLElement>('[data-sn="questions"]')!;
    expect(nav.dataset.snQuestions).toBe('ready');
    const buttons = [...nav.querySelectorAll<HTMLButtonElement>('button.sn-q-chip')];
    expect(buttons.map((b) => b.type)).toEqual(['button', 'button', 'button', 'button']);
    // The accessible name is the question alone; the chapter and section are its description.
    expect(buttons.map((b) => b.textContent)).toEqual(['Što sam mogao umjesto tramvaja?', 'Koliko je štrajk bio potpun?', 'Što je grad mogao znati u svakoj minuti?', 'Odakle brojevi i kako ih provjeriti?']);
    expect(nav.querySelectorAll('a.sn-q-chip')).toHaveLength(0);
    const hint = doc.getElementById(buttons[1]!.getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toBe('Otvara poglavlje Treće jutro; odgovor je u odjeljku Tijek.');
    expect(buttons[3]!.hasAttribute('aria-describedby')).toBe(false);
    const links = [...nav.querySelectorAll<HTMLAnchorElement>('a.sn-q-to')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#zamjene', '#tijek', '#otvoreno', '#vidjelo']);
    expect(links[0]!.textContent).toBe('Odgovor u odjeljku Zamjene');
    for (const id of ['zamjene', 'tijek', 'otvoreno', 'vidjelo']) expect(doc.getElementById(id)).not.toBeNull();
    buttons[1]!.click();
    expect(clock.seek).toHaveBeenCalledWith(atOf('trece-jutro') * 1000);
    expect(ctx.view.get().subject).toEqual({ kind: 'route', id: '17' });
    off();
  });
});

describe('the curated headlines (scripts/snimka/news-curated.json)', () => {
  const curated = JSON.parse(readFileSync(new URL('../../scripts/snimka/news-curated.json', import.meta.url), 'utf8')) as { items: { at: string; outlet: string; beat: string; title: string; link: string; focus: unknown; facts: string[]; mentions: unknown }[] };
  const routes = JSON.parse(readFileSync(new URL('../../app/src/data/zet-routes.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const stops = new Set((JSON.parse(readFileSync(new URL('../../app/public/data/stops.json', import.meta.url), 'utf8')) as { id: string }[]).map((s) => s.id));
  // The places of Appendix C (scripts/snimka/places.json is the pipeline's; these are its ids).
  const PLACES = new Set(['jelacic', 'glavni-kolodvor', 'crnomerec', 'dubrava', 'savski-most', 'kvaternikov-trg', 'ljubljanica', 'borongaj', 'zaprude', 'spremiste-dubrava', 'spremiste-ljubljanica', 'rebro']);
  const FACT = /^(seen|expected|state|bikes|bikesEmpty|closures|temp|feed|route:[^\s:]+|station:[^\s:]+)$/;
  it('holds the 65 headlines of v1 and at most eight after-day items under beat nakon, every link once, in time order', () => {
    const items = curated.items;
    const after = items.filter((i) => i.beat === 'nakon');
    expect(items.length - after.length).toBe(65);
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThanOrEqual(8);
    expect(new Set(items.map((i) => i.link)).size).toBe(items.length);
    for (const i of items) expect(['jutarnji', 'vecernji', 'n1']).toContain(i.outlet);
  });
  it('every item has a focus, facts and mentions that resolve against the routes, the stops and the places', () => {
    for (const i of curated.items) {
      expect(isFocus(i.focus), i.link).toBe(true);
      expect(isMentions(i.mentions), i.link).toBe(true);
      expect(i.facts.length, i.link).toBeGreaterThan(0);
      for (const f of i.facts) {
        expect(f, i.link).toMatch(FACT);
        if (f.startsWith('route:')) expect(routes[f.slice(6)], f).toBeDefined();
      }
      const focus = i.focus as { kind: string; id?: string };
      if (focus.kind === 'route') expect(routes[focus.id!], focus.id).toBeDefined();
      if (focus.kind === 'stop') expect(stops.has(focus.id!), focus.id).toBe(true);
      if (focus.kind === 'place') expect(PLACES.has(focus.id!), focus.id).toBe(true);
      const m = i.mentions as { routes?: string[]; places?: string[] };
      for (const r of m.routes ?? []) expect(routes[r], r).toBeDefined();
      for (const p of m.places ?? []) expect(PLACES.has(p), p).toBe(true);
    }
  });
  it('the hand overrides: KB Dubrava, Rebro, line 12 and the return of lines 2, 5 and 17', () => {
    const by = (needle: string) => curated.items.find((i) => i.title.includes(needle))!;
    expect(by('KB Dubrava').focus).toEqual({ kind: 'stop', id: '970_23' });
    expect(by('do Rebra?').focus).toEqual({ kind: 'place', id: 'rebro' });
    expect(by('12-ice').focus).toEqual({ kind: 'route', id: '12' });
    expect(by('tramvaji 2, 5 i 17').mentions).toEqual({ routes: ['2', '5', '17'] });
    expect(by('jedna redovna autobusna linija').focus).toEqual({ kind: 'route', id: '228' });
  });
});
