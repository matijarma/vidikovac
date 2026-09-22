import { SENTENCE_KICKERS, type SentenceRequest } from '../../shared/kiosk/sentence';
import { SENTENCE_MAX_FACTS, SENTENCE_MAX_FACT_CHARS, writeSentences } from '../feed/sentences';
import { clientIp, json } from '../http';
import type { RouteHandler } from '../index';
import { isSameOrigin, readCappedBody } from './pairing';

export const SENTENCE_BODY_MAX_BYTES = 8192;
const PRIVATE = { 'cache-control': 'private, no-store' };

export function parseSentenceRequest(raw: unknown): SentenceRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<SentenceRequest>;
  if ((value.locale !== 'hr' && value.locale !== 'en') || !Number.isInteger(value.budget)
    || value.budget! < 40 || value.budget! > 80 || !Array.isArray(value.facts) || value.facts.length > SENTENCE_MAX_FACTS) return null;
  const ids = new Set<string>();
  for (const fact of value.facts) {
    if (!fact || typeof fact !== 'object' || typeof fact.id !== 'string' || !/^[\p{L}\p{N}:._/-]{1,128}$/u.test(fact.id)
      || ids.has(fact.id) || !SENTENCE_KICKERS.includes(fact.kind) || typeof fact.text !== 'string'
      || !fact.text.trim() || [...fact.text].length > SENTENCE_MAX_FACT_CHARS || /[\r\n\p{Cc}\p{Cf}]/u.test(fact.text)
      || (fact.validUntil !== null && (typeof fact.validUntil !== 'number' || !Number.isFinite(fact.validUntil)
        || fact.validUntil < 0 || fact.validUntil > 8.64e15))) return null;
    ids.add(fact.id);
  }
  return value as SentenceRequest;
}

export const handleKiosk: RouteHandler = async (request, env, ctx, url) => {
  if (url.pathname !== '/api/kiosk/sentences') return null;
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405, { ...PRIVATE, allow: 'POST' });
  if (!isSameOrigin(request, url)) return json({ error: 'forbidden' }, 403, PRIVATE);
  if (env.RL_OPEN) {
    try {
      const { success } = await env.RL_OPEN.limit({ key: `kiosk-sentences:${clientIp(request) || 'no-ip'}` });
      if (!success) return json({ error: 'rate-limited' }, 429, PRIVATE);
    } catch {
      // Optional paid inference fails closed when its cost guard cannot answer.
      return json({ error: 'rate-limited' }, 429, PRIVATE);
    }
  }
  let parsed: SentenceRequest | null = null;
  try {
    const body = await readCappedBody(request, SENTENCE_BODY_MAX_BYTES);
    if (body !== null) parsed = parseSentenceRequest(JSON.parse(body));
  } catch { /* Malformed or interrupted body. */ }
  if (!parsed) return json({ error: 'bad-request' }, 400, PRIVATE);
  const sentences = await writeSentences(env, parsed, promise => ctx.waitUntil(promise));
  return json({ generatedAt: new Date().toISOString(), sentences }, 200, PRIVATE);
};
