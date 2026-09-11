import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

interface Shot {
  n: number;
  from: number;
  to: number;
  seconds: number;
  source: string;
}

/** Parses the shot table: | # | Od | Do | s | Kadar | Izvor | Tekst/titl | */
export function parseShotList(md: string): Shot[] {
  const rows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l));
  return rows.map((l) => {
    const c = l.split('|').map((s) => s.trim());
    return { n: Number(c[1]), from: Number(c[2]), to: Number(c[3]), seconds: Number(c[4]), source: c[6] };
  });
}

describe('docs/video/shot-list.md', () => {
  const shots = parseShotList(readFileSync(new URL('../../docs/video/shot-list.md', import.meta.url), 'utf8'));

  it('has fourteen contiguous shots that sum to exactly 90 seconds', () => {
    expect(shots).toHaveLength(14);
    expect(shots.reduce((n, s) => n + s.seconds, 0)).toBe(90);
    expect(shots[0].from).toBe(0);
    expect(shots.at(-1)!.to).toBe(90);
    for (let i = 0; i < shots.length; i++) {
      expect(shots[i].to - shots[i].from, `shot ${shots[i].n}`).toBe(shots[i].seconds);
      if (i > 0) expect(shots[i].from, `shot ${shots[i].n} starts where ${shots[i - 1].n} ends`).toBe(shots[i - 1].to);
    }
  });

  it('opens and closes with the Remotion cards and names a source for every shot', () => {
    expect(shots[0].source).toBe('Remotion TitleCard');
    expect(shots.at(-1)!.source).toBe('Remotion EndCard');
    for (const s of shots) expect(s.source.length, `shot ${s.n} has no source`).toBeGreaterThan(0);
  });

  it('card durations match the Remotion compositions (4 s title, 6 s end)', () => {
    expect(shots[0].seconds).toBe(4);
    expect(shots.at(-1)!.seconds).toBe(6);
  });
});
