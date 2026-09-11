// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../../app/src/ui/dom/escape';

describe('escape helpers', () => {
  it('escapes the five HTML-significant characters in text', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#039;s&lt;/a&gt;',
    );
  });
  it('escapes quotes and angle brackets for attributes and tolerates null', () => {
    expect(escapeAttribute('a"b<c>&')).toBe('a&quot;b&lt;c&gt;&amp;');
    expect(escapeAttribute(null)).toBe('');
  });
  it('builds exactly one element from trusted markup and throws on none', () => {
    const el = createElementFromHTML('<p class="x">hi</p>');
    expect(el.tagName).toBe('P');
    expect(el.className).toBe('x');
    expect(() => createElementFromHTML('plain text')).toThrow();
  });
});
