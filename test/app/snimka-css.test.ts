import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The stage (S2) and the report (S3) were built in parallel. On 1 October both
// defined `.sn-retro`: the report's absolute hatched overlay landed on the stage's
// "naknadno" badge mark and covered the left of the stage. In v2 six sheets are
// written by four lanes at once, so every pair is checked: no class of its own
// in two sheets. The page sheet (snimka.css) holds the mount classes of the static
// HTML; another sheet may style those (`.sn-strip`, `.sn-screen`) and nothing else
// of the page sheet's.
const url = (p: string) => new URL(`../../${p}`, import.meta.url);
const read = (p: string) => readFileSync(url(p), 'utf8');
const classes = (css: string) => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(sn-[a-z0-9-]+)/g)].map((m) => m[1]!));

const PAGE = 'app/src/ui/snimka.css';
const LANE_SHEETS = ['snimka-stage.css', 'snimka-panels.css', 'snimka-voices.css', 'snimka-report.css', 'snimka-minimap.css']
  .map((f) => `app/src/ui/${f}`)
  .filter((p) => existsSync(url(p)));
/** The page sheet's classes that are mounts in app/snimka/index.html (data-sn-mount slots and the body). */
const html = read('app/snimka/index.html');
const MOUNTS = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/)).filter((c) => c.startsWith('sn-')));

describe('snimka sheets', () => {
  it('the stage and the panel sheets exist beside the page sheet', () => {
    expect(LANE_SHEETS).toEqual(expect.arrayContaining(['app/src/ui/snimka-stage.css', 'app/src/ui/snimka-panels.css']));
  });
  for (let i = 0; i < LANE_SHEETS.length; i++) {
    for (let j = i + 1; j < LANE_SHEETS.length; j++) {
      const [a, b] = [LANE_SHEETS[i]!, LANE_SHEETS[j]!];
      it(`${a.split('/').pop()} and ${b.split('/').pop()} share no class`, () => {
        const ca = classes(read(a));
        const cb = classes(read(b));
        expect([...ca].filter((c) => cb.has(c))).toEqual([]);
      });
    }
  }
  for (const sheet of LANE_SHEETS) {
    it(`${sheet.split('/').pop()} shares with the page sheet only the page's mount classes`, () => {
      const page = classes(read(PAGE));
      const own = classes(read(sheet));
      expect([...own].filter((c) => page.has(c) && !MOUNTS.has(c))).toEqual([]);
    });
  }
  it('the shell sheets keep to their prefixes', () => {
    const panels = [...classes(read('app/src/ui/snimka-panels.css'))];
    expect(panels.filter((c) => !/^sn-(deck|panel|tl|ro|hm|present)(-|$)/.test(c))).toEqual([]);
  });
});
