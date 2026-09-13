// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { morph, reconcile, reconcileChildren } from '../../app/src/ui/dom/reconcile';

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

describe('reconcileChildren', () => {
  it('keeps keyed nodes across reorders and updates their text', () => {
    const live = el('<ul><li data-key="a">A</li><li data-key="b">B</li><li data-key="c">C</li></ul>');
    const [a, b, c] = [...live.children];
    const next = el('<ul><li data-key="c">C2</li><li data-key="a">A</li><li data-key="d">D</li></ul>');
    reconcileChildren(live, next);
    expect([...live.children].map((li) => li.textContent)).toEqual(['C2', 'A', 'D']);
    expect(live.children[0]).toBe(c);
    expect(live.children[1]).toBe(a);
    expect(document.contains(b)).toBe(false);
  });

  it('keeps focus and the typed value of a controlled input', () => {
    const live = el('<div><input id="q" type="search" value=""><p>0</p></div>');
    document.body.replaceChildren(live);
    const input = live.querySelector('input')!;
    input.focus();
    input.value = 'tram';
    const next = el('<div><input id="q" type="search" value="tram"><p>3</p></div>');
    const kept = reconcile(live, next);
    expect(kept).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('tram');
    expect(live.querySelector('p')?.textContent).toBe('3');
  });

  it('moves a persisted node into place without touching its subtree', () => {
    const map = el('<div data-persist id="map"><canvas></canvas></div>');
    const live = el('<section><h2>Karta</h2></section>');
    live.appendChild(map);
    const canvas = map.firstElementChild;
    const next = el('<section><h2>Karta 2</h2><p>note</p></section>');
    next.insertBefore(map, next.lastElementChild); // the renderer moved the live node into the fresh tree
    reconcileChildren(live, next);
    expect([...live.children].map((c) => c.tagName)).toEqual(['H2', 'DIV', 'P']);
    expect(live.children[1]).toBe(map);
    expect(map.firstElementChild).toBe(canvas);
    expect(live.querySelector('h2')?.textContent).toBe('Karta 2');
  });

  it('replaces a data-replace figure only when its signature changes', () => {
    const live = el('<div><svg data-replace data-sig="1"><rect/></svg></div>');
    const first = live.firstElementChild;
    reconcileChildren(live, el('<div><svg data-replace data-sig="1"><circle/></svg></div>'));
    expect(live.firstElementChild).toBe(first);
    reconcileChildren(live, el('<div><svg data-replace data-sig="2"><circle/></svg></div>'));
    expect(live.firstElementChild).not.toBe(first);
    expect(live.querySelector('circle')).not.toBeNull();
  });

  it('preserves an open <details> the user opened', () => {
    const live = el('<div><details><summary>x</summary>y</details></div>');
    live.querySelector('details')!.open = true;
    reconcileChildren(live, el('<div><details><summary>x</summary>z</details></div>'));
    expect(live.querySelector('details')!.open).toBe(true);
  });

  it('morph syncs attributes and removes stale ones', () => {
    const from = el('<button class="a" aria-pressed="true" data-x="1">A</button>');
    morph(from, el('<button class="b" aria-pressed="false">B</button>'));
    expect(from.className).toBe('b');
    expect(from.getAttribute('aria-pressed')).toBe('false');
    expect(from.hasAttribute('data-x')).toBe(false);
    expect(from.textContent).toBe('B');
  });
});
