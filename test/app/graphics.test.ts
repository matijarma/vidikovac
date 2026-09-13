// T1.5 (plan "Design system", finding 6): a figure's SVG draws geometry only;
// any number a person reads is HTML beside it, in a type role (rem), so it
// grows with the reader's own text zoom the way SVG's px-based `<text>`
// never could. Every figure builder still marks the element the reconciler
// swaps wholesale (`data-replace`/`data-sig`), moved off the `<svg>` onto an
// outer wrapper wherever the figure gained HTML content.
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { arcGauge, bars, compass, radar, rangeBar, ring, sunPath } from '../../app/src/ui/graphics';

/** Parses a trusted markup string into its root element, svg or html alike. */
function el(html: string): Element {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const node = t.content.firstElementChild;
  if (!node) throw new Error(`el(): produced no element from ${html.slice(0, 80)}`);
  return node;
}

describe('rangeBar: track/fill/marker in SVG, min/max/now readable as HTML', () => {
  const build = (now: number | null | undefined = 24.7) =>
    el(rangeBar({ min: 11, max: 25, now, minLabel: '11°', maxLabel: '25°', nowLabel: now === undefined || now === null ? undefined : '24,7°', label: 'od 11 do 25°C, trenutno 24,7°C' }));

  it('the outermost element carries data-replace and data-sig, and is the wrap the brief names', () => {
    const wrap = build();
    expect(wrap.tagName).toBe('DIV');
    expect(wrap.classList.contains('g-wrap')).toBe(true);
    expect(wrap.classList.contains('g-wrap-range')).toBe(true);
    expect(wrap.hasAttribute('data-replace')).toBe(true);
    expect(wrap.getAttribute('data-sig')).toBeTruthy();
  });

  it('contains exactly one svg.g-range, with no <text> elements (track, fill, marker only)', () => {
    const wrap = build();
    const svgs = wrap.querySelectorAll('svg.g-range');
    expect(svgs).toHaveLength(1);
    expect(svgs[0]!.querySelectorAll('text')).toHaveLength(0);
    // The geometry the brief keeps is still there.
    expect(svgs[0]!.querySelector('.g-track')).not.toBeNull();
    expect(svgs[0]!.querySelector('.g-fill')).not.toBeNull();
    expect(svgs[0]!.querySelector('.g-marker')).not.toBeNull();
  });

  it('.g-labels carries the min, max and now text as real HTML, not SVG', () => {
    const wrap = build();
    const labels = wrap.querySelector('.g-labels')!;
    expect(labels).not.toBeNull();
    expect(labels.querySelector('.g-label-min')?.textContent).toBe('11°');
    expect(labels.querySelector('.g-label-max')?.textContent).toBe('25°');
    const now = labels.querySelector('.g-label-now')!;
    expect(now.textContent).toBe('24,7°');
    // Positioned by percent along the track, not by a fixed px offset.
    expect(now.getAttribute('style')).toMatch(/left:\d+(\.\d+)?%/);
  });

  it('omits the now label (and its marker) when there is no current reading', () => {
    const wrap = build(null);
    expect(wrap.querySelector('.g-label-now')).toBeNull();
    expect(wrap.querySelector('svg .g-marker')).toBeNull();
  });

  it('data-sig changes when a value changes and stays put when nothing did', () => {
    const a = el(rangeBar({ min: 11, max: 25, now: 24.7, minLabel: '11°', maxLabel: '25°', nowLabel: '24,7°' }));
    const aAgain = el(rangeBar({ min: 11, max: 25, now: 24.7, minLabel: '11°', maxLabel: '25°', nowLabel: '24,7°' }));
    const bWarmer = el(rangeBar({ min: 11, max: 25, now: 25.1, minLabel: '11°', maxLabel: '25°', nowLabel: '25,1°' }));
    expect(a.getAttribute('data-sig')).toBe(aAgain.getAttribute('data-sig'));
    expect(a.getAttribute('data-sig')).not.toBe(bWarmer.getAttribute('data-sig'));
  });
});

describe('bars: HTML rows, no SVG at all', () => {
  const rows = [
    { id: 'a', label: 'Ugovaranje', value: 4, valueText: '4', tone: 'action' as const },
    { id: 'b', label: 'Izvođenje', value: 9, valueText: '9', caption: 'prije 2 dana', tone: 'urgency' as const },
  ];

  it('renders one .g-bar-label and one .g-bar-value per row, and no SVG anywhere', () => {
    const wrap = el(bars(rows, 10, 'Faze'));
    expect(wrap.tagName).toBe('OL');
    expect(wrap.classList.contains('g-bars')).toBe(true);
    expect(wrap.querySelectorAll('svg')).toHaveLength(0);
    expect(wrap.querySelectorAll('text')).toHaveLength(0);
    const labels = [...wrap.querySelectorAll('.g-bar-label')].map((n) => n.textContent);
    const values = [...wrap.querySelectorAll('.g-bar-value')].map((n) => n.textContent);
    expect(labels).toEqual(['Ugovaranje', 'Izvođenje']);
    expect(values).toEqual(['4', '9']);
  });

  it('carries data-replace/data-sig on the list itself and an aria-label from the optional title', () => {
    const wrap = el(bars(rows, 10, 'Faze'));
    expect(wrap.hasAttribute('data-replace')).toBe(true);
    expect(wrap.getAttribute('data-sig')).toBeTruthy();
    expect(wrap.getAttribute('aria-label')).toBe('Faze');
  });

  it('prints a row caption only when the row has one, and colours the fill by tone', () => {
    const wrap = el(bars(rows, 10));
    const items = wrap.querySelectorAll('li');
    expect(items[0]!.querySelector('.g-bar-caption')).toBeNull();
    expect(items[1]!.querySelector('.g-bar-caption')?.textContent).toBe('prije 2 dana');
    expect(items[0]!.querySelector('.g-bar-fill')?.getAttribute('data-tone')).toBe('action');
    expect(items[1]!.querySelector('.g-bar-fill')?.getAttribute('data-tone')).toBe('urgency');
  });

  it('data-sig changes when a value changes and stays put when nothing did', () => {
    const a = el(bars(rows, 10));
    const aAgain = el(bars(rows, 10));
    const changed = el(bars([rows[0]!, { ...rows[1]!, value: 10, valueText: '10' }], 10));
    expect(a.getAttribute('data-sig')).toBe(aAgain.getAttribute('data-sig'));
    expect(a.getAttribute('data-sig')).not.toBe(changed.getAttribute('data-sig'));
  });
});

describe('sunPath: sunrise, noon and sunset as HTML beside the arc', () => {
  const sunrise = Date.parse('2026-09-13T04:31:00Z').valueOf();
  const sunset = Date.parse('2026-09-13T17:13:00Z').valueOf();
  const now = Date.parse('2026-09-13T10:00:00Z').valueOf();
  const build = () => el(sunPath({ sunrise, sunset, now, sunriseLabel: 'izlazak 06:31', sunsetLabel: 'zalazak 19:13', noonLabel: 'podne 12:52', label: 'Dan.' }));

  it('wraps a data-replace/data-sig element around svg.g-sun with no <text>', () => {
    const wrap = build();
    expect(wrap.hasAttribute('data-replace')).toBe(true);
    expect(wrap.getAttribute('data-sig')).toBeTruthy();
    const svg = wrap.querySelector('svg.g-sun')!;
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll('text')).toHaveLength(0);
    expect(svg.querySelector('.g-path')).not.toBeNull();
  });

  it('reads sunrise, noon and sunset from .g-labels, not the SVG', () => {
    const texts = [...build().querySelectorAll('.g-labels span')].map((n) => n.textContent);
    expect(texts).toEqual(['izlazak 06:31', 'podne 12:52', 'zalazak 19:13']);
  });
});

describe('radar: ring distances and the centre name as HTML beside the dial', () => {
  const build = () =>
    el(
      radar({
        points: [{ id: 'q1', distanceKm: 42, bearingDeg: 90, size: 2, title: 'M 2,1 · 42 km' }],
        maxKm: 150,
        rings: ['50 km', '100 km', '150 km'],
        centreLabel: 'Zagreb',
        label: '1 potres u 150 km.',
      }),
    );

  it('wraps a data-replace/data-sig element around svg.g-radar with no <text>', () => {
    const wrap = build();
    expect(wrap.hasAttribute('data-replace')).toBe(true);
    const svg = wrap.querySelector('svg.g-radar')!;
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll('text')).toHaveLength(0);
    // The dot and its accessible name survive as an SVG <title>, not readable prose.
    expect(svg.querySelector('circle[data-key="q1"] title')?.textContent).toBe('M 2,1 · 42 km');
  });

  it('reads the ring distances and the centre name from .g-labels', () => {
    const texts = [...build().querySelectorAll('.g-labels span')].map((n) => n.textContent);
    expect(texts).toEqual(['50 km', '100 km', '150 km', 'Zagreb']);
  });
});

describe('compass and arcGauge: wrapped, geometry and its own SVG text unchanged', () => {
  it('compass keeps its dial, arrow and value/caption as SVG text, inside a data-replace wrap', () => {
    const wrap = el(compass({ bearing: 225, value: '2 m/s', caption: 'jugozapad', letters: ['S', 'I', 'J', 'Z'], label: 'Vjetar jugozapad 2 m/s' }));
    expect(wrap.hasAttribute('data-replace')).toBe(true);
    expect(wrap.classList.contains('g-wrap-compass')).toBe(true);
    const svg = wrap.querySelector('svg.g-compass')!;
    expect(svg.querySelector('.g-arrow')).not.toBeNull();
    expect([...svg.querySelectorAll('text')].map((n) => n.textContent)).toEqual(expect.arrayContaining(['2 m/s', 'jugozapad']));
  });

  it('arcGauge keeps its arc and value/caption as SVG text, inside a data-replace wrap', () => {
    const wrap = el(arcGauge({ fraction: 0.41, value: '41 %', caption: 'Vlaga' }));
    expect(wrap.hasAttribute('data-replace')).toBe(true);
    const svg = wrap.querySelector('svg.g-arc')!;
    expect([...svg.querySelectorAll('text')].map((n) => n.textContent)).toEqual(['41 %', 'Vlaga']);
  });
});

describe('ring: unwrapped, its sole caller (area S) sizes it as a direct flex child', () => {
  it('still returns a bare svg.g-ring carrying data-replace/data-sig itself, not a wrap', () => {
    const node = el(ring(0.5, 'label'));
    expect(node.tagName).toBe('svg');
    expect(node.classList.contains('g-ring')).toBe(true);
    expect(node.hasAttribute('data-replace')).toBe(true);
    expect(node.getAttribute('data-sig')).toBe('50');
  });
});
