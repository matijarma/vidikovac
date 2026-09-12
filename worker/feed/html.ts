// A tiny, dependency-free reader for the HTML sources area E scrapes (no RSS
// or JSON API exists for aktivnosti.zagreb.hr or skupstina.zagreb.hr). It is
// deliberately not a real HTML parser: every module that uses it targets one
// real, saved fixture (test/fixtures/dogadanja/*) and keeps its own regexes,
// so the only shared work is entity decoding, tag stripping, and pulling text
// out of the first (or every) regex match.

// Named entities that actually occur in the saved fixtures (see
// test/fixtures/dogadanja/sources.json): amp/quot/nbsp from every HTML and RSS
// source, and the Croatian-typography quotes, bullet and euro sign from the
// ZET RSS feeds (bdquo/ldquo/rdquo/lsquo/rsquo/bull/euro). lt/gt/apos are kept
// too because any HTML source can carry them even where these fixtures don't.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  bdquo: '„',
  bull: '•',
  euro: '€',
};

const ENTITY_PATTERN = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g;

/**
 * Decodes numeric character references (decimal and hex, which is how every
 * Croatian diacritic in the komunalne aktivnosti JSON is escaped) and the
 * named entities listed above. An entity this table doesn't know is left
 * untouched rather than dropped, so an unexpected source never silently loses
 * a character.
 */
export function decodeEntities(s: string): string {
  return s.replace(ENTITY_PATTERN, (match, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const codePoint = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

const TAG_PATTERN = /<[^>]*>/g;

/**
 * Removes every tag, replacing each with a space (never nothing) so two
 * adjacent elements never glue into one word, then collapses the resulting
 * whitespace. Entities are left for `decodeEntities` to handle separately.
 */
export function stripTags(s: string): string {
  return s.replace(TAG_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

/** Group 1 of a match if the pattern captured one, else the whole match, read as clean text. */
function matchText(match: RegExpMatchArray): string {
  return decodeEntities(stripTags(match[1] ?? match[0]));
}

/**
 * Text content of the first match, or null. Builds its own non-global copy of
 * `pattern` before matching, so a global-flagged regex the caller reuses
 * across calls never leaves a stateful `lastIndex` behind.
 */
export function selectText(html: string, pattern: RegExp): string | null {
  const singleMatch = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  const match = singleMatch.exec(html);
  return match ? matchText(match) : null;
}

/**
 * Text content of every match, in document order, as clean text (same rule as
 * `selectText`). Accepts a pattern with or without the `g` flag. Returns an
 * empty array rather than null when nothing matches.
 */
export function selectAll(html: string, pattern: RegExp): string[] {
  const globalMatch = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return [...html.matchAll(globalMatch)].map(matchText);
}
