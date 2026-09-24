import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as brief from '../../worker/feed/brief';
import { makeFetchContext } from '../../worker/feed/http';
import type { FeedItem } from '../../worker/feed/schema';
import { SENTENCE_MODEL } from '../../worker/feed/sentences';

// WP5 B1 (review of lane/c-B1, P3): the per-item Workers AI summary pass
// (FeedItem.brief) is retired. It was written for the header ticker (WP6),
// which WP1 deleted; the one client read left (app/src/city/nearby.ts) takes
// a brief only from an eligible event, and every briefed source (gazette
// acts, the DHMZ forecast narrative, ZET notices, works, kvartovske news) is
// either another module or excluded from the eligible events. The live
// sentence service (worker/feed/sentences.ts) is a different pass and stays.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return sources(rel);
    return rel.endsWith('.ts') ? [rel] : [];
  });
}

describe('the Workers AI summary pass is retired (WP5 B1)', () => {
  it('no module, payload helper or cache layer produces FeedItem.brief or calls a briefer', () => {
    const producers = sources('worker').filter((file) => /briefRows|briefAll|ctx\.brief|\bbrief\s*[?]?:\s*\(|\.brief\s*=[^=]/.test(read(file)));
    expect(producers).toEqual([]);
  });
  it('the fetch context a module sees carries no briefer', () => {
    expect(Object.keys(makeFetchContext()).sort()).toEqual(['fetch', 'now']);
    expect(Object.keys(makeFetchContext(() => new Date(), async () => ({ items: [] }) as never)).sort()).toEqual(['fetch', 'now', 'twin']);
  });
  it('worker/feed/brief.ts keeps only the model the live sentence service reads', () => {
    expect(Object.keys(brief)).toEqual(['BRIEF_MODEL_AKT']);
    expect(SENTENCE_MODEL).toBe(brief.BRIEF_MODEL_AKT);
  });
  it('a cached payload row that still carries brief is a FeedItem for one more deploy', () => {
    const old: FeedItem = { id: 'akt-1', module: 'glasnik', kind: 'act', tier: 'session', title: 'Odluka o komunalnom redu', brief: 'Sažetak odluke.' };
    expect(JSON.parse(JSON.stringify(old))).toMatchObject({ title: 'Odluka o komunalnom redu', brief: 'Sažetak odluke.' });
  });
});
