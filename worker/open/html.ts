// The one sanctioned way a feed value reaches server-rendered markup. Every
// interpolated, non-literal string in worker/hitno, worker/open and
// worker/stats goes through this; the page copy itself is literal.
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
