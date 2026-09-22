// Lane S constants and the S9 key-group rule: the long press, the two
// legibility floors on the kiosk sheet, and the key shapes no package may add.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { LONG_PRESS_MS } from '../../app/src/kiosk/constants';

const APP = join(import.meta.dirname, '..', '..', 'app', 'src');
const read = (rel: string): string => readFileSync(join(APP, rel), 'utf8');

describe('lane S constants', () => {
  it('opens settings after an 800 ms press', () => {
    expect(LONG_PRESS_MS).toBe(800);
  });

  it('declares the 40 px and 28 px legibility floors on the kiosk sheet’s :root', () => {
    const root = /(^|\n):root\s*\{([^}]*)\}/.exec(read('ui/kiosk.css'))?.[2] ?? '';
    expect(root).toContain('--k-main-size: 40px;');
    expect(root).toContain('--k-sub-size: 28px;');
  });
});

describe('S9 key groups', () => {
  it('states the ownership at the top of kiosk/strings.ts', () => {
    const head = read('kiosk/strings.ts').split('\n').slice(0, 12).join('\n');
    for (const group of ['kiosk.nearby.*', 'kiosk.sentence.*', 'kiosk.handheld.*', 'kiosk.legend.{tram,bikes,culture}', 'kiosk.setup.*', 'kiosk.settings.*', 'sada.*', 'directory.*', 'arrivals.timetable', 'layers.u-pokretu']) {
      expect(head).toContain(group);
    }
  });

  it('has no top-level nearby, no sentence.kicker and no time.untilDate in either catalogue', () => {
    for (const catalogue of [hr, en] as Array<Record<string, unknown>>) {
      expect(catalogue).not.toHaveProperty('nearby');
      expect(catalogue).not.toHaveProperty(['sentence', 'kicker']);
      expect(catalogue).not.toHaveProperty(['time', 'untilDate']);
    }
  });
});
