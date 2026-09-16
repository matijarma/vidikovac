import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_PREFIX, parseXml, xmlArray, xmlText } from '../../worker/feed/xml';

interface Doc {
  root: { item: { name: string; '@_id': string }[]; note?: string };
}

describe('parseXml', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<root><item id="1"><name>Prvi</name></item><note>  razmaci  </note></root>`;

  it('keeps attributes with the @_ prefix and forces declared paths to arrays', () => {
    const doc = parseXml<Doc>(xml, { arrayPaths: ['root.item'] });
    expect(ATTRIBUTE_PREFIX).toBe('@_');
    expect(Array.isArray(doc.root.item)).toBe(true);
    expect(doc.root.item[0]['@_id']).toBe('1');
    expect(doc.root.item[0].name).toBe('Prvi');
    expect(doc.root.note).toBe('razmaci');
  });

  it('leaves every value a string, so padded and signed numbers survive', () => {
    const doc = parseXml<{ p: { t: unknown; s: unknown } }>('<p><t> 15.2</t><s>+1.0</s></p>');
    expect(doc.p.t).toBe('15.2');
    expect(doc.p.s).toBe('+1.0');
  });

  it('strips a UTF-8 byte order mark, which a feed may begin with', () => {
    const doc = parseXml<{ a: string }>('﻿<?xml version="1.0"?><a>x</a>');
    expect(doc.a).toBe('x');
  });

  it('decodes entities', () => {
    expect(parseXml<{ a: string }>('<a>oborina &gt; 20 mm</a>').a).toBe('oborina > 20 mm');
  });
});

describe('xmlArray and xmlText', () => {
  it('normalises a collapsed single child to an array', () => {
    expect(xmlArray(undefined)).toEqual([]);
    expect(xmlArray(null)).toEqual([]);
    expect(xmlArray('a')).toEqual(['a']);
    expect(xmlArray(['a', 'b'])).toEqual(['a', 'b']);
  });
  it('reads text out of plain values and out of mixed nodes', () => {
    expect(xmlText(undefined)).toBe('');
    expect(xmlText(' Zagreb ')).toBe('Zagreb');
    expect(xmlText(42)).toBe('42');
    expect(xmlText({ '#text': ' HR002 ', '@_x': '1' })).toBe('HR002');
    expect(xmlText({ '@_x': '1' })).toBe('');
  });
});
