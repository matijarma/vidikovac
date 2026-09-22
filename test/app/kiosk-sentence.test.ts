import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyCity, type CityState } from '../../shared/city/types';
import {
  acceptSentence, readWrittenSentences, writeSentence,
  type SentenceFact, type WrittenSentence,
} from '../../shared/kiosk/sentence';
import { fetchSentences } from '../../app/src/api';
import {
  createSentenceSequence, modelSentenceFacts, sentenceFacts, templateSentences,
  SENTENCE_COPY_HR, type SentenceFactsInput, type SentenceNearbyRow,
} from '../../app/src/city/sentence';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { sunTimes } from '../../app/src/ui/solar';
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';

const NOW = Date.parse('2026-09-22T12:30:00+02:00');
const i18n = createDefaultI18n('hr');
const closure: SentenceFact = { id: 'closure:ilica', kind: 'radovi', text: 'Ilica je zatvorena do 18:00.', validUntil: NOW + 3_600_000 };
const weather: SentenceFact = { id: 'weather:now', kind: 'vrijeme', text: '21 °C, vedro; danas do 24 °C.', validUntil: NOW + 3_600_000 };
const ctx = { facts: [closure, weather], now: NOW };
const input = (over: Partial<SentenceFactsInput> = {}): SentenceFactsInput => ({
  place: { kind: 'tram', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, stopId: '106_1' },
  rows: [], snapshots: {}, city: emptyCity(), now: NOW, outage: false, locale: 'hr', i18n, radiusM: 2200, ...over,
});
const row = (over: Partial<SentenceNearbyRow>): SentenceNearbyRow => ({
  id: 'closure:ilica', kind: 'closure', title: 'Ilica', sub: '', atMs: NOW + 3_600_000,
  live: false, always: false, source: 'prometnice', ...over,
});
function snapshot(module: ModuleId, items: FeedItem[], over: Partial<ModuleSnapshot> = {}): ModuleSnapshot {
  return { module, items, status: 'live', tier: 'open', fetchedAt: new Date(NOW).toISOString(),
    attribution: { text: 'Fixture', url: 'https://example.test', licence: 'Fixture' }, ...over };
}
const sentence = (text: string, over: Partial<WrittenSentence> = {}): WrittenSentence => ({
  text, kicker: 'kultura', refs: ['fact'], validUntil: NOW + 3_600_000, origin: 'template', ...over,
});

afterEach(() => vi.useRealTimers());

describe('one grounded, time-aware sentence', () => {
  it('normalises stray quotes and retains the real refs and shortest deadline', () => {
    expect(acceptSentence(' „Ilica je zatvorena do 18:00.“ ', ctx)).toEqual({ ok: true });
    expect(writeSentence('"Ilica je zatvorena do 18:00.', ctx, 'model')).toEqual({
      text: closure.text, kicker: 'radovi', refs: [closure.id], validUntil: closure.validUntil, origin: 'model',
    });
  });

  it.each([
    ['', 'empty'],
    ['Ilica…', 'ellipsis'],
    ['Ilica...', 'ellipsis'],
    ['Ilica\nzatvorena.', 'newline'],
    ['Ilica\u2028zatvorena.', 'newline'],
    ['**Ilica** je zatvorena.', 'markup'],
    ['<b>Ilica</b> je zatvorena.', 'markup'],
    ['Ilica\u200b je zatvorena.', 'markup'],
    ['Ilica je zatvorena. Danas do 18:00.', 'multiple-sentences'],
    ['Ilica je zatvorena do 18:00. Danas je 21 °C.', 'multiple-sentences'],
    ['Ilica je zatvorena do 25. 9. Sunce zalazi.', 'multiple-sentences'],
    ['Ilica! Zatvorena do 18:00.', 'multiple-sentences'],
    ['Ilica zatvorena do 19:00.', 'invented-number'],
    ['25 °C, vedro.', 'invented-number'],
    ['Ilica je poplavljena do 18:00.', 'unrelated'],
    ['Ilica je zatvorena od 18:00.', 'unrelated'],
    ['Ilica je zatvorena sutra do 18:00.', 'unrelated'],
    ['Maksimir je zatvoren do 18:00.', 'unrelated'],
    ['Dohvaćeno u 18:00.', 'forbidden-copy'],
    ['Podatak iz registra, nije provjera uživo.', 'forbidden-copy'],
    ['Zid pokazuje Ilicu.', 'forbidden-copy'],
    ['39 zatvaranja.', 'unnamed-count'],
    ['Radovi u gradu 4.', 'unnamed-count'],
  ])('rejects %j (%s)', (text, reason) => {
    expect(acceptSentence(text, ctx)).toEqual({ ok: false, reason });
  });

  it('enforces Unicode character budgets without clipping', () => {
    const text = 'Š'.repeat(80);
    const fact: SentenceFact = { ...closure, text };
    expect(acceptSentence(text, { facts: [fact] }).ok).toBe(true);
    expect(acceptSentence(text + 'Š', { facts: [fact], budget: 200 })).toEqual({ ok: false, reason: 'too-long' });
    expect(templateSentences([{ ...closure, text: 'Ilica '.repeat(18) }], i18n)).toEqual([]);
    expect(templateSentences([closure], i18n, 20)).toEqual([]);
  });

  it('does not mistake decimal commas, dates or a name initial for a second sentence', () => {
    for (const text of ['Ilica je zatvorena do 25. 9.', '12,8 °C, vedro.', '-2,8 °C, vedro.', 'Dežurna ljekarna 24/7: Trg bana J. Jelačića 3.']) {
      const fact: SentenceFact = { ...closure, text };
      expect(acceptSentence(text, { facts: [fact] }).ok, text).toBe(true);
    }
  });

  it('matches complete signed numeric tokens, never substrings of another number', () => {
    for (const [source, text] of [
      ['121 °C, vedro.', '21 °C, vedro.'],
      ['-21 °C, vedro.', '21 °C, vedro.'],
      ['21,5 °C, vedro.', '21 °C, vedro.'],
      ['Ilica je zatvorena do 18:00.', 'Ilica je zatvorena do 8:00.'],
    ]) expect(acceptSentence(text!, { facts: [{ ...weather, text: source! }] })).toEqual({ ok: false, reason: 'invented-number' });
  });

  it('cannot borrow a different street or tram route time through a shared generic verb', () => {
    const other: SentenceFact = { ...closure, id: 'closure:dubrava', text: 'Dubrava je zatvorena do 19:00.' };
    expect(acceptSentence('Ilica je zatvorena do 19:00.', { facts: [closure, other], now: NOW }).ok).toBe(false);
    expect(acceptSentence('Ilica je zatvorena do 19:00.', { facts: [closure, other], refs: [closure.id, other.id], now: NOW }).ok).toBe(false);
    const trams: SentenceFact[] = [
      { id: 'last:6', kind: 'promet', text: 'Zadnji tramvaj 6 polazi u 23:52.', validUntil: NOW + 3_600_000 },
      { id: 'last:7', kind: 'promet', text: 'Zadnji tramvaj 7 polazi u 23:58.', validUntil: NOW + 3_600_000 },
    ];
    expect(acceptSentence('Zadnji tramvaj 6 polazi u 23:58.', { facts: trams, now: NOW }).ok).toBe(false);
  });

  it('requires known, related refs and the fact-set kicker', () => {
    expect(acceptSentence(closure.text, { ...ctx, refs: ['missing'] }).ok).toBe(false);
    expect(acceptSentence(closure.text, { ...ctx, refs: [weather.id] }).ok).toBe(false);
    expect(acceptSentence(closure.text, { ...ctx, refs: [closure.id, closure.id] }).ok).toBe(false);
    expect(acceptSentence(closure.text, { ...ctx, kicker: 'bicikli' })).toEqual({ ok: false, reason: 'wrong-kicker' });
  });

  it('cannot swap times across two cited facts or remove an outage negation', () => {
    const sunset: SentenceFact = { id: 'solar:sunset:today', kind: 'vrijeme', text: 'Sunce zalazi u 19:05.', validUntil: NOW + 3_600_000 };
    expect(acceptSentence('Ilica je zatvorena do 19:05; sunce zalazi u 18:00.', {
      facts: [closure, sunset], refs: [closure.id, sunset.id], now: NOW,
    })).toEqual({ ok: false, reason: 'invented-number' });
    const outage: SentenceFact = { id: 'outage:zet', kind: 'promet', text: SENTENCE_COPY_HR.outage, validUntil: NOW + 600_000 };
    expect(acceptSentence('ZET šalje položaje vozila; polasci su po voznom redu.', { facts: [outage], now: NOW }).ok).toBe(false);
  });

  it('rejects last-tram and sunset facts at the deadline, including timeless forged facts', () => {
    for (const text of ['Zadnji tramvaj 6 polazi u 23:52.', 'Sunce zalazi u 19:05.']) {
      const fact: SentenceFact = { id: 'solar:sunset:today', kind: 'vrijeme', text, validUntil: NOW };
      expect(acceptSentence(text, { facts: [fact], now: NOW - 1 }).ok).toBe(true);
      expect(acceptSentence(text, { facts: [fact], now: NOW })).toEqual({ ok: false, reason: 'expired' });
      expect(acceptSentence(text, { facts: [{ ...fact, validUntil: null }], now: NOW }).ok).toBe(false);
    }
  });

  it('cannot turn a sunset into a sunrise or give a midday sentence a night kicker', () => {
    const sunset: SentenceFact = { id: 'solar:sunset:today', kind: 'vrijeme', text: 'Sunce zalazi u 19:05.', validUntil: NOW + 3_600_000 };
    expect(acceptSentence('Sunce izlazi u 19:05.', { facts: [sunset], now: NOW }).ok).toBe(false);
    expect(acceptSentence('Izlazak sunca je u 19:05.', { facts: [sunset], now: NOW }).ok).toBe(false);
    expect(acceptSentence(closure.text, { facts: [{ ...closure, kind: 'nocas' }], now: NOW }))
      .toEqual({ ok: false, reason: 'wrong-kicker' });
  });

  it('revalidates wire objects and derives expiry rather than trusting returned metadata', () => {
    const good = { text: closure.text, kicker: 'radovi', refs: [closure.id], origin: 'model', validUntil: null };
    expect(readWrittenSentences([null, {}, good, { ...good, kicker: 'nocas' }], ctx)).toEqual([
      { ...good, validUntil: closure.validUntil },
    ]);
  });
});

describe('facts and standalone deterministic fallback', () => {
  it.each(['2026-09-22T04:30:00+02:00', '2026-09-22T07:45:00+02:00', '2026-09-22T12:30:00+02:00',
    '2026-09-22T17:45:00+02:00', '2026-09-22T21:30:00+02:00', '2026-09-23T00:45:00+02:00'])(
    'supplies three distinct natural solar sentences in hr and en with no feeds at %s', (at) => {
      for (const locale of ['hr', 'en']) {
        const clock = Date.parse(at);
        const t = createDefaultI18n(locale);
        const facts = sentenceFacts(input({ now: clock, locale, i18n: t }));
        const templates = templateSentences(facts, t, 40, clock);
        expect(templates).toHaveLength(3);
        expect(new Set(templates.map(s => s.text)).size).toBe(3);
        for (const s of templates) {
          expect(s.text.length).toBeLessThanOrEqual(40);
          expect(s.text).not.toMatch(/…|\.\.\.|zid|nedostupn/i);
          expect(s.validUntil).toBeGreaterThan(clock);
        }
        const sequence = createSentenceSequence({ rhythmMs: 20_000 });
        const changes: string[] = [];
        for (let tick = 0; tick < 600_000; tick += 20_000) {
          const next = sequence.read(templates, clock + tick);
          expect(next).not.toBeNull();
          if (next!.text !== changes.at(-1)) changes.push(next!.text);
        }
        expect(changes).toHaveLength(3);
        expect(new Set(changes).size).toBe(changes.length);
      }
    });

  it('uses Zagreb calendar dates at midnight and switches exactly at sunset', () => {
    const before = input({ now: Date.parse('2026-09-23T00:45:00+02:00') });
    const midnight = sentenceFacts(before)[0]!;
    expect(midnight.id).toBe('solar:sunrise:2026-09-23');
    const sunset = sunTimes(new Date('2026-09-22T12:00:00Z')).sunset.getTime();
    expect(sentenceFacts(input({ now: sunset - 1 }))[0]!.id).toContain('sunset');
    expect(sentenceFacts(input({ now: sunset }))[0]!.id).toContain('sunrise:2026-09-23');
  });

  it('uses selected departure metadata, caps three and expires countdowns at their boundary', () => {
    const rows = Array.from({ length: 5 }, (_, n) => row({
      id: `dep:trip${n}`, kind: 'departure', title: 'Do not parse this', atMs: NOW + (3 + n) * 60_000, live: true,
      arrival: { tripId: `trip${n}`, routeId: '6', routeName: '6', headsign: 'Črnomerec',
        atMs: NOW + (3 + n) * 60_000, live: true, minutes: 3 + n },
    }));
    const facts = sentenceFacts(input({ rows })).filter(f => f.id.startsWith('dep:'));
    expect(facts).toHaveLength(3);
    expect(facts[0]!.text).toBe('Tramvaj 6, smjer Črnomerec, polazi za 3 min.');
    expect(facts[0]!.validUntil).toBe(NOW + 30_000);
    expect(modelSentenceFacts(facts)).toEqual([]);
    expect(sentenceFacts(input({ rows, outage: true })).some(f => f.id.startsWith('dep:'))).toBe(false);
    const outage = sentenceFacts(input({ rows: rows.map(r => ({ ...r, live: false, arrival: { ...r.arrival!, live: false } })), outage: true }));
    expect(outage.find(f => f.id === 'dep:trip0')?.text).toBe('Tramvaj 6, smjer Črnomerec, polazi u 12:33.');
    expect(outage.find(f => f.id === 'outage:zet')?.text).toBe(SENTENCE_COPY_HR.outage);
  });

  it('never interprets an arbitrary row title as a route or timetable', () => {
    expect(sentenceFacts(input({ rows: [row({ kind: 'departure', title: '6 Črnomerec' })] }))
      .some(f => f.id.startsWith('dep:'))).toBe(false);
  });

  it('keeps stale selected closures, dates future events, and drops a long fill intact', () => {
    const facts = sentenceFacts(input({ rows: [
      row({}),
      row({ id: 'event:kino', kind: 'event', title: 'Intersonus', sub: 'Kino Europa · Tramvaj 6', atMs: NOW + 86_400_000 }),
      row({ id: 'always:long', kind: 'always', atMs: null, title: 'Muzej', sub: 'Opis '.repeat(25) }),
    ] }));
    expect(facts.find(f => f.id === 'closure:ilica')?.text).toBe('Ilica: zatvoreno za promet do 13:30.');
    expect(facts.find(f => f.id === 'event:kino')?.text).toBe('Sutra u 12:30 počinje Intersonus, Kino Europa.');
    expect(templateSentences(facts, i18n).some(s => s.refs.includes('always:long'))).toBe(false);
  });

  it('uses individual last/first service instants and only the 20:00–05:00 night kicker', () => {
    for (const [at, expected] of [['2026-09-22T19:59:00+02:00', 'promet'], ['2026-09-22T20:00:00+02:00', 'nocas'],
      ['2026-09-23T04:59:00+02:00', 'nocas'], ['2026-09-23T05:00:00+02:00', 'promet']]) {
      const now = Date.parse(at!);
      const facts = sentenceFacts(input({ now, rows: [row({
        id: 'last:today', kind: 'last', atMs: now + 60_000,
        services: [{ routeId: '6', routeName: '6', atMs: now + 60_000 }, { routeId: '11', routeName: '11', atMs: now - 1 }],
      })] }));
      const last = facts.filter(f => f.id.startsWith('last:'));
      expect(last).toHaveLength(1);
      expect(last[0]!.kind).toBe(expected);
      expect(last[0]!.validUntil).toBe(now + 60_000);
    }
  });

  it('keeps the remaining last tram when an earlier service in the same row has left', () => {
    const facts = sentenceFacts(input({ rows: [row({ id: 'last:today', kind: 'last', atMs: NOW - 1, services: [
      { routeId: '6', routeName: '6', atMs: NOW - 1 }, { routeId: '11', routeName: '11', atMs: NOW + 60_000 },
    ] })] }));
    expect(facts.filter(f => f.id.startsWith('last:')).map(f => f.id)).toEqual(['last:today:11']);
  });

  it('writes the first morning tram with tomorrow, and the night pharmacy without a caveat', () => {
    const now = Date.parse('2026-09-22T22:40:00+02:00');
    const first = Date.parse('2026-09-23T04:16:00+02:00');
    const facts = sentenceFacts(input({ now, rows: [
      row({ id: 'first:tomorrow', kind: 'first', atMs: first, services: [{ routeId: '6', routeName: '6', atMs: first }] }),
      row({ id: 'always:pharmacy', kind: 'pharmacy', title: '24/7', sub: 'Trg bana J. Jelačića 3', atMs: null }),
    ] }));
    expect(facts.find(f => f.id === 'first:tomorrow:6')?.text).toBe('Prvi tramvaj 6 polazi sutra u 04:16.');
    expect(facts.find(f => f.id === 'always:pharmacy')?.text).toBe('Dežurna ljekarna 24/7: Trg bana J. Jelačića 3.');
  });

  it('uses the bus mode and the exact observed forecast maximum', () => {
    const at = NOW + 180_000;
    const facts = sentenceFacts(input({ rows: [row({
      id: 'dep:bus', kind: 'departure', atMs: at,
      arrival: { tripId: 'bus', routeId: '109', routeName: '109', headsign: 'Črnomerec', atMs: at, minutes: null, live: false },
    })], snapshots: {
      'dhmz-now': snapshot('dhmz-now', [{ module: 'dhmz-now', tier: 'open', kind: 'observation', id: 'zg', title: 'Zagreb',
        at: new Date(NOW).toISOString(), data: { temp: 21, weather: 'Vedro' } }]),
      'dhmz-forecast': snapshot('dhmz-forecast', [{ module: 'dhmz-forecast', tier: 'open', kind: 'forecast', id: 'today', title: 'Zagreb',
        at: new Date(NOW).toISOString(), data: { tmax: 24 } }]),
    } }));
    expect(facts.find(f => f.id === 'dep:bus')?.text).toBe('Autobus 109, smjer Črnomerec, polazi u 12:33.');
    expect(facts.find(f => f.id === 'weather:now')?.text).toBe('21 °C, vedro; danas do 24 °C.');
  });

  it('bounds weather by observation age, not the fetch time, and never supplies a guessed maximum', () => {
    const observation: FeedItem = { id: 'zg', module: 'dhmz-now', tier: 'open', kind: 'observation', title: 'Zagreb',
      at: new Date(NOW - 60_000).toISOString(), data: { temp: 21, weather: 'Vedro' } };
    const fresh = snapshot('dhmz-now', [observation]);
    const facts = sentenceFacts(input({ snapshots: { 'dhmz-now': fresh } }));
    expect(facts.find(f => f.id === 'weather:now')?.text).toBe('21 °C, vedro.');
    expect(sentenceFacts(input({ snapshots: { 'dhmz-now': { ...fresh, items: [{ ...observation, at: new Date(NOW - 4 * 3_600_000).toISOString() }] } } }))
      .some(f => f.id === 'weather:now')).toBe(false);
    expect(sentenceFacts(input({ snapshots: { 'dhmz-now': { ...fresh, status: 'down' } } })).some(f => f.id === 'weather:now')).toBe(false);
  });

  it('uses only an operational fresh named BAJS station inside the measured circle', () => {
    const city: CityState = { ...emptyCity(), live: {
      schema: 1, generatedAt: new Date(NOW).toISOString(), sources: [{ id: 'bajs', status: 'live', name: 'BAJS', url: '', licence: '', count: 1 }],
      air: [], consultations: [], bikes: [{ id: '1', name: 'Trg', lon: 15.97726, lat: 45.81286,
        installed: true, renting: true, returning: true, bikes: 7, docks: 2, capacity: 10, observedAt: new Date(NOW - 60_000).toISOString() }],
    } };
    const bike = sentenceFacts(input({ city })).find(f => f.kind === 'bicikli');
    expect(bike?.text).toBe('BAJS Trg: 7 bicikala.');
    expect(bike?.validUntil).toBe(NOW + 120_000);
    expect(sentenceFacts(input({ city, now: NOW + 180_000 })).some(f => f.kind === 'bicikli')).toBe(false);
    expect(sentenceFacts(input({ city, radiusM: undefined })).some(f => f.kind === 'bicikli')).toBe(false);
  });
});

describe('sentence sequence', () => {
  const choices = Array.from({ length: 40 }, (_, n) => sentence(`Muzej prikazuje izložbu broj ${n}.`, { kicker: n % 2 ? 'vrijeme' : 'kultura' }));
  it.each([20_000, 30_000, 60_000])('honours the %i ms rhythm and keeps object identity', rhythmMs => {
    const seq = createSentenceSequence({ rhythmMs });
    const first = seq.read(choices, NOW);
    expect(seq.read(choices.map(s => ({ ...s })), NOW + rhythmMs - 1)).toBe(first);
    expect(seq.read(choices, NOW + rhythmMs)).not.toBe(first);
  });
  it('never repeats in thirty turns, and prefers a different least-recent kicker', () => {
    const seq = createSentenceSequence({ rhythmMs: 20_000 });
    const seen = Array.from({ length: 30 }, (_, n) => seq.read(choices, NOW + n * 20_000));
    expect(new Set(seen.map(s => s?.text)).size).toBe(30);
    expect(seen[0]!.kicker).not.toBe(seen[1]!.kicker);
  });
  it('holds a scarce pool without blanking or restarting the same sentence', () => {
    const seq = createSentenceSequence({ rhythmMs: 20_000 });
    const first = seq.read(choices.slice(0, 2), NOW);
    const second = seq.read(choices.slice(0, 2), NOW + 20_000);
    expect(second).not.toBe(first);
    expect(seq.read(choices.slice(0, 2), NOW + 600_000)).toBe(second);
    expect(seq.read(choices.slice(0, 2), NOW + 620_000)).toBe(first);
  });
  it('drops expired last trams even during a hold or suspension, and skips overflowing text', () => {
    const seq = createSentenceSequence({ rhythmMs: 60_000 });
    const last = sentence('Zadnji tramvaj 6 polazi u 23:52.', { validUntil: NOW + 1_000, kicker: 'promet' });
    expect(seq.read([last, ...choices], NOW)).toBe(last);
    expect(seq.read([last, ...choices], NOW + 1_001)).not.toBe(last);
    const seq2 = createSentenceSequence({ rhythmMs: 20_000 });
    expect(seq2.read([last], NOW)).toBe(last);
    expect(seq2.read([last], NOW + 1_001, true)).toBeNull();
    expect(seq2.read(choices, NOW + 2_000, false, s => s === choices[0])).toBe(choices[1]);
  });
  it('holds identity while suspended and notices removed facts on resume', () => {
    const seq = createSentenceSequence({ rhythmMs: 20_000 });
    const first = seq.read(choices, NOW);
    expect(seq.read(choices, NOW + 100_000, true)).toBe(first);
    expect(seq.read(choices.slice(1), NOW + 101_000)).not.toBe(first);
  });
  it('refreshes changed map refs without restarting the visible sentence', () => {
    const seq = createSentenceSequence({ rhythmMs: 20_000 });
    seq.read([choices[0]!], NOW);
    const updated = { ...choices[0]!, refs: ['new-fact'] };
    expect(seq.read([updated], NOW + 1)).toBe(updated);
  });
});

describe('fetchSentences validates the response', () => {
  it('sends only stable facts, refuses injected metadata, and derives validUntil', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const request = { locale: 'hr' as const, budget: 80, facts: [closure, { ...closure, id: 'dep:trip' }] };
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).facts).toEqual([closure]);
      return new Response(JSON.stringify({ sentences: [
        { text: closure.text, kicker: 'radovi', refs: [closure.id], validUntil: null, origin: 'model' },
        { text: 'Ilica je zatvorena do 19:00.', kicker: 'radovi', refs: [closure.id], validUntil: null, origin: 'model' },
      ] }), { headers: { 'content-type': 'application/json' } });
    });
    expect(await fetchSentences(request, fetcher as typeof fetch)).toEqual([{ text: closure.text,
      kicker: 'radovi', refs: [closure.id], validUntil: closure.validUntil, origin: 'model' }]);
  });
  it('returns an empty result for a non-200 JSON response', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sentences: [sentence(closure.text)] }), { status: 429, headers: { 'content-type': 'application/json' } }));
    expect(await fetchSentences({ locale: 'hr', budget: 80, facts: [closure] }, fetcher as typeof fetch)).toEqual([]);
  });
});
