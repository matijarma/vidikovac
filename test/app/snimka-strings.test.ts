// The copy rules of /snimka/ (docs/snimka-2026-10.md section 9) over every
// leaf of SN, and the static HTML pinned to the same strings so the two never
// drift (app/src/snimka/strings.ts, app/snimka/index.html).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SN, fill, leaves } from '../../app/src/snimka/strings';
import { SPEEDS } from '../../shared/snimka';

const html = readFileSync(new URL('../../app/snimka/index.html', import.meta.url), 'utf8');
const LEAVES = leaves();
const byKey = new Map(LEAVES);
// Word boundaries that know Croatian letters: JavaScript's \b is ASCII-only.
const VI = /(?<![\p{L}\p{N}_])(?:Vi|Vam|Vas|Vaš|Vaša|Vaše)(?![\p{L}\p{N}_])/u;
const ZID = /(?<![\p{L}])zid/iu;

const decode = (text: string): string =>
  text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** Every element marked data-sn-text="key" with its text, tags stripped. */
function marked(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /<([a-z0-9]+)\b[^>]*\bdata-sn-text="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
  for (const m of html.matchAll(re)) out.set(m[2]!, [...(out.get(m[2]!) ?? []), decode(m[3]!)]);
  return out;
}

describe('every string of /snimka/', () => {
  it('has a key, is trimmed, and is a whole sentence or label', () => {
    // The brief's 138 strings, the v2 plan's Appendix B and the few the shell added for the read-through.
    expect(LEAVES.length).toBeGreaterThanOrEqual(380);
    for (const [key, text] of LEAVES) {
      expect(text, key).toBe(text.trim());
      expect(text, key).not.toBe('');
      expect(text, key).not.toContain('  ');
    }
  });
  it.each(LEAVES)('%s carries no em dash, no double hyphen and no ellipsis character', (_key, text) => {
    expect(text, 'U+2014').not.toContain('—');
    expect(text, '" -- "').not.toContain(' -- ');
    expect(text, 'U+2026').not.toContain('…');
  });
  it('never says zid, never says simulator, never addresses the reader as Vi', () => {
    for (const [key, text] of LEAVES) {
      expect(text, key).not.toMatch(ZID);
      expect(text, key).not.toMatch(/simul/iu);
      expect(text, key).not.toMatch(VI);
    }
  });
  it('names the strike only in the narration and the sources', () => {
    const naming = LEAVES.filter(([, text]) => /štrajk/iu.test(text)).map(([key]) => key);
    expect(naming.length).toBeGreaterThan(0);
    for (const key of naming) expect(key, key).toMatch(/^(narration|sources)\./);
    // And the lede does name it, as decision S-3 says the page should.
    expect(SN.narration.lede1).toContain('štrajk');
    expect(SN.sources.strike).toContain('štrajk');
  });
  it('speed words exist for every speed', () => {
    for (const s of SPEEDS) {
      expect(typeof SN.speed[s]).toBe('string');
      expect(typeof SN.speedAria[s]).toBe('string');
    }
  });
});

describe('fill', () => {
  it('replaces every placeholder, numbers included, as the kiosk fill does', () => {
    expect(fill(SN.kpi.silentSub, { from: 'pon 28. 9. u 02:00', to: 'sri 30. 9. u 19:05' })).toBe('od pon 28. 9. u 02:00 do sri 30. 9. u 19:05');
    expect(fill(SN.badge.counts, { seen: 3, expected: 230 })).toBe('u pokretu 3, po voznom redu oko 230');
    expect(fill('{a} i {a}', { a: 'x' })).toBe('x i x');
  });
  it('throws in tests on a placeholder nobody filled', () => {
    expect(() => fill(SN.badge.counts, { seen: 3 })).toThrow(/expected/);
  });
});

describe('the static HTML carries the same strings', () => {
  const texts = marked();
  it('the hero, the narration, every section head and every source read exactly as SN', () => {
    const required = [
      'page.name', 'hero.eyebrow', 'hero.title', 'narration.lede1', 'narration.lede2', 'narration.forWhom', 'narration.q1', 'narration.q2', 'narration.q3', 'narration.q4', 'noscript',
      'stage.title', 'numbers.title', 'numbers.lede', 'screen.title', 'screen.lede', 'strip.title', 'strip.lede', 'alternatives.title', 'alternatives.lede', 'reckoning.title', 'reckoning.lede', 'open.title', 'open.lede',
      ...LEAVES.filter(([k]) => k.startsWith('nav.') || k.startsWith('sources.')).map(([k]) => k),
    ];
    for (const key of required) expect(texts.has(key), `${key} is marked in the HTML`).toBe(true);
    for (const [key, found] of texts) {
      const want = byKey.get(key);
      expect(want, `${key} exists in SN`).toBeDefined();
      for (const text of found) expect(text, key).toBe(want);
    }
  });
  it('the title, the description and the question chips\' label are the page strings', () => {
    expect(html).toContain(`<title>${SN.page.title}</title>`);
    expect(html).toContain(`<meta name="description" content="${SN.page.description}">`);
    expect(html).toContain(`aria-label="${SN.questions.label}"`);
  });
  it('the HTML itself keeps the copy rules', () => {
    expect(html).not.toContain('—');
    expect(html).not.toContain(' -- ');
    expect(html).not.toContain('…');
    expect(decode(html)).not.toMatch(/simul/iu);
    const body = html.slice(html.indexOf('<body'));
    for (const m of body.matchAll(/štrajk/giu)) {
      // Each naming of the strike in the body sits inside a narration or sources element.
      const before = body.slice(0, m.index);
      const lastMark = before.lastIndexOf('data-sn-text="');
      const key = before.slice(lastMark + 'data-sn-text="'.length).split('"')[0]!;
      expect(key, `štrajk at ${m.index} belongs to ${key}`).toMatch(/^(narration|sources)\./);
    }
  });
});
