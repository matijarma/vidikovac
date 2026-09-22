// Optional inference, separate from the shared HTTP client's initial graph.
// Local sentence facts/templates still validate synchronously without this chunk.
import {
  readWrittenSentences, stableSentenceFacts,
  type SentenceRequest, type SentenceResponse, type WrittenSentence,
} from '../../../shared/kiosk/sentence';
import { requestJson } from '../api';

export async function fetchSentenceResponse(request: SentenceRequest, fetchImpl: typeof fetch): Promise<WrittenSentence[]> {
  const stableRequest = { ...request, facts: stableSentenceFacts(request.facts, Date.now()) };
  if (!stableRequest.facts.length) return [];
  const { body } = await requestJson<SentenceResponse>('/api/kiosk/sentences', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(stableRequest),
    cache: 'no-store',
  }, fetchImpl);
  return readWrittenSentences(body?.sentences, { facts: stableRequest.facts, budget: request.budget, now: Date.now() }).slice(0, 8);
}
