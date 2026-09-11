import { XMLParser } from 'fast-xml-parser';

// One XML configuration for CAP, both DHMZ dialects and the HRT RSS feeds.
// Repeated elements are only arrays when the caller names their jpath, because
// fast-xml-parser collapses a one-element list into a bare object otherwise.

export const ATTRIBUTE_PREFIX = '@_';

export interface XmlOptions {
  /** jpaths that must always be arrays, e.g. `alert.info`, `rss.channel.item`. */
  arrayPaths?: readonly string[];
}

export function parseXml<T = unknown>(xml: string, options: XmlOptions = {}): T {
  const arrayPaths = new Set(options.arrayPaths ?? []);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTRIBUTE_PREFIX,
    trimValues: true,
    // Values stay strings on purpose: the sources pad numbers (` 15.2`), sign
    // them (`+1.0`) and flag them (`904.5*`). Each module decides what is a number.
    parseTagValue: false,
    parseAttributeValue: false,
    // fast-xml-parser 5.11 types jpath as `string | MatcherView` (the latter
    // only when the caller sets `jPath: false`, which we never do); String()
    // is a no-op on the string we always receive at runtime.
    isArray: (_name, jpath) => arrayPaths.has(String(jpath)),
  });
  // The HRT feeds begin with a UTF-8 BOM, which is not a legal first character.
  return parser.parse(xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml) as T;
}

export function xmlArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Text of an element that may be a string, a number or a `{ '#text': ... }` node. */
export function xmlText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    return text === undefined || text === null ? '' : String(text).trim();
  }
  return String(value).trim();
}
