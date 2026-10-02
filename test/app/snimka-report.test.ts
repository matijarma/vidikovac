// The dossier's entry (app/src/snimka/report.ts): the hero has no question
// chips in v3 (V3-19); seekAndShow pauses, seeks, sets the subject and the
// layers and brings the instrument into view; the dossier mounts in page
// order with the band "I danas" right after Što snimka pokazuje; and the
// curation the page and the director read (scripts/snimka/news-curated.json)
// carries a valid focus, facts and mentions for every headline.
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { isFocus, isMentions } from '../../shared/snimka';
import * as report from '../../app/src/snimka/report';
import { REPORT_MOUNTS, seekAndShow } from '../../app/src/snimka/report';
import { createLayerStore, createViewStore, type SnimkaContext } from '../../app/src/snimka/context';

const html = readFileSync(new URL('../../app/snimka/index.html', import.meta.url), 'utf8');

function page(): { doc: Document; ctx: SnimkaContext; clock: { pause: ReturnType<typeof vi.fn>; seek: ReturnType<typeof vi.fn> }; scrolled: { id: string; opts: unknown }[] } {
  const win = new Window({ url: 'http://localhost/snimka/' });
  const doc = win.document as unknown as Document;
  doc.write(html.replace(/<script[^>]*><\/script>/g, ''));
  const stage = doc.querySelector('[data-sn-mount="stage"]')!;
  stage.innerHTML = '<div class="sn-stage-root" data-sn-stage=""></div>';
  const scrolled: { id: string; opts: unknown }[] = [];
  for (const el of [...doc.querySelectorAll('[data-sn-stage], section[id]')]) {
    (el as HTMLElement).scrollIntoView = (opts?: unknown) => { scrolled.push({ id: (el as HTMLElement).id || 'stage', opts }); };
  }
  const clock = { pause: vi.fn(), seek: vi.fn() };
  const ctx = { doc, clock, layers: createLayerStore({ bikes: false }), view: createViewStore(), reducedMotion: true } as unknown as SnimkaContext;
  return { doc, ctx, clock, scrolled };
}

describe('no question chips', () => {
  it('the page has none and the module no longer exports their code', () => {
    expect(html).not.toContain('data-sn="questions"');
    expect(html).not.toContain('sn-q-chip');
    for (const name of ['QUESTIONS', 'askQuestion', 'upgradeQuestions']) expect(name in report, name).toBe(false);
  });
});

describe('seekAndShow', () => {
  it('pauses, seeks to the instant, sets the layers and the subject as the user, and brings the instrument into view', () => {
    const { ctx, clock, scrolled } = page();
    const reasons: unknown[] = [];
    ctx.view.onChange((_s, _p, reason) => reasons.push(reason));
    seekAndShow(ctx, 1_790_000_000, { subject: { kind: 'station', id: 'bajs-1' }, layers: { bikes: true } });
    expect(clock.pause).toHaveBeenCalledTimes(1);
    expect(clock.seek).toHaveBeenCalledWith(1_790_000_000_000);
    expect(ctx.layers.get().bikes).toBe(true);
    expect(ctx.view.get().subject).toEqual({ kind: 'station', id: 'bajs-1' });
    expect(reasons).toEqual(['user']);
    // Reduced motion: no smooth scroll.
    expect(scrolled).toEqual([{ id: 'stage', opts: { block: 'start', behavior: 'auto' } }]);
  });
  it('null keeps the clock where it is; without options the subject and the layers stay', () => {
    const { ctx, clock, scrolled } = page();
    ctx.view.set({ subject: { kind: 'route', id: '228' } });
    seekAndShow(ctx, null);
    expect(clock.pause).toHaveBeenCalledTimes(1);
    expect(clock.seek).not.toHaveBeenCalled();
    expect(ctx.view.get().subject).toEqual({ kind: 'route', id: '228' });
    expect(ctx.layers.get().bikes).toBe(false);
    expect(scrolled).toHaveLength(1);
  });
  it('without the stage it brings #snimka into view', () => {
    const { doc, ctx, scrolled } = page();
    doc.querySelector('[data-sn-stage]')!.remove();
    seekAndShow({ ...ctx, reducedMotion: false }, 10);
    expect(scrolled).toEqual([{ id: 'snimka', opts: { block: 'start', behavior: 'smooth' } }]);
  });
});

describe('the mounts', () => {
  it('fill the page\'s dossier slots in page order, the band "I danas" right after Što snimka pokazuje', () => {
    const order = [...html.matchAll(/data-sn-mount="([a-z]+)"/g)].map((m) => m[1]).filter((name) => name !== 'stage');
    expect([...REPORT_MOUNTS]).toEqual(order);
    const live = REPORT_MOUNTS.indexOf('live');
    expect(REPORT_MOUNTS.slice(0, live)).toEqual(['brojke', 'reckoning', 'alternatives']);
    expect(html.indexOf('data-sn-mount="live"')).toBeGreaterThan(html.indexOf('<section id="pokazuje"'));
    expect(html.indexOf('data-sn-mount="live"')).toBeLessThan(html.indexOf('<section id="zaslon"'));
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
