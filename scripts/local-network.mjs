// Test/capture tooling only. Never impersonate an edge address on a hosted
// target. Each local scenario gets a documentation-range IPv6 network; all
// browsers in that scenario share it, including same-Wi-Fi pairing proofs.
import { createHash, randomUUID } from 'node:crypto';

/** @returns {Record<string, string>} */
export function localNetworkHeaders(base, scenario = randomUUID()) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return {};
  const hash = createHash('sha256').update(scenario).digest('hex');
  return { 'CF-Connecting-IP': `2001:db8:${hash.slice(0, 4)}:${hash.slice(4, 8)}::1` };
}
