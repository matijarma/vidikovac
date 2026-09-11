// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { closeTopmostDialog, createDialog, hasOpenDialog } from '../../app/src/ui/dialog';

describe('createDialog', () => {
  it('opens as a modal, wires aria-labelledby, closes from the X and restores focus', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const d = createDialog({ titleId: 't1', title: 'Skeniraj', closeLabel: 'Zatvori', body: 'tekst' });
    d.open();
    expect(d.isOpen()).toBe(true);
    expect(hasOpenDialog()).toBe(true);
    expect(d.element.getAttribute('aria-labelledby')).toBe('t1');
    expect(d.element.querySelector('#t1')?.textContent).toBe('Skeniraj');
    (d.element.querySelector('[data-dialog-close]') as HTMLButtonElement).click();
    expect(d.isOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
    d.destroy();
    opener.remove();
  });
  it('closeTopmostDialog closes the last opened dialog only', () => {
    const a = createDialog({ titleId: 'a', title: 'A', closeLabel: 'x' });
    const b = createDialog({ titleId: 'b', title: 'B', closeLabel: 'x' });
    a.open(); b.open();
    expect(closeTopmostDialog()).toBe(true);
    expect(b.isOpen()).toBe(false);
    expect(a.isOpen()).toBe(true);
    a.destroy(); b.destroy();
    expect(hasOpenDialog()).toBe(false);
  });
});
