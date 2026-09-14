import { describe, expect, it } from 'vitest';
import { lineBadge, signRow } from '../../app/src/experience/blocks';

// The two signage builders every domain uses from T2.2 on. They own one shape
// each: the badge is the component signage.css paints, the row is the grid
// (lead, main, trail) that stop signs and departure boards are made of. Text
// arguments are escaped here so no caller has to remember; `lead` and `trail`
// are markup other builders produced.

describe('lineBadge', () => {
  it('writes the component with its mode and size, at the board size by default', () => {
    expect(lineBadge('6', 'tram')).toBe('<span class="line" data-kind="tram" data-size="m">6</span>');
    expect(lineBadge('268', 'bus', 's')).toBe('<span class="line" data-kind="bus" data-size="s">268</span>');
    expect(lineBadge('ZET', 'other', 'k')).toBe('<span class="line" data-kind="other" data-size="k">ZET</span>');
  });

  // The fifth size: a line *mentioned* in a context line (an event's nearest
  // stop, the last tram), never the line the tile is about.
  it('writes the xs size for a line mentioned in a context line', () => {
    expect(lineBadge('6', 'tram', 'xs')).toBe('<span class="line" data-kind="tram" data-size="xs">6</span>');
    expect(lineBadge('268', 'bus', 'xs')).toBe('<span class="line" data-kind="bus" data-size="xs">268</span>');
  });

  it('carries further attributes a caller needs, values escaped', () => {
    expect(lineBadge('4', 'tram', 'l', { 'data-testid': 'route-badge', 'aria-hidden': 'true' }))
      .toBe('<span class="line" data-kind="tram" data-size="l" data-testid="route-badge" aria-hidden="true">4</span>');
    expect(lineBadge('1', 'tram', 'm', { title: 'tramvaj "1"' })).toContain('title="tramvaj &quot;1&quot;"');
  });

  it('escapes the label, which comes from the feed', () => {
    expect(lineBadge('<script>x</script>', 'other')).toBe(
      '<span class="line" data-kind="other" data-size="m">&lt;script&gt;x&lt;/script&gt;</span>',
    );
  });
});

describe('signRow', () => {
  it('lays a row out as lead, main and trail, and keys it for the reconciler', () => {
    expect(signRow({ key: 'route-6', lead: lineBadge('6', 'tram', 's'), title: 'Črnomerec', sub: 'kasni 3 min', trail: '<span class="row-meta">3</span>' })).toBe(
      '<li class="row" data-key="route-6">'
      + '<span class="line" data-kind="tram" data-size="s">6</span>'
      + '<span class="row-main"><span class="row-title">Črnomerec</span><span class="row-sub">kasni 3 min</span></span>'
      + '<span class="row-meta">3</span>'
      + '</li>',
    );
  });

  it('leaves out the second line and the trail when there is nothing to say', () => {
    expect(signRow({ key: 'a', lead: '', title: 'Samo naslov' })).toBe(
      '<li class="row" data-key="a"><span class="row-main"><span class="row-title">Samo naslov</span></span></li>',
    );
  });

  // The combination signage.css has to place by hand: no lead, but a trail.
  // The row then has two children and the grid cannot read intent from order.
  it('writes the main part and the trail as the only two cells when there is no lead', () => {
    expect(signRow({ key: 'route-268', lead: '', title: 'Velika Gorica', trail: '<span class="row-delay">kasni 3 min</span>' })).toBe(
      '<li class="row" data-key="route-268">'
      + '<span class="row-main"><span class="row-title">Velika Gorica</span></span>'
      + '<span class="row-delay">kasni 3 min</span>'
      + '</li>',
    );
  });

  it('escapes the title, the second line and the key, and keeps the lead and the trail as markup', () => {
    const row = signRow({
      key: 'q"1',
      lead: '<span class="line">6</span>',
      title: 'Trg & ulica',
      sub: '<b>ne</b>',
      trail: '<span class="mark-closure"></span>',
      attrs: { 'data-testid': 'transit-row' },
    });
    expect(row).toContain('data-key="q&quot;1"');
    expect(row).toContain('<span class="row-title">Trg &amp; ulica</span>');
    expect(row).toContain('<span class="row-sub">&lt;b&gt;ne&lt;/b&gt;</span>');
    expect(row).toContain('<span class="line">6</span>');
    expect(row).toContain('<span class="mark-closure"></span>');
    expect(row.startsWith('<li class="row" data-key="q&quot;1" data-testid="transit-row">')).toBe(true);
  });
});

describe('a caller class joins the component instead of writing a second attribute', () => {
  it('lineBadge merges class into its own list and keeps every other attribute verbatim', () => {
    const html = lineBadge('6', 'tram', 's', { class: 't-badge', 'data-testid': 'peek-line' });
    expect(html.match(/class=/g)).toHaveLength(1);
    expect(html).toContain('class="line t-badge"');
    expect(html).toContain('data-testid="peek-line"');
    expect(html).toContain('data-kind="tram"');
  });
  it('signRow merges class the same way, so .row-dense is reachable through the builder', () => {
    const html = signRow({ key: 'r1', lead: '', title: 'Ilica', attrs: { class: 'row-dense', 'data-testid': 'stop-row' } });
    expect(html.match(/class="row[^"]*"/)?.[0]).toBe('class="row row-dense"');
    expect(html).toContain('data-testid="stop-row"');
  });
});
