import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The stage (S2) and the report (S3) were built in parallel. On 1 October both
// defined `.sn-retro`: the report's absolute hatched overlay landed on the stage's
// "naknadno" badge mark and covered the left of the stage. Each sheet owns its
// classes; only the page sheet's mount classes may be extended by both.
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const classes = (css: string) => new Set([...css.matchAll(/\.(sn-[a-z0-9-]+)/g)].map((m) => m[1]));

describe('snimka sheets', () => {
  it('the stage and the report share no class of their own', () => {
    const stage = classes(read('app/src/ui/snimka-stage.css'));
    const report = classes(read('app/src/ui/snimka-report.css'));
    const page = classes(read('app/src/ui/snimka.css'));
    const shared = [...stage].filter((c) => report.has(c) && !page.has(c));
    expect(shared).toEqual([]);
  });
});
