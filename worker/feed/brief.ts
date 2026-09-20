import type { Env } from '../env';
import type { BriefKind } from './schema';
import { isTestEnvironment } from '../config';

// One line per item, for the kiosk header ticker (WP6).
//
// A gazette act title, DHMZ's narrative `zg_text`, a ZET notice, a works
// description or a neighbourhood headline is written to be read sitting down.
// The ticker shows one item for eight seconds on a wall, so each of those
// texts is condensed once into a single Croatian sentence by Workers AI,
// cached by content, and put on the item as `FeedItem.brief`. The ticker
// reads `item.brief ?? item.title`, so every failure here is invisible: no
// brief simply means the original text.
//
// Three rules keep this cheap and safe.
//   - Nothing is ever generated twice: the KV key is the hash of the text
//     itself, so an unchanged notice costs one read for thirty days, and a
//     text the model cannot condense costs one read for an hour instead of a
//     call per refresh.
//   - A module refresh generates at most BRIEF_MAX_UNCACHED new briefs; the
//     rest are picked up by the next refresh. A source that republishes its
//     whole list cannot turn into a burst of inference calls.
//   - briefAll never rejects and never throws. A module fetcher must throw on
//     upstream failure (worker/feed/schema.ts) so the cache layer can fall
//     back to the KV last-good copy; a missing brief is not an upstream
//     failure and must never cost the city its feed.
//
// The seam the modules use is `briefRows` in worker/feed/payload.ts: it takes
// the briefer off the FetchContext and touches nothing in this file, so the
// five briefed modules stay free of the Worker's environment types.

/**
 * Workers AI text generation, small and fast: the ticker needs one sentence,
 * not prose. Pinned to a name the catalogue actually lists (`npx wrangler ai
 * models`): an unlisted name may answer today and stop resolving without
 * notice, and briefs failing quietly is not a reason to depend on one.
 */
export const BRIEF_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
/**
 * Gazette act titles alone are worth the large model. The small one restated
 * both act titles it was given in the live probe instead of condensing them
 * ("... donesena je.", 164 characters from a 151-character title), and the
 * gazette is the source the owner named unreadable. A gazette issue carries a
 * handful of acts, so the cost of the larger model here is a rounding error.
 */
export const BRIEF_MODEL_AKT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** The model a kind is read with. Everything but the gazette uses the small one. */
export function briefModel(kind: BriefKind): string {
  return kind === 'akt' ? BRIEF_MODEL_AKT : BRIEF_MODEL;
}

/** KV key prefix in `env.FEED`; the version moves if the prompt or the stored shape changes. */
export const BRIEF_KEY_PREFIX = 'brief:v3:';
export const BRIEF_TTL_SECONDS = 30 * 24 * 60 * 60;
/** A refused or failed generation is remembered this long, so a bad text is not retried every refresh. */
export const BRIEF_NEGATIVE_TTL_SECONDS = 60 * 60;
export const BRIEF_TIMEOUT_MS = 4000;
export const BRIEF_MAX_UNCACHED = 8;
/** The prompt asks for 110; a few characters over is still one readable line, much more is not. */
export const BRIEF_MAX_CHARS = 140;
/** A word this long is specific enough that sharing it proves the answer read the text. */
const SIGNIFICANT_TOKEN_LETTERS = 5;

/**
 * How many distinct significant words a brief must share with its source.
 *
 * One is enough almost everywhere. The gazette is the exception: an act title
 * is largely a proper noun beside a legal noun, so a single shared word can be
 * carried by the street or the institution alone while the rest of the
 * sentence is invented -- the live probe's "Trakošćanska za sve" became a story
 * about flooded lakes on the strength of one shared name. Acts are also the
 * one kind read by the large model, whose answers in the probe shared two to
 * five words with their own title, so asking for two costs nothing real and
 * closes the one-word hole. Stemming was considered and refused: it would have
 * matched "Novoselca" to "Novoselac" and published a fabricated NBA career.
 */
export function briefMinSharedTokens(kind: BriefKind): number {
  return kind === 'akt' ? 2 : 1;
}

/**
 * Below this, a text is already the one line the ticker wants and is never
 * sent to the model. Measured, not guessed: in the first live probe eleven of
 * seventeen answers came back LONGER than the text they were given, and every
 * fabrication in that run -- an NBA career invented for "Dani Novoselca", a
 * flood invented for "Trakošćanska za sve" -- was the model padding a headline
 * that had nothing to condense. A short title is its own best ticker line.
 */
export const BRIEF_MIN_SOURCE_CHARS = 120;

/**
 * The floor, per kind. An act title is the one text that is never "already
 * one line" however short it is: it is written as a legal citation rather
 * than as a sentence, which is exactly what makes the gazette unreadable on
 * a wall, so every act is eligible.
 */
export function briefMinSourceChars(kind: BriefKind): number {
  return kind === 'akt' ? 0 : BRIEF_MIN_SOURCE_CHARS;
}

export const BRIEF_SYSTEM_PROMPT =
  'Ti si urednik gradskog informativnog zaslona u Zagrebu. Iz zadanog teksta napiši jednu rečenicu na hrvatskom jeziku, ' +
  'najviše 110 znakova, koja sadrži samo činjenice iz tog teksta. Rečenica mora biti kraća od zadanog teksta. ' +
  'Ne dodaj ništa čega u tekstu nema, ne nagađaj razloge, mjesta ni datume i ne prepisuj cijeli tekst. ' +
  'Bez uvoda, bez navodnika, bez markdowna, bez novog retka. Odgovori isključivo tom rečenicom.';

/**
 * The gazette's own prompt. An act title is a legal citation; the reader is a
 * person standing in front of a public screen, who needs to know what the act
 * changes and for whom, not its number or the statute it amends.
 */
export const BRIEF_SYSTEM_PROMPT_AKT =
  'Pišeš za građanina koji stoji pred javnim zaslonom u Zagrebu. Iz naziva akta Grada Zagreba napiši jednu jednostavnu ' +
  'rečenicu na hrvatskom jeziku, najviše 110 znakova: što taj akt mijenja ili uređuje i za koga. Izostavi broj i datum akta, ' +
  'pozivanje na propise i izraze poput "Odluka o izmjenama i dopunama". Ne nagađaj ništa što u nazivu ne piše. ' +
  'Bez uvoda, bez navodnika, bez markdowna, bez novog retka. Odgovori isključivo tom rečenicom.';

/** The system prompt a kind is read with. */
export function briefPrompt(kind: BriefKind): string {
  return kind === 'akt' ? BRIEF_SYSTEM_PROMPT_AKT : BRIEF_SYSTEM_PROMPT;
}

/** What the text is, for the model and for the cache key: the same sentence about a tram notice and about an act is not the same brief. */
const KIND_LABEL: Record<BriefKind, string> = {
  akt: 'Akt iz Službenog glasnika Grada Zagreba',
  prognoza: 'Vremenska prognoza DHMZ-a za Zagreb',
  obavijest: 'Obavijest ZET-a',
  radovi: 'Komunalni radovi u Zagrebu',
  novost: 'Kvartovska novost',
};

/**
 * The slice of the Workers AI binding this module uses. `Ai` from
 * @cloudflare/workers-types keys `run` on the model names its own version
 * knows, and BRIEF_MODEL is newer than that list, so the call is made
 * through this shape instead of the generated overloads.
 */
interface AiRunner {
  run(model: string, input: unknown): Promise<unknown>;
}

/** What one KV entry holds: the brief, or an explicit refusal (`null`). */
interface BriefRecord {
  brief: string | null;
}

/**
 * `brief:v3:<sha256 hex>` over the kind, the model that wrote the brief and
 * the text, newline-separated so no field can spell another's. The model is
 * in the digest because a sentence written by the small model must never be
 * served as the large model's reading of the same act, and because swapping
 * a model then needs no version bump: its briefs simply have different keys.
 */
export async function briefKey(kind: BriefKind, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${kind}\n${briefModel(kind)}\n${text}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${BRIEF_KEY_PREFIX}${hex}`;
}

const MARKDOWN = /[*_`#[\]]/;
const QUOTE_MARKS = '"\'„“”«»';

/**
 * The model is told not to quote; when it does anyway the sentence inside is
 * still usable. Each end is stripped on its own, so an answer that opens a
 * quote and never closes it -- or closes one it never opened -- is unwrapped
 * exactly like a properly paired one.
 */
function unquote(value: string): string {
  let line = value;
  if (line.length > 0 && QUOTE_MARKS.includes(line[0])) line = line.slice(1);
  if (line.length > 0 && QUOTE_MARKS.includes(line[line.length - 1])) line = line.slice(0, -1);
  return line.trim();
}

function significantTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of text.toLocaleLowerCase('hr').split(/[^\p{L}]+/u)) {
    if (token.length >= SIGNIFICANT_TOKEN_LETTERS) tokens.add(token);
  }
  return tokens;
}

/**
 * The answer, or null when it is not one readable line drawn from the source.
 *
 * Two of these rules carry the weight. The length rule is not decoration: the
 * prompt asks for a sentence shorter than the text, and in the first live probe
 * eleven of seventeen answers came back longer, so an answer that shortens
 * nothing is refused here rather than merely discouraged there -- the ticker
 * then shows the original, which is no worse and is at least the source's own
 * words. The token test is what catches an invented answer: a sentence sharing
 * too few substantial words with the text it claims to condense is about
 * something else, however well it reads.
 */
export function acceptBrief(raw: string, source: string, kind: BriefKind): string | null {
  const line = unquote(raw.trim());
  if (line === '') return null;
  if (line.length > BRIEF_MAX_CHARS) return null;
  // A brief exists to be shorter than what it condenses; one that is not is a
  // restatement, and the item reads better with its own text.
  if (line.length >= source.trim().length) return null;
  if (/[\r\n]/.test(line)) return null;
  if (MARKDOWN.test(line)) return null;
  const sourceTokens = significantTokens(source);
  let shared = 0;
  for (const token of significantTokens(line)) {
    if (sourceTokens.has(token)) shared += 1;
  }
  return shared >= briefMinSharedTokens(kind) ? line : null;
}

/** Workers AI text generation answers `{ response }`; anything else is no answer. */
function responseText(result: unknown): string {
  if (typeof result === 'string') return result;
  const response = (result as { response?: unknown } | null)?.response;
  return typeof response === 'string' ? response : '';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`brief: generation exceeded ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** The cached brief, '' for a remembered refusal, null when nothing is stored (or KV cannot be read). */
async function readCached(env: Env, key: string): Promise<string | null> {
  const record = await env.FEED.get<BriefRecord>(key, 'json').catch(() => null);
  if (record === null || record === undefined) return null;
  return typeof record.brief === 'string' ? record.brief : '';
}

async function remember(env: Env, key: string, brief: string | null): Promise<void> {
  const record: BriefRecord = { brief };
  await env.FEED
    .put(key, JSON.stringify(record), {
      expirationTtl: brief === null ? BRIEF_NEGATIVE_TTL_SECONDS : BRIEF_TTL_SECONDS,
    })
    .catch(() => undefined);
}

async function generate(ai: AiRunner, kind: BriefKind, text: string): Promise<string> {
  const result = await withTimeout(
    ai.run(briefModel(kind), {
      messages: [
        { role: 'system', content: briefPrompt(kind) },
        { role: 'user', content: `${KIND_LABEL[kind]}:\n${text}` },
      ],
      max_tokens: 96,
      temperature: 0.2,
    }),
    BRIEF_TIMEOUT_MS,
  );
  return responseText(result);
}

/** Hands a background write to the runtime, so it outlives the response without delaying it. */
export type BriefWaitUntil = (promise: Promise<unknown>) => void;

/**
 * One brief per text that has one, keyed by the text exactly as it was given.
 * A text with no entry in the returned map has no brief this refresh: it was
 * refused, it failed, or it is beyond this refresh's cap. Never rejects.
 *
 * `waitUntil` is the caller's ExecutionContext hook (worker/feed/cache.ts).
 * Remembering a brief is bookkeeping for the next refresh and never something
 * this one should wait on, so these KV writes go there exactly as the feed
 * cache's own writes do. Without it -- a unit test, a fixture run -- they are
 * awaited here instead, so the same call stays correct off a Worker.
 */
export async function briefAll(
  env: Env,
  texts: readonly string[],
  kind: BriefKind,
  waitUntil?: BriefWaitUntil,
): Promise<Map<string, string>> {
  const briefs = new Map<string, string>();
  const ai = env.AI as unknown as AiRunner | undefined;
  // No binding (a unit test, a `wrangler dev` without it) and the test
  // environment both mean no call: an E2E run must never bill Workers AI.
  if (!ai || isTestEnvironment(env)) return briefs;

  try {
    const floor = briefMinSourceChars(kind);
    const unique = [...new Set(texts)].filter((text) => text.trim().length > floor);
    const looked = await Promise.all(unique.map(async (text) => {
      const key = await briefKey(kind, text);
      return { text, key, cached: await readCached(env, key) };
    }));

    const uncached: { text: string; key: string }[] = [];
    for (const { text, key, cached } of looked) {
      if (cached === null) uncached.push({ text, key });
      else if (cached !== '') briefs.set(text, cached);
    }

    const writes: Promise<void>[] = [];
    await Promise.allSettled(uncached.slice(0, BRIEF_MAX_UNCACHED).map(async ({ text, key }) => {
      const brief = await generate(ai, kind, text).then((raw) => acceptBrief(raw, text, kind)).catch(() => null);
      const write = remember(env, key, brief);
      if (waitUntil) waitUntil(write); else writes.push(write);
      if (brief !== null) briefs.set(text, brief);
    }));
    // Empty whenever a waitUntil was given: those writes are already off this path.
    await Promise.allSettled(writes);
  } catch {
    // Whatever went wrong, the feed keeps its original texts.
  }
  return briefs;
}
