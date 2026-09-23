// One line's name as a pill writes it, and the one-row budget it is held
// to: the part of the pill rule (pills.ts) that a vehicle's own label needs
// without a drawn map. city-map.ts vehicleLabel reads it on every surface,
// the lightweight phone included, so it stays a module of its own and the
// geometry, the glyph table and the clustering in pills.ts stay with the
// renderers (test/app/budget.test.ts). pills.ts re-exports both names.

/** A merged pill names every line in it and grows with them [O-35]: a
 *  count of hidden lines tells someone waiting for a tram nothing. This is
 *  the budget of one row, the widest capsule there is (290 px): all fifteen
 *  tram lines, "1·2·3·4·5·6·7·8·9·11·12·13·14·15·17", are 35 characters
 *  and fit on one; ten three-digit bus routes are 39. A longer label wraps
 *  onto further rows (PILL_MAX_LINES), so a bus hub of thirty three-digit
 *  routes is still written whole, and a single line's name never runs past
 *  one row (pillLabel). */
export const PILL_MAX_CHARS_CLUSTER = 40;

/** One line's name as its pill writes it: whole, as it always is for a
 *  ZET line (four characters at most). Only an identifier longer than one
 *  row of the widest capsule (PILL_MAX_CHARS_CLUSTER) is cut to it, so no
 *  label ever runs past its pill; it is never emptied. The standalone and
 *  selected pills (city-map.ts's vehicleLabel) and every line of a cluster
 *  pass through here, so the cap holds on every mark. */
export function pillLabel(label: string): string {
  return label.length > PILL_MAX_CHARS_CLUSTER ? label.slice(0, PILL_MAX_CHARS_CLUSTER) : label;
}
