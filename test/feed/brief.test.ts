import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import type { BriefKind, FetchContext } from '../../worker/feed/schema';
import { GLASNIK_BRIEF_COUNT, fetchGlasnik } from '../../worker/feed/modules/glasnik';
import { fetchDhmzForecast } from '../../worker/feed/modules/dhmz-forecast';
import { ZET_RSS_BRIEF_COUNT, fetchZetRss } from '../../worker/feed/modules/dogadanja/zet-rss';
import { KVARTOVSKE_BRIEF_COUNT, fetchKvartovske } from '../../worker/feed/modules/dogadanja/kvartovske';
import { KOMUNALNE_BRIEF_COUNT, fetchKomunalne } from '../../worker/feed/modules/dogadanja/komunalne';
import { FIXTURE_CONTEXTS } from './fixture-contexts';
import {
  BRIEF_MAX_UNCACHED,
  BRIEF_MODEL,
  BRIEF_NEGATIVE_TTL_SECONDS,
  BRIEF_TIMEOUT_MS,
  BRIEF_TTL_SECONDS,
  acceptBrief,
  briefAll,
  briefKey,
} from '../../worker/feed/brief';

// The brief module is the only place in the Worker that calls Workers AI, and
// everything it does is observable without one: what it asks KV for, what it
// writes back, and what it refuses to pass on. The AI stub here answers a
// call; it never decides whether a test passes -- validation, caching and the
// per-refresh cap are asserted on the returned map and on the KV contents.

const ACT = 'Odluka o izmjenama i dopunama Odluke o komunalnom redu Grada Zagreba';
const GOOD = 'Grad Zagreb mijenja Odluku o komunalnom redu.';
/** Shares no token of five letters or more with ACT, so it must be refused. */
const UNRELATED = 'Nema poveznice s izvornim sadržajem.';

interface StoredValue {
  body: string;
  expirationTtl?: number;
}

class KvStub {
  readonly store = new Map<string, StoredValue>();
  puts: { key: string; body: string; expirationTtl?: number }[] = [];
  /** Set to make every read throw, the way a KV outage would. */
  failReads = false;

  async get(key: string, _type?: string): Promise<unknown> {
    if (this.failReads) throw new Error('kv down');
    const entry = this.store.get(key);
    return entry === undefined ? null : JSON.parse(entry.body);
  }

  async put(key: string, body: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, { body, expirationTtl: options?.expirationTtl });
    this.puts.push({ key, body, expirationTtl: options?.expirationTtl });
  }
}

let kv: KvStub;
let calls: { model: string; input: unknown }[];

function makeEnv(run?: (model: string, input: unknown) => Promise<unknown>, appEnv?: string): Env {
  const ai = run
    ? {
      run: (model: string, input: unknown) => {
        calls.push({ model, input });
        return run(model, input);
      },
    }
    : undefined;
  return { FEED: kv, ...(ai ? { AI: ai } : {}), ...(appEnv ? { APP_ENV: appEnv } : {}) } as unknown as Env;
}

const answers = (text: string) => async () => ({ response: text });

beforeEach(() => {
  kv = new KvStub();
  calls = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('acceptBrief', () => {
  it('accepts a single short line that shares a significant word with the source', () => {
    expect(acceptBrief(GOOD, ACT)).toBe(GOOD);
  });

  it('refuses a line that shares no word of five letters or more with the source', () => {
    expect(acceptBrief(UNRELATED, ACT)).toBeNull();
  });

  it('refuses an empty answer, a second line and anything past 140 characters', () => {
    expect(acceptBrief('   ', ACT)).toBeNull();
    expect(acceptBrief(`${GOOD}\nI još jedan redak o komunalnom redu.`, ACT)).toBeNull();
    expect(acceptBrief(`${'Odluka o komunalnom redu Grada Zagreba, '.repeat(4)}kraj.`, ACT)).toBeNull();
  });

  it('refuses markdown and a preamble list, and unwraps a quoted sentence', () => {
    expect(acceptBrief(`**${GOOD}**`, ACT)).toBeNull();
    expect(acceptBrief(`- ${GOOD} [1]`, ACT)).toBeNull();
    expect(acceptBrief(`"${GOOD}"`, ACT)).toBe(GOOD);
  });

  it('folds case and Croatian diacritics when it compares words', () => {
    expect(acceptBrief('KOMUNALNOM redu se mijenja odluka.', ACT)).toBe('KOMUNALNOM redu se mijenja odluka.');
  });
});

describe('briefAll', () => {
  it('calls the model once on a cache miss and stores the brief for thirty days', async () => {
    const env = makeEnv(answers(GOOD));
    const briefs = await briefAll(env, [ACT], 'akt');

    expect(briefs.get(ACT)).toBe(GOOD);
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(BRIEF_MODEL);
    const key = await briefKey('akt', ACT);
    expect(key).toMatch(/^brief:v1:[0-9a-f]{64}$/);
    expect(kv.puts).toEqual([{ key, body: JSON.stringify({ brief: GOOD }), expirationTtl: BRIEF_TTL_SECONDS }]);
  });

  it('answers a second refresh from KV without calling the model', async () => {
    const first = makeEnv(answers(GOOD));
    await briefAll(first, [ACT], 'akt');
    calls = [];

    const briefs = await briefAll(makeEnv(answers('nikad')), [ACT], 'akt');
    expect(briefs.get(ACT)).toBe(GOOD);
    expect(calls).toHaveLength(0);
  });

  it('keys the cache on the kind as well as the text', async () => {
    const env = makeEnv(answers(GOOD));
    await briefAll(env, [ACT], 'akt');
    await briefAll(env, [ACT], 'novost');
    expect(calls).toHaveLength(2);
    expect(await briefKey('akt', ACT)).not.toBe(await briefKey('novost', ACT));
  });

  it('drops a rejected answer, remembers the refusal for an hour and does not retry it', async () => {
    const env = makeEnv(answers(UNRELATED));
    const briefs = await briefAll(env, [ACT], 'akt');

    expect(briefs.size).toBe(0);
    const key = await briefKey('akt', ACT);
    expect(kv.puts).toEqual([{ key, body: JSON.stringify({ brief: null }), expirationTtl: BRIEF_NEGATIVE_TTL_SECONDS }]);

    calls = [];
    expect((await briefAll(env, [ACT], 'akt')).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('gives up on a call that outruns the four-second ceiling and caches the failure', async () => {
    // Only the clock the ceiling uses is faked: the SHA-256 digest of the
    // cache key resolves off the event loop, so setImmediate below has to
    // stay real for the call to have been started before time is advanced.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const env = makeEnv(() => new Promise(() => {}));
    const pending = briefAll(env, [ACT], 'akt');
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(BRIEF_TIMEOUT_MS + 10);

    expect((await pending).size).toBe(0);
    expect(kv.puts).toEqual([
      { key: await briefKey('akt', ACT), body: JSON.stringify({ brief: null }), expirationTtl: BRIEF_NEGATIVE_TTL_SECONDS },
    ]);
  });

  it('caches a thrown call as a refusal and never rejects', async () => {
    const env = makeEnv(async () => { throw new Error('inference failed'); });
    await expect(briefAll(env, [ACT], 'akt')).resolves.toEqual(new Map());
    expect(kv.puts[0].expirationTtl).toBe(BRIEF_NEGATIVE_TTL_SECONDS);
  });

  it('ignores an answer that is not a string the model produced', async () => {
    const env = makeEnv(async () => ({ result: { nothing: true } }));
    expect((await briefAll(env, [ACT], 'akt')).size).toBe(0);
  });

  it('condenses at most eight uncached texts per refresh and leaves the rest for the next one', async () => {
    const texts = Array.from({ length: 12 }, (_, i) => `${ACT} broj ${i}`);
    const env = makeEnv(async (_model, input) => {
      const text = String((input as { messages: { content: string }[] }).messages[1].content);
      return { response: `Zagreb mijenja odluku o komunalnom redu, stavka ${text.slice(-1)}.` };
    });

    const first = await briefAll(env, texts, 'akt');
    expect(calls).toHaveLength(BRIEF_MAX_UNCACHED);
    expect(first.size).toBe(BRIEF_MAX_UNCACHED);

    calls = [];
    const second = await briefAll(env, texts, 'akt');
    expect(calls).toHaveLength(texts.length - BRIEF_MAX_UNCACHED);
    expect(second.size).toBe(texts.length);
  });

  it('asks for one text once however often it repeats, and skips blank ones', async () => {
    const env = makeEnv(answers(GOOD));
    const briefs = await briefAll(env, [ACT, ACT, '   ', ''], 'akt');
    expect(calls).toHaveLength(1);
    expect(briefs.size).toBe(1);
  });

  it('does nothing at all without the AI binding', async () => {
    const briefs = await briefAll(makeEnv(undefined), [ACT], 'akt');
    expect(briefs.size).toBe(0);
    expect(kv.puts).toHaveLength(0);
  });

  it('does nothing in the test environment, so E2E runs never bill Workers AI', async () => {
    const briefs = await briefAll(makeEnv(answers(GOOD), 'test'), [ACT], 'akt');
    expect(briefs.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('survives a KV that cannot be read, without losing the module refresh', async () => {
    kv.failReads = true;
    const env = makeEnv(answers(GOOD));
    await expect(briefAll(env, [ACT], 'akt')).resolves.toBeInstanceOf(Map);
  });
});

// The five briefed modules, against their real upstream fixtures. This is the
// wiring the ticker depends on: which rows a module offers for condensing,
// under which kind, and that every other row is left exactly as the source
// wrote it. The briefer here answers everything it is given, so what is
// asserted is the module's own choice of rows, not the model's behaviour.
describe('the briefed modules', () => {
  function spy(): { calls: { kind: BriefKind; texts: readonly string[] }[]; brief: NonNullable<FetchContext['brief']> } {
    const calls: { kind: BriefKind; texts: readonly string[] }[] = [];
    return {
      calls,
      brief: async (texts, kind) => {
        calls.push({ kind, texts });
        return new Map(texts.filter((text) => text.trim() !== '').map((text) => [text, `Sažetak: ${text.slice(0, 40)}`]));
      },
    };
  }

  const dogadanja = () => FIXTURE_CONTEXTS.dogadanja;

  it('condenses the newest issue\'s act titles as "akt"', async () => {
    const briefer = spy();
    const payload = await fetchGlasnik({ ...FIXTURE_CONTEXTS.glasnik, brief: briefer.brief });
    expect(briefer.calls).toHaveLength(1);
    expect(briefer.calls[0].kind).toBe('akt');
    expect(briefer.calls[0].texts.length).toBeLessThanOrEqual(GLASNIK_BRIEF_COUNT);
    expect(briefer.calls[0].texts).toEqual(payload.items.slice(0, GLASNIK_BRIEF_COUNT).map((item) => item.title));
    expect(payload.items[0].brief).toBe(`Sažetak: ${payload.items[0].title.slice(0, 40)}`);
  });

  it("never condenses the issue's own table-of-contents row", async () => {
    const briefer = spy();
    const listing = {
      ...FIXTURE_CONTEXTS.glasnik,
      brief: briefer.brief,
      fetch: async (url: string) => (url.includes('akti')
        ? new Response(JSON.stringify({ data: [
          { id: 's0', naziv: 'Sadržaj broja 21' },
          { id: 'a1', naziv: 'Odluka o komunalnom redu Grada Zagreba' },
        ] }))
        : FIXTURE_CONTEXTS.glasnik.fetch(url)),
    };
    const payload = await fetchGlasnik(listing);
    expect(briefer.calls[0].texts).toEqual(['Odluka o komunalnom redu Grada Zagreba']);
    expect(payload.items.map((item) => item.id)).toEqual(['s0', 'a1']);
    expect(payload.items[0].brief).toBeUndefined();
    expect(payload.items[1].brief).toBeDefined();
  });

  it('condenses the DHMZ narrative for today and tomorrow as "prognoza"', async () => {
    const briefer = spy();
    const payload = await fetchDhmzForecast({ ...FIXTURE_CONTEXTS['dhmz-forecast'], brief: briefer.brief });
    expect(briefer.calls).toHaveLength(1);
    expect(briefer.calls[0].kind).toBe('prognoza');
    expect(briefer.calls[0].texts).toEqual(payload.items.map((item) => item.summary));
    expect(payload.items.length).toBe(2);
    for (const item of payload.items) expect(item.brief).toBe(`Sažetak: ${item.summary?.slice(0, 40)}`);
  });

  it('condenses the newest three notices of each ZET feed as "obavijest"', async () => {
    const briefer = spy();
    const result = await fetchZetRss({ ...dogadanja(), brief: briefer.brief });
    expect(briefer.calls).toHaveLength(1);
    expect(briefer.calls[0].kind).toBe('obavijest');
    for (const source of ['zet-novosti', 'zet-promet'] as const) {
      const feed = result.items.filter((item) => item.data.source === source);
      expect(feed.length).toBeGreaterThan(ZET_RSS_BRIEF_COUNT);
      expect(feed.filter((item) => item.brief !== undefined)).toEqual(feed.slice(0, ZET_RSS_BRIEF_COUNT));
    }
  });

  it('condenses the first three neighbourhood headlines as "novost"', async () => {
    const briefer = spy();
    const result = await fetchKvartovske({ ...dogadanja(), brief: briefer.brief });
    expect(briefer.calls).toHaveLength(1);
    expect(briefer.calls[0].kind).toBe('novost');
    expect(result.items.length).toBeGreaterThan(KVARTOVSKE_BRIEF_COUNT);
    expect(result.items.filter((item) => item.brief !== undefined)).toEqual(result.items.slice(0, KVARTOVSKE_BRIEF_COUNT));
  });

  it('condenses the three most recently changed ongoing works as "radovi"', async () => {
    const briefer = spy();
    const result = await fetchKomunalne({ ...dogadanja(), brief: briefer.brief });
    expect(briefer.calls).toHaveLength(1);
    expect(briefer.calls[0].kind).toBe('radovi');
    const briefed = result.items.filter((item) => item.brief !== undefined);
    expect(briefed).toHaveLength(KOMUNALNE_BRIEF_COUNT);
    for (const item of briefed) expect(item.data.status).toBe('U tijeku');
    const newest = [...result.items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .filter((item) => item.data.status === 'U tijeku').slice(0, KOMUNALNE_BRIEF_COUNT);
    expect(briefed.map((item) => item.id).sort()).toEqual(newest.map((item) => item.id).sort());
  });

  it('leaves every module untouched when the context cannot condense anything', async () => {
    const payload = await fetchGlasnik(FIXTURE_CONTEXTS.glasnik);
    const works = await fetchKomunalne(dogadanja());
    expect(payload.items.every((item) => item.brief === undefined)).toBe(true);
    expect(works.items.every((item) => item.brief === undefined)).toBe(true);
  });
});
