import { describe, expect, it } from 'vitest';
import { renderTable, summarise } from '../../scripts/lib/lighthouse-report.mjs';

function lhr(score: number | null, audits: Record<string, { score: number | null; scoreDisplayMode: string }>) {
  return { categories: { accessibility: { score } }, audits };
}

describe('summarise', () => {
  it('rounds the category score to 0-100 and lists failing audits only', () => {
    const row = summarise(
      '/hitno',
      lhr(0.946, {
        'color-contrast': { score: 0, scoreDisplayMode: 'binary' },
        'html-has-lang': { score: 1, scoreDisplayMode: 'binary' },
        'focus-traps': { score: null, scoreDisplayMode: 'manual' },
        'aria-hidden-body': { score: null, scoreDisplayMode: 'notApplicable' },
      }),
    );
    expect(row).toEqual({ path: '/hitno', score: 95, failed: ['color-contrast'] });
  });

  it('treats a missing score as zero', () => {
    expect(summarise('/', lhr(null, {})).score).toBe(0);
  });
});

describe('renderTable', () => {
  it('prints one aligned line per page with the failing audit ids', () => {
    const text = renderTable([
      { path: '/', score: 100, failed: [] },
      { path: '/kiosk/', score: 92, failed: ['color-contrast', 'label'] },
    ]);
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^PAGE\s+A11Y\s+FAILING AUDITS$/);
    expect(lines[1]).toMatch(/^\/\s+100\s+-$/);
    expect(lines[2]).toMatch(/^\/kiosk\/\s+92\s+color-contrast, label$/);
  });
});
