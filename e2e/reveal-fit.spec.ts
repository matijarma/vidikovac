// F-11: a real measured list can keep a short row instead of the scheduler's
// higher-value tall row. Exercise the production fitter and scheduler together
// in Chromium, with production CSS and no network or screenshot mocks.
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NOW = Date.parse('2026-10-01T10:30:00Z');
let bundle: string;
const css = ['tokens.css', 'kiosk.css', 'kiosk-city.css']
  .map(name => readFileSync(resolve('app/src/ui', name), 'utf8')).join('\n');

test.beforeAll(async () => {
  const output = await build({
    stdin: { loader: 'ts', resolveDir: process.cwd(), contents: `
      import { mountTimeline, groupDepartures, taktCandidates } from './app/src/kiosk/timeline';
      import { takt, EMPTY_HISTORY, recordTaktShown } from './shared/kiosk/takt';
      import { createDefaultI18n } from './app/src/i18n/create-default-i18n';
      import { WALL_SAMPLE_IN_PAGE, WALL_SAMPLE_SPEC, departureFailures,
        CALM_MOTION_START_IN_PAGE, CALM_MOTION_MARK_IN_PAGE, CALM_MOTION_READ_IN_PAGE,
        CALM_MOTION_SPEC, calmMotionFailures } from './e2e/wall';
      const now = ${NOW};
      const make = (id, kind, minutes, title, sub = '') => ({
        id, kind, atMs: minutes === null ? null : now + minutes * 60000,
        always: minutes === null, title, sub, live: false, source: 'fixture',
      });
      let timeline, rows, history, firstNodes;
      export function mount(reduced, height) {
        document.querySelector('#host').style.height = height + 'px';
        rows = [
          ...['1', '6', '12'].map((id, i) => ({ ...make('dep:' + id, 'departure', i + 2, 'Dubrava'),
            arrival: { routeId: id, routeName: id } })),
          make('notice:fixture', 'notice', -60, 'ZET poziva putnike da provjere prometne informacije prije polaska prema odabranom odredištu'),
          make('rail:near', 'rail', 10, 'Savski Marof', 'Zagreb Glavni kolodvor'),
          make('event:tall', 'event', 90, 'Razgovor o kulturnom programu grada Zagreba i njegovim brojnim novim događanjima', 'Gradsko dramsko kazalište Gavella'),
          { ...make('open:short', 'open', 240, 'Knjižnica'), detail: { kind: 'open', openKind: 'library' } },
          make('solar:sunset', 'solar', 367, 'Zalazak sunca'),
          make('closure:fixture', 'closure', 7200, 'Grada Vukovara'),
          make('always:fixture', 'always', null, 'Spomenik banu Josipu Jelačiću', 'Trg bana Josipa Jelačića'),
        ];
        timeline = mountTimeline(document.querySelector('#host'), {
          i18n: createDefaultI18n('hr'), reduced, designHeightPx: height,
        });
        history = EMPTY_HISTORY;
        timeline.update(rows, 2200, now);
        firstNodes = new Map([...document.querySelectorAll('ol > li, [data-cell]')].map(el => [el.dataset.id, el]));
        const candidates = taktCandidates(groupDepartures(rows), [], now);
        const estimated = takt(candidates, history, now, { capacity: timeline.shown(), rhythmMs: 20000, reduced, quiet: false });
        CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC);
        return { measured: timeline.page1(), estimated: estimated.page1 };
      }
      export function step(at, reduced, quiet) {
        const candidates = taktCandidates(groupDepartures(rows), [], at);
        timeline.update(rows, 2200, at, { reveal: null, next: [], selectReveal: page1 =>
          takt(candidates, history, at, { capacity: page1.length, measuredPage1: page1, rhythmMs: 20000, reduced, quiet }).reveal });
        const drawn = timeline.drawnReveal();
        const page1 = timeline.page1();
        history = recordTaktShown(history, drawn?.kind === 'page' ? page1.filter(id => !drawn.replaces.includes(id)) : page1,
          drawn, at, 20000);
        return { drawn, page1, history, ids: [...document.querySelectorAll('ol > li')].map(el => el.dataset.id),
          entering: document.querySelectorAll('[data-enter], [data-slide]').length };
      }
      export function sample() {
        CALM_MOTION_MARK_IN_PAGE(CALM_MOTION_SPEC);
        const reading = WALL_SAMPLE_IN_PAGE(WALL_SAMPLE_SPEC);
        const protectedIds = ['departures', 'notice:fixture', 'closure:fixture', 'always:fixture', 'dep:1', 'dep:6', 'dep:12'];
        return { failures: departureFailures(reading), fitOverflow: reading.fitOverflow,
          sameProtected: protectedIds.every(id => document.querySelector('[data-id="' + id + '"]') === firstNodes.get(id)) };
      }
      export function finish() {
        const reading = CALM_MOTION_READ_IN_PAGE(CALM_MOTION_SPEC);
        return { reading, failures: calmMotionFailures(reading),
          allReturned: [...firstNodes].every(([id, node]) => document.querySelector('[data-id="' + id + '"]') === node) };
      }
    ` },
    bundle: true, format: 'iife', globalName: 'RevealFit', platform: 'browser', write: false,
  });
  bundle = output.outputFiles[0]!.text;
});

for (const reduced of [false, true]) {
  test(`F11: measured page reveals a fitting alternative and returns (${reduced ? 'reduced' : 'motion'})`, async ({ page }) => {
    await page.route('**/*', route => route.abort());
    await page.clock.install({ time: NOW });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setContent(`<style>${css}
      body { margin:0; font-family:Arial,sans-serif; }
      .kiosk { position:relative; width:760px; height:800px; --k-zoom:1; --k-main-size:40px; --k-sup-size:28px; --k-gap:18px; --k-read-scale:1; }
      #host { width:680px; }
    </style><div class="kiosk" data-phase="invitation" data-size="wide"><div id="host" class="k-nearby-host"></div></div>`);
    await page.addScriptTag({ content: bundle });
    const evaluate = <T>(expression: string): Promise<T> => page.evaluate(expression);
    const initial = await evaluate<{ measured: string[]; estimated: string[] }>(`RevealFit.mount(${reduced}, 540)`);
    expect(initial.measured).toContain('open:short');
    expect(initial.measured).not.toContain('rail:near');
    expect(initial.estimated).toContain('rail:near');
    expect(initial.estimated).not.toEqual(initial.measured);

    const turn = await evaluate<{ drawn: { ids: string[]; replaces: string[] }; page1: string[]; history: { shownAt: Record<string, number> }; entering: number }>(
      `RevealFit.step(${NOW}, ${reduced}, false)`);
    expect(turn.drawn).toMatchObject({ ids: ['solar:sunset'], replaces: ['open:short'] });
    expect(turn.page1).toEqual(initial.measured);
    expect(turn.history.shownAt['solar:sunset']).toBe(NOW);
    expect(turn.history.shownAt['rail:near']).toBeUndefined();
    expect(turn.history.shownAt['event:tall']).toBeUndefined();
    if (reduced) expect(turn.entering).toBe(0);
    await page.clock.runFor(300);
    expect(await evaluate('RevealFit.sample()')).toEqual({ failures: [], fitOverflow: false, sameProtected: true });

    await page.clock.runFor(19700);
    expect(await evaluate(`RevealFit.step(${NOW + 20000}, ${reduced}, false)`)).toMatchObject({ drawn: null, page1: initial.measured, ids: initial.measured });
    await page.clock.runFor(300);
    expect(await evaluate('RevealFit.sample()')).toEqual({ failures: [], fitOverflow: false, sameProtected: true });
    expect(await evaluate('RevealFit.finish()')).toMatchObject({ failures: [], allReturned: true, reading: { rebuilt: [] } });
  });
}
