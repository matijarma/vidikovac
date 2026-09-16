// The eight kinds of statement the column can say (plan "The column:
// statements", the candidates' table order), in one place with no imports:
// say.ts builds a candidate per kind and re-exports this list, and
// kiosk/layout.ts sizes the handheld's "every statement" from its length.
// A leaf on purpose: layout.ts is read by the e2e specs through Playwright's
// own ESM loader, which cannot follow say.ts's graph (it reaches JSON
// catalogues imported without an import attribute), so the list the two
// files share must not drag that graph behind it.
export const SAY_KINDS = Object.freeze(['transit', 'quake', 'tonight', 'forecast', 'closure', 'lastrun', 'zet', 'assembly', 'works', 'kvart'] as const);

/** One statement kind: the type is the list, so a new kind is added in exactly one place. */
export type SayKind = (typeof SAY_KINDS)[number];
