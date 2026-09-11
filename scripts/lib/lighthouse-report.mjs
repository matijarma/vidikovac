// Pure helpers for scripts/lighthouse-a11y.mjs, kept separate so vitest covers them.

/** One row per page: rounded accessibility score and the ids of audits that scored below 1. */
export function summarise(path, lhr) {
  const raw = lhr?.categories?.accessibility?.score;
  const score = Math.round((typeof raw === 'number' ? raw : 0) * 100);
  const skip = new Set(['manual', 'notApplicable', 'informative']);
  const failed = Object.entries(lhr?.audits ?? {})
    .filter(([, a]) => typeof a.score === 'number' && a.score < 1 && !skip.has(a.scoreDisplayMode))
    .map(([id]) => id)
    .sort();
  return { path, score, failed };
}

export function renderTable(rows) {
  const pathWidth = Math.max('PAGE'.length, ...rows.map((r) => r.path.length));
  const line = (path, score, failed) => `${path.padEnd(pathWidth)}  ${String(score).padStart(4)}  ${failed}`;
  return [line('PAGE', 'A11Y', 'FAILING AUDITS'), ...rows.map((r) => line(r.path, r.score, r.failed.length ? r.failed.join(', ') : '-'))].join('\n');
}
