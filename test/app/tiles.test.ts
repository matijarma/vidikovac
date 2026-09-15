import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { lineBadge } from '../../app/src/experience/blocks';
import { statusBadge } from '../../app/src/experience/status';
import { DOMAIN_ORDER, skeletonTileMarkup, tileAria, tileHref, tileMarkup, type Tile } from '../../app/src/experience/tiles';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { iconMarkup } from '../../app/src/ui/icons';

// The tile grammar of the time band (plan A.4): one `<a class="tl">` per
// fact, five variants under `data-variant`, the same children everywhere
// (label · value · context, or time · label · title · context, or glyph ·
// main · trail). Exact strings, like blocks.test.ts: the wave 2 producers,
// the kiosk scenes and the reconciler all build on this markup, so a change
// to a class or an attribute order has to be made here on purpose.

const hr = createDefaultI18n('hr');

const transit: Tile = {
  key: 'zet-rt:route:6', domain: 'transit', variant: 'value',
  label: 'Linija 6', labelMarkup: lineBadge('6', 'tram', 's'), title: 'Črnomerec-Sopot',
  value: 'kasni 2 min', valueSize: 'l', valueTone: 'late',
  contextMarkup: `${iconMarkup('tram-front')}<span class="tl-ctx-text">2</span>`,
  layer: 'u-pokretu', selection: { kind: 'route', id: '6' }, bucket: 'sada',
  aria: 'Linija 6, Črnomerec-Sopot, kasni 2 min, 2 vozila', testid: 'tile-transit',
};

const gazette: Tile = {
  key: 'glasnik:issue', domain: 'civic', variant: 'value',
  label: 'Glasnik', value: '21/2026', valueSize: 'xl', context: 'objavljen pet 11. 9. · 12 akata',
  layer: 'uprava-i-pravo', bucket: 'sada', testid: 'tile-gazette',
};

const event: Tile = {
  key: 'dogadanja:kulturpunkt:1', domain: 'events', variant: 'time', tone: 'events',
  label: 'Koncerti', title: 'Koncert u parku', at: '2026-09-12T18:00:00Z', context: 'Pogon',
  contextMarkup: lineBadge('6', 'tram', 'xs') + lineBadge('13', 'tram', 'xs'),
  layer: 'kultura', selection: { kind: 'item', id: '0123456789abcdef', module: 'dogadanja' }, testid: 'tile-events',
};

const safety: Tile = {
  key: 'safety', domain: 'safety', variant: 'band', tone: 'urgent', icon: 'triangle-alert',
  label: 'Sigurnost', title: 'žuto upozorenje: Grmljavinsko nevrijeme',
  layer: 'sigurnost', data: { level: 'urgent' }, bucket: 'sada', testid: 'tile-safety',
};

const news: Tile = {
  key: 'hrt-news:n1', domain: 'news', variant: 'row', icon: 'newspaper',
  label: 'Vijesti', title: 'Naslov vijesti', context: 'HRT vijesti · prije 3 sata',
  layer: 'vijesti', selection: { kind: 'item', id: 'fedcba9876543210', module: 'hrt-news' }, bucket: 'sada', testid: 'tile-news',
};

const TRAM_GLYPH = '<svg class="icon" aria-hidden="true"><use href="#icon-tram-front"></use></svg>';
const ROUTE_6 = 'data-selection="{&quot;kind&quot;:&quot;route&quot;,&quot;id&quot;:&quot;6&quot;}"';
const EVENT_SELECTION = 'data-selection="{&quot;kind&quot;:&quot;item&quot;,&quot;id&quot;:&quot;0123456789abcdef&quot;,&quot;module&quot;:&quot;dogadanja&quot;}"';

/** A zet-rt snapshot whose source stopped answering at 14:00: the badge every stale tile carries. */
const STALE_ZET: ModuleSnapshot = {
  module: 'zet-rt', tier: 'session', status: 'stale', fetchedAt: '2026-09-11T12:31:00Z', staleSince: '2026-09-11T12:00:00Z',
  attribution: { text: 'Izvor: ZET', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' }, items: [],
};
const STALE_BADGE = statusBadge(hr, STALE_ZET);

describe('tileHref: a real, restorable hash, never a JS-only control', () => {
  it('names the layer alone when the tile has no selection', () => {
    expect(tileHref('sigurnost')).toBe('#layer=sigurnost');
    expect(tileHref('uprava-i-pravo', undefined)).toBe('#layer=uprava-i-pravo');
  });
  it('appends the public selection through selectionParams, so view-store restores it verbatim', () => {
    expect(tileHref('u-pokretu', { kind: 'route', id: '6' })).toBe('#layer=u-pokretu&kind=route&id=6');
    expect(tileHref('u-pokretu', { kind: 'stop', id: 'stop_2001' })).toBe('#layer=u-pokretu&kind=stop&id=stop_2001');
    expect(tileHref('kultura', { kind: 'item', id: '0123456789abcdef', module: 'dogadanja' })).toBe('#layer=kultura&kind=item&id=0123456789abcdef&module=dogadanja');
  });
});

describe('tileAria: the tile read aloud in the order the eye takes it', () => {
  it('leads with the time when the tile has one, then label, title, value, context, skipping what is absent', () => {
    expect(tileAria(hr, event, '20:00')).toBe('20:00, Koncerti, Koncert u parku, Pogon');
    expect(tileAria(hr, gazette, '')).toBe('Glasnik, 21/2026, objavljen pet 11. 9. · 12 akata');
    expect(tileAria(hr, safety, '')).toBe('Sigurnost, žuto upozorenje: Grmljavinsko nevrijeme');
    expect(tileAria(hr, { ...safety, tone: 'calm', title: 'mirno', value: 'potvrđeno 14:31' }, '')).toBe('Sigurnost, mirno, potvrđeno 14:31');
  });
  it('says "cijeli dan" for an all-day tile even when the caller passed no time text, and nothing for a tile without a time line', () => {
    expect(tileAria(hr, { ...event, allDay: true }, '')).toBe('cijeli dan, Koncerti, Koncert u parku, Pogon');
    expect(tileAria(hr, { ...event, allDay: true }, 'cijeli dan')).toBe('cijeli dan, Koncerti, Koncert u parku, Pogon');
    expect(tileAria(hr, { ...gazette, allDay: true }, '')).toBe('Glasnik, 21/2026, objavljen pet 11. 9. · 12 akata');
  });
  it('lets a producer word the whole label itself (the line tile says "2 vozila" where the eye sees a glyph and a 2)', () => {
    expect(tileAria(hr, transit, '')).toBe('Linija 6, Črnomerec-Sopot, kasni 2 min, 2 vozila');
  });
  it('appends the stale word a stale tile shows, so a reader hears exactly what the badge says', () => {
    expect(tileAria(hr, { ...transit, stale: STALE_BADGE }, '')).toBe('Linija 6, Črnomerec-Sopot, kasni 2 min, 2 vozila, zastarjelo od 14:00');
    expect(tileAria(hr, { ...gazette, stale: STALE_BADGE }, '')).toBe('Glasnik, 21/2026, objavljen pet 11. 9. · 12 akata, zastarjelo od 14:00');
  });
});

describe('tileMarkup: value', () => {
  it('writes the transit line tile exactly: badge for the label, the delay word as the value, glyph and count as the context', () => {
    expect(tileMarkup(hr, transit)).toBe(
      `<a class="tl" data-variant="value" data-domain="transit" data-key="zet-rt:route:6" data-testid="tile-transit" href="#layer=u-pokretu&amp;kind=route&amp;id=6" data-action="nav" data-layer="u-pokretu" ${ROUTE_6} aria-label="Linija 6, Črnomerec-Sopot, kasni 2 min, 2 vozila">`
      + '<span class="tl-label"><span class="line" data-kind="tram" data-size="s">6</span></span>'
      + '<span class="tl-value" data-size="l" data-state="late" data-replace data-sig="kasni 2 min">kasni 2 min</span>'
      + `<span class="tl-context">${TRAM_GLYPH}<span class="tl-ctx-text">2</span></span>`
      + '</a>',
    );
  });
  it('writes the gazette tile with a kicker label, the xl value and a text context, and no selection attribute without a selection', () => {
    expect(tileMarkup(hr, gazette)).toBe(
      '<a class="tl" data-variant="value" data-domain="civic" data-key="glasnik:issue" data-testid="tile-gazette" href="#layer=uprava-i-pravo" data-action="nav" data-layer="uprava-i-pravo" aria-label="Glasnik, 21/2026, objavljen pet 11. 9. · 12 akata">'
      + '<span class="tl-label kicker">Glasnik</span>'
      + '<span class="tl-value" data-size="xl" data-replace data-sig="21/2026">21/2026</span>'
      + '<span class="tl-context"><span class="tl-ctx-text">objavljen pet 11. 9. · 12 akata</span></span>'
      + '</a>',
    );
  });
  it('marks the value for the reconciler: data-replace with the value text as its signature, so a poll that keeps the word keeps the node and a real change replays the crossfade', () => {
    const html = tileMarkup(hr, { ...transit, value: 'na vrijeme', valueTone: 'ontime' });
    expect(html).toContain('<span class="tl-value" data-size="l" data-state="ontime" data-replace data-sig="na vrijeme">na vrijeme</span>');
    expect(html.match(/data-replace/g)).toHaveLength(1);
  });
  it('defaults the value to the l size and writes the state only when the producer gave one', () => {
    const html = tileMarkup(hr, { ...gazette, valueSize: undefined });
    expect(html).toContain('<span class="tl-value" data-size="l" data-replace data-sig="21/2026">21/2026</span>');
    expect(html).not.toContain('data-state');
    expect(tileMarkup(hr, { ...transit, value: 'nema podataka', valueSize: 'm', valueTone: 'none' })).toContain('<span class="tl-value" data-size="m" data-state="none" data-replace');
  });
  it('paints no empty value or context: a tile with neither has only its label', () => {
    expect(tileMarkup(hr, { key: 'x:y', domain: 'civic', variant: 'value', label: 'Glasnik', layer: 'uprava-i-pravo' })).toBe(
      '<a class="tl" data-variant="value" data-domain="civic" data-key="x:y" href="#layer=uprava-i-pravo" data-action="nav" data-layer="uprava-i-pravo" aria-label="Glasnik"><span class="tl-label kicker">Glasnik</span></a>',
    );
  });
});

describe('tileMarkup: time and ink', () => {
  it('writes the event tile exactly: a <time> with the ISO instant, kicker, two-line title, venue and xs line badges in the context', () => {
    expect(tileMarkup(hr, event)).toBe(
      `<a class="tl" data-variant="time" data-domain="events" data-tone="events" data-key="dogadanja:kulturpunkt:1" data-testid="tile-events" href="#layer=kultura&amp;kind=item&amp;id=0123456789abcdef&amp;module=dogadanja" data-action="nav" data-layer="kultura" ${EVENT_SELECTION} aria-label="20:00, Koncerti, Koncert u parku, Pogon">`
      + '<time class="tl-time" datetime="2026-09-12T18:00:00Z">20:00</time>'
      + '<span class="tl-label kicker">Koncerti</span>'
      + '<span class="tl-title">Koncert u parku</span>'
      + '<span class="tl-context"><span class="tl-ctx-text">Pogon</span><span class="line" data-kind="tram" data-size="xs">6</span><span class="line" data-kind="tram" data-size="xs">13</span></span>'
      + '</a>',
    );
  });
  it('says "cijeli dan" in a plain span for an all-day item, and reads it first', () => {
    const html = tileMarkup(hr, { ...event, tone: undefined, at: '2026-09-11T00:00:00Z', allDay: true, context: undefined, contextMarkup: undefined });
    expect(html).toContain('aria-label="cijeli dan, Koncerti, Koncert u parku"');
    expect(html).toContain('><span class="tl-time" data-allday>cijeli dan</span><span class="tl-label kicker">Koncerti</span>');
    expect(html).not.toContain('<time');
    expect(html).not.toContain('data-tone');
  });
  it('writes the ink variant as the time variant under its own name (the one Skupština tile)', () => {
    const html = tileMarkup(hr, {
      key: 'dogadanja:skupstina:4', domain: 'civic', variant: 'ink', label: 'Skupština', title: 'Poziv na 13. sjednicu Gradske skupštine',
      at: '2026-09-14T09:00:00Z', context: 'Stara gradska vijećnica', layer: 'uprava-i-pravo', testid: 'tile-assembly',
    });
    expect(html.startsWith('<a class="tl" data-variant="ink" data-domain="civic" data-key="dogadanja:skupstina:4" data-testid="tile-assembly" href="#layer=uprava-i-pravo" data-action="nav" data-layer="uprava-i-pravo" aria-label="11:00, Skupština, Poziv na 13. sjednicu Gradske skupštine, Stara gradska vijećnica">')).toBe(true);
    expect(html).toContain('<time class="tl-time" datetime="2026-09-14T09:00:00Z">11:00</time><span class="tl-label kicker">Skupština</span><span class="tl-title">Poziv na 13. sjednicu Gradske skupštine</span><span class="tl-context"><span class="tl-ctx-text">Stara gradska vijećnica</span></span></a>');
  });
  it('leaves the time line out when there is neither an instant nor an all-day flag', () => {
    const html = tileMarkup(hr, { ...event, at: undefined, contextMarkup: undefined });
    expect(html).not.toContain('tl-time');
    expect(html).toContain('aria-label="Koncerti, Koncert u parku, Pogon"');
  });
});

describe('tileMarkup: band and row', () => {
  it('writes the safety band exactly: glyph, then label and title in the main cell, the level as its own data attribute, no trail when nothing is confirmed', () => {
    expect(tileMarkup(hr, safety)).toBe(
      '<a class="tl" data-variant="band" data-domain="safety" data-tone="urgent" data-level="urgent" data-key="safety" data-testid="tile-safety" href="#layer=sigurnost" data-action="nav" data-layer="sigurnost" aria-label="Sigurnost, žuto upozorenje: Grmljavinsko nevrijeme">'
      + '<svg class="icon tl-glyph" aria-hidden="true"><use href="#icon-triangle-alert"></use></svg>'
      + '<span class="tl-main"><span class="tl-label kicker">Sigurnost</span><span class="tl-title">žuto upozorenje: Grmljavinsko nevrijeme</span></span>'
      + '</a>',
    );
  });
  it('trails the band with its value when there is one (the calm verdict says when it was confirmed)', () => {
    const html = tileMarkup(hr, { ...safety, tone: 'calm', icon: 'check-circle', title: 'mirno', value: 'potvrđeno 14:31', data: { level: 'calm' } });
    expect(html).toContain('data-tone="calm" data-level="calm"');
    expect(html).toContain('<use href="#icon-check-circle"></use>');
    expect(html).toContain('<span class="tl-title">mirno</span></span><span class="tl-trail">potvrđeno 14:31</span></a>');
  });
  it('writes the works band with the count as the trail', () => {
    const html = tileMarkup(hr, {
      key: 'komunalno:works', domain: 'komunalno', variant: 'band', tone: 'komunalno', icon: 'hard-hat',
      label: 'Radovi', title: 'Grad Zagreb', value: '1', aria: 'Radovi, 1 u tijeku, Grad Zagreb', layer: 'uprava-i-pravo', testid: 'tile-works',
    });
    expect(html).toContain('data-variant="band" data-domain="komunalno" data-tone="komunalno" data-key="komunalno:works"');
    expect(html).toContain('aria-label="Radovi, 1 u tijeku, Grad Zagreb"');
    expect(html).toContain('<span class="tl-main"><span class="tl-label kicker">Radovi</span><span class="tl-title">Grad Zagreb</span></span><span class="tl-trail">1</span></a>');
  });
  it('writes the news row exactly: glyph, the title alone in the main cell, source and age as the trail; the label is heard, not shown', () => {
    expect(tileMarkup(hr, news)).toBe(
      '<a class="tl" data-variant="row" data-domain="news" data-key="hrt-news:n1" data-testid="tile-news" href="#layer=vijesti&amp;kind=item&amp;id=fedcba9876543210&amp;module=hrt-news" data-action="nav" data-layer="vijesti" data-selection="{&quot;kind&quot;:&quot;item&quot;,&quot;id&quot;:&quot;fedcba9876543210&quot;,&quot;module&quot;:&quot;hrt-news&quot;}" aria-label="Vijesti, Naslov vijesti, HRT vijesti · prije 3 sata">'
      + '<svg class="icon tl-glyph" aria-hidden="true"><use href="#icon-newspaper"></use></svg>'
      + '<span class="tl-main"><span class="tl-title">Naslov vijesti</span></span>'
      + '<span class="tl-trail">HRT vijesti · prije 3 sata</span>'
      + '</a>',
    );
  });
  it('appends context markup to a row trail and leaves the trail out when there is nothing to say', () => {
    expect(tileMarkup(hr, { ...news, contextMarkup: lineBadge('6', 'tram', 'xs') })).toContain('<span class="tl-trail">HRT vijesti · prije 3 sata<span class="line" data-kind="tram" data-size="xs">6</span></span>');
    expect(tileMarkup(hr, { ...news, context: undefined })).toContain('<span class="tl-main"><span class="tl-title">Naslov vijesti</span></span></a>');
  });
});

describe('a stale tile keeps its shape and says so', () => {
  it('replaces the context of a value or time tile with the status badge and marks the control data-stale', () => {
    const value = tileMarkup(hr, { ...transit, stale: STALE_BADGE });
    expect(value).toContain('data-domain="transit" data-stale data-key="zet-rt:route:6"');
    expect(value).toContain(`<span class="tl-context">${STALE_BADGE}</span></a>`);
    expect(value).not.toContain(TRAM_GLYPH);
    expect(value).toContain('aria-label="Linija 6, Črnomerec-Sopot, kasni 2 min, 2 vozila, zastarjelo od 14:00"');
    const time = tileMarkup(hr, { ...event, stale: STALE_BADGE });
    expect(time).toContain(`<span class="tl-title">Koncert u parku</span><span class="tl-context">${STALE_BADGE}</span></a>`);
    expect(time).not.toContain('Pogon</span>');
  });
  it('places the badge after the title inside the main cell of a band or a row, keeping the trail', () => {
    const band = tileMarkup(hr, { ...safety, stale: STALE_BADGE, value: 'potvrđeno 14:31' });
    expect(band).toContain(`<span class="tl-title">žuto upozorenje: Grmljavinsko nevrijeme</span>${STALE_BADGE}</span><span class="tl-trail">potvrđeno 14:31</span></a>`);
    const row = tileMarkup(hr, { ...news, stale: STALE_BADGE });
    expect(row).toContain(`<span class="tl-main"><span class="tl-title">Naslov vijesti</span>${STALE_BADGE}</span><span class="tl-trail">HRT vijesti · prije 3 sata</span></a>`);
    expect(row).toContain('data-stale data-key="hrt-news:n1"');
  });
  it('writes no data-stale on a live tile', () => {
    expect(tileMarkup(hr, transit)).not.toContain('data-stale');
  });
});

describe('everything from a feed is escaped', () => {
  const hostile: Tile = {
    key: 'q"1<', domain: 'events', variant: 'time', label: 'Trg & "ulica"', title: '<script>x</script>', at: '2026-09-12T18:00:00Z',
    context: 'Pogon <b>', layer: 'kultura', testid: 'tile-events',
  };
  it('escapes the title, the label, the context, the key and the composed aria label', () => {
    const html = tileMarkup(hr, hostile);
    expect(html).toContain('data-key="q&quot;1&lt;"');
    expect(html).toContain('aria-label="20:00, Trg &amp; &quot;ulica&quot;, &lt;script&gt;x&lt;/script&gt;, Pogon &lt;b&gt;"');
    expect(html).toContain('<span class="tl-label kicker">Trg &amp; &quot;ulica&quot;</span>');
    expect(html).toContain('<span class="tl-title">&lt;script&gt;x&lt;/script&gt;</span>');
    expect(html).toContain('<span class="tl-ctx-text">Pogon &lt;b&gt;</span>');
    expect(html).not.toContain('<script>');
  });
  it('escapes the value and its signature, and the datetime attribute', () => {
    const html = tileMarkup(hr, { ...gazette, value: '2 < 3 "x"' });
    expect(html).toContain('data-sig="2 &lt; 3 &quot;x&quot;">2 &lt; 3 &quot;x&quot;</span>');
    expect(tileMarkup(hr, { ...hostile, at: '2026-09-12T18:00:00Z"<' })).not.toContain('datetime="2026-09-12T18:00:00Z"<"');
  });
  it('keeps labelMarkup and contextMarkup as the trusted markup other builders produced', () => {
    const html = tileMarkup(hr, { ...gazette, labelMarkup: lineBadge('268', 'bus', 's'), contextMarkup: iconMarkup('bus-front') });
    expect(html).toContain('<span class="tl-label"><span class="line" data-kind="bus" data-size="s">268</span></span>');
    expect(html).toContain('<use href="#icon-bus-front"></use>');
  });
});

describe('skeletonTileMarkup: the shape a source is about to fill, never a control', () => {
  it('value: label, value and context bars', () => {
    expect(skeletonTileMarkup('value', 'sk-transit-0')).toBe(
      '<div class="tl" data-variant="value" data-skeleton data-key="sk-transit-0" aria-hidden="true"><span class="sk tl-sk-label"></span><span class="sk tl-sk-value"></span><span class="sk tl-sk-context"></span></div>',
    );
  });
  it('time: adds the time bar and the two-line title bar', () => {
    expect(skeletonTileMarkup('time', 'sk-events-1')).toBe(
      '<div class="tl" data-variant="time" data-skeleton data-key="sk-events-1" aria-hidden="true"><span class="sk tl-sk-time"></span><span class="sk tl-sk-label"></span><span class="sk tl-sk-title"></span><span class="sk tl-sk-context"></span></div>',
    );
  });
  it('band: a round glyph and the main cell with label and one title line', () => {
    expect(skeletonTileMarkup('band', 'sk-komunalno-0')).toBe(
      '<div class="tl" data-variant="band" data-skeleton data-key="sk-komunalno-0" aria-hidden="true"><span class="sk tl-sk-glyph"></span><span class="tl-main"><span class="sk tl-sk-label"></span><span class="sk tl-sk-title1"></span></span></div>',
    );
  });
  it('row: a round glyph, one title line, a trailing context bar', () => {
    expect(skeletonTileMarkup('row', 'sk-news-0')).toBe(
      '<div class="tl" data-variant="row" data-skeleton data-key="sk-news-0" aria-hidden="true"><span class="sk tl-sk-glyph"></span><span class="tl-main"><span class="sk tl-sk-title1"></span></span><span class="sk tl-sk-context"></span></div>',
    );
  });
  it('escapes the key and carries no href, action or label', () => {
    const html = skeletonTileMarkup('value', 'a"b');
    expect(html).toContain('data-key="a&quot;b"');
    expect(html).not.toMatch(/href|data-action|aria-label/);
  });
});

describe('DOMAIN_ORDER: the sada lane reads transit first and civic last', () => {
  it('is the six domains in the order the plan fixes', () => {
    expect(DOMAIN_ORDER).toEqual(['transit', 'mobility', 'komunalno', 'safety', 'news', 'civic']);
  });
});

describe('focus (A.9): the tile inherits the global ring and never removes it', () => {
  it('no .tl rule in signage.css sets outline: none or outline: 0', () => {
    const css = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'signage.css'), 'utf8');
    const tlRules = [...css.matchAll(/(?:^|\n|\}|\{)\s*(\.tl[^{]*)\{([^}]*)\}/g)];
    expect(tlRules.length).toBeGreaterThan(10);
    for (const [, selector, body] of tlRules) expect(body, selector).not.toMatch(/outline\s*:\s*(none|0)/);
  });
});
