// TS port of v1's `src/app/utils/dom.js` escaping discipline. Any component
// that builds markup via template strings (rather than DOM APIs +
// textContent) MUST route interpolated, non-literal values through one of
// these before it lands in `innerHTML` — this is the one sanctioned escape
// hatch for the "framework-light" component style used across
// `packages/ui/src/components/*`.

/** Escapes a value for safe placement in HTML text content / innerHTML. */
export function escapeHtml(value: unknown): string {
  const text = String(value ?? '');
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Escapes a value for safe placement inside a double-quoted HTML attribute. */
export function escapeAttribute(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Parses a trusted HTML string into a single DOM element. The template
 * itself must come from our own component code (values it interpolates go
 * through `escapeHtml`/`escapeAttribute` above) — this is not an HTML
 * sanitizer for untrusted markup.
 */
export function createElementFromHTML(html: string): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const node = template.content.firstElementChild;
  if (!(node instanceof HTMLElement)) {
    throw new Error('createElementFromHTML: template did not produce an element');
  }
  return node;
}
