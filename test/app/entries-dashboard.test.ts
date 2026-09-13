// The /d/ entry without a room in the fragment: the composed empty state is the
// page's main landmark and the skip link's target, so a bookmarked or shared
// /d/ is as reachable as a running session (Lighthouse: landmark-one-main, skip-link).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]): string => readFileSync(join(import.meta.dirname, '..', '..', 'app', ...parts), 'utf8');

describe('the /d/ no-room state', () => {
  const ENTRY = read('src', 'entries', 'dashboard.ts');
  const PAGE = read('d', 'index.html');
  it('composes the empty state as <main id="ki-main">, the element the page skip link points at', () => {
    expect(ENTRY).toContain("document.createElement('main')");
    expect(ENTRY).toContain("empty.className = 'ki-empty'");
    expect(ENTRY).toContain("empty.id = 'ki-main'");
    expect(ENTRY).toContain('empty.tabIndex = -1');
    expect(PAGE).toContain('<a class="skip-link" href="#ki-main"');
  });
});
