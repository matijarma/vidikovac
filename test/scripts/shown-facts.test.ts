// scripts/shown-facts.mjs and its core (docs/reveal-2026-10-plan/R4.md A1): the twelve synthetic readings of
// test/fixtures/observe/rotation-sample.jsonl, two Zagreb hours, one page reveal.
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../scripts/shown-facts.mjs';
import { revealOf, shownFacts, shownFactsMarkdown } from '../../scripts/lib/shown-facts.mjs';

const FIXTURE = join(__dirname, '..', 'fixtures', 'observe', 'rotation-sample.jsonl');
const raw = async () => readFile(FIXTURE, 'utf8');
const parse = (text: string) => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('shownFacts on the fixture', () => {
  it('counts malformed JSON values, invalid dates and explicit errors as failed readings', () => {
    const at = 1790852388000;
    const result = shownFacts([null, false, 42, 'invalid', [], { at: 1e100, rows: [] },
      { at, rows: [], error: '' }, { at, rows: [] }]);
    expect(result).toMatchObject({ readings: 1, failed: 7 });
    expect(result.hours).toHaveLength(1);
    expect(result.hours[0]).toMatchObject({ readings: 1, failed: 1 });
  });

  it('does not invent row ids or non-finite departure bounds, and retains arbitrary kind keys in JSON', () => {
    const at = 1790852388000;
    const result = shownFacts([
      { at, departures: 2, rows: [{ id: 'valid', kind: '__proto__' }, { id: {}, kind: 'open' }, { id: 'missing-kind' }, { id: '', kind: 'open' }] },
      { at: at + 2000, departures: NaN, rows: [] },
      { at: at + 4000, departures: Infinity, rows: [] },
    ]);
    expect(result.summary.nonTransit).toBe(1);
    expect(JSON.parse(JSON.stringify(result.hours[0].rows))).toEqual(JSON.parse('{"__proto__":["valid"]}'));
    expect(result.hours[0].departures).toEqual({ min: 2, max: 2 });
  });

  it('does not claim continuous reveal dwell across a failed reading', () => {
    const at = 1790852388000;
    const result = shownFacts([
      { at, rows: [], reveal: { list: 'page:10', line: null } },
      { at: at + 2000, error: 'timeout' },
      { at: at + 4000, rows: [], reveal: { list: 'page:10', line: null } },
    ]);
    expect(result.hours[0].reveals).toMatchObject({ count: 2, maxDwellMs: 2000, minGapBeats: 0 });
  });

  it('reports backwards beat differences instead of turning them into a healthy positive gap', () => {
    const at = 1790852388000;
    const result = shownFacts([
      { at, rows: [], reveal: 'page:10' },
      { at: at + 2000, rows: [], reveal: null },
      { at: at + 4000, rows: [], reveal: 'page:7' },
    ]);
    expect(result.hours[0].reveals.minGapBeats).toBe(-3);
  });

  it('counts two hours', async () => {
    const r = shownFacts(parse(await raw()));
    expect(r.readings).toBe(12);
    expect(r.hours.map((h) => h.hour)).toEqual(['2026-10-01 12', '2026-10-01 13']);
    const [h12, h13] = r.hours;
    expect(h12.readings).toBe(6);
    expect(h12.rows).toEqual({
      always: ['always:heritage:Z-1234'],
      cut: ['cut:prekidi:gpz:2026-10-01:selska'],
      event: ['event:kultura-zg:kultura-zg:40117'],
      notice: ['notice:zet-novosti:10166'],
      open: ['opennow:osm-1287'],
    });
    expect(h12.nonTransit).toBe(5);
    expect(h12.city).toBe(4);
    expect(h12.facts).toHaveLength(2);
    expect(h12.nonTransitFacts).toBe(1);
    expect(h12.reveals).toMatchObject({ count: 1, byKind: { advance: 0, page: 1 }, minGapBeats: null, maxDwellMs: 4000 });
    expect(h12.departures).toEqual({ min: 2, max: 3 });
    expect(h13.readings).toBe(6);
    expect(h13.nonTransit).toBe(4);
    expect(h13.city).toBe(4);
    expect(h13.facts).toHaveLength(2);
    expect(h13.nonTransitFacts).toBe(2);
    expect(h13.reveals.count).toBe(0);
    expect(h13.reveals.maxDwellMs).toBeNull();
    expect(h13.departures).toEqual({ min: 3, max: 3 });
    expect(r.summary).toEqual({ nonTransit: 6, fewest: { hour: '2026-10-01 13', nonTransit: 4 } });
  });

  it('ends the Markdown with the fixed summary line', async () => {
    const md = shownFactsMarkdown(shownFacts(parse(await raw())), 'rotation-sample.jsonl');
    expect(md.split('\n').at(-1)).toBe('Fewest non-transit facts: 2026-10-01 13:00 (4).');
    expect(md).toContain('Reveals: 1 (page 1, advance 0); shortest gap none; longest dwell 4 s.');
  });

  it('counts a failed reading in its hour and changes nothing else', async () => {
    const lines = parse(await raw());
    lines.push({ n: 12, at: 1790852412000, error: 'timeout' });
    const r = shownFacts(lines);
    expect(r.hours[1].failed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.hours[1].nonTransit).toBe(4);
    expect(r.summary.nonTransit).toBe(6);
  });

  it('counts rows recorded as kind departure (a wall before R1) as transit', async () => {
    const lines = parse(await raw()).map((l) => ({
      ...l,
      rows: l.rows.map((row: { id: string; kind: string }) => (row.kind === 'departures' ? { ...row, id: 'departure:x', kind: 'departure' } : row)),
    }));
    expect(shownFacts(lines).summary.nonTransit).toBe(6);
  });
});

describe('revealOf', () => {
  it('parses the brief form with a colon-holding id', () => {
    expect(revealOf('page:cut:prekidi:gpz:2026-10-01:selska:89542619')).toEqual({ kind: 'page', id: 'cut:prekidi:gpz:2026-10-01:selska', beat: 89542619 });
  });
  it('parses what R2 writes: page:<beat>, advance:<beat> and the { list, line } object', () => {
    expect(revealOf('page:42')).toEqual({ kind: 'page', id: null, beat: 42 });
    expect(revealOf('advance:7')).toEqual({ kind: 'advance', id: null, beat: 7 });
    expect(revealOf({ list: null, line: 'advance:7' })).toEqual({ kind: 'advance', id: null, beat: 7 });
    expect(revealOf({ list: 'page:3', line: 'advance:7' })?.kind).toBe('page');
  });
  it('returns null for anything else', () => {
    for (const v of [null, undefined, '', 'page', 'page:x', 'other:5', 12, { list: null, line: null }]) expect(revealOf(v)).toBeNull();
  });
  it('rejects unsafe beat numbers and nested or cyclic reveal objects', () => {
    const cyclic: { list?: unknown } = {};
    cyclic.list = cyclic;
    for (const value of ['page:9007199254740992', 'page::42', { list: { list: 'page:42' } }, cyclic]) {
      expect(revealOf(value)).toBeNull();
    }
  });
  it('counts a reveal in the R2 shape from the observer object form', () => {
    const r = shownFacts([
      { at: 1790852388000, rows: [], reveal: { list: null, line: 'advance:9' } },
      { at: 1790852390000, rows: [], reveal: { list: null, line: 'advance:9' } },
      { at: 1790852392000, rows: [], reveal: { list: null, line: null } },
      { at: 1790852394000, rows: [], reveal: { list: 'page:12', line: null } },
    ]);
    expect(r.hours[0].reveals).toMatchObject({ count: 2, byKind: { advance: 1, page: 1 }, minGapBeats: 3, maxDwellMs: 4000 });
  });
});

describe('main', () => {
  it('writes the JSON of the measurement with --json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shown-facts-'));
    await writeFile(join(dir, 'rotation.jsonl'), await raw());
    const out = join(dir, 'out.json');
    const lines: string[] = [];
    const result = await main({ argv: [dir, '--json', out], log: (s: string) => lines.push(s) });
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(JSON.parse(JSON.stringify(result)));
    expect(lines.join('\n').split('\n').at(-1)).toBe('Fewest non-transit facts: 2026-10-01 13:00 (4).');
  });

  it('exits 2 for a missing folder', async () => {
    const before = process.exitCode;
    const lines: string[] = [];
    const result = await main({ argv: [join(tmpdir(), 'no-such-observe-folder')], log: (s: string) => lines.push(s) });
    expect(result).toBeNull();
    expect(process.exitCode).toBe(2);
    expect(lines.join('\n')).toContain('usage:');
    process.exitCode = before;
  });
});
