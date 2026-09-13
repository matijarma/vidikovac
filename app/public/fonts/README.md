# Self-hosted fonts

Real woff2 binaries (not a CDN reference) for the one design-bible typeface:

| Family         | Weights       | Subsets          | Files             |
| -------------- | ------------- | ---------------- | ----------------- |
| Manrope (body) | 400, 500, 700 | latin, latin-ext | `manrope/*.woff2` |

Six files: each of the three weights split into `latin` and `latin-ext`.
`latin-ext` covers the diacritics `app/src/i18n/hr.json` actually uses (č ć
đ š ž).

## Provenance

Fetched **once**, at authoring time, from Google Fonts' `css2` API with a
desktop-Chrome `User-Agent` (so it returns woff2), parsed for the `latin` /
`latin-ext` `@font-face` blocks only (dropped cyrillic/greek/vietnamese/etc.),
and the referenced `fonts.gstatic.com` binaries downloaded straight into this
folder. The generating commands are recorded in the M3.1 font-subsetting work
(that scratch directory has since been deleted; the provenance below is the
record). Manrope is licensed under the SIL Open Font License, 1.1. Nothing in
the shipped product (`../src/ui/fonts.css`, or any consumer) references
`fonts.googleapis.com` / `fonts.gstatic.com` — every `src: url(...)` in
`fonts.css` is a relative path into this folder.

Manrope's three weight requests each resolved to the same underlying
file — the family ships as a variable font on Google's backend; Google's
own css2 output does this too (multiple `@font-face` blocks, same `src`, a
different single-value `font-weight` descriptor each) and browsers
instantiate the correct weight per rule. Not a bug, not deduplicated further
here so the `@font-face` set in `fonts.css` matches one-for-one with what a
normal Google-Fonts-authored stylesheet would emit.

If these ever need to be regenerated/re-subset by hand instead: keep the
same filename convention (`<slug>-<weight>-<style>-<subset>.woff2`) so
`../src/ui/fonts.css` doesn't need to change.

## Loading rule

Manrope is the modern-path typeface only; the lightweight graph (`?lagano=1`)
never loads a font, only the system stack named in `tokens.css`
(`test/app/budget.test.ts` holds the lightweight graph to zero fonts). Every
entry decides `lightweight` first; only when it is false does the entry
`import('../ui/fonts.css')` as a dynamic import, so Vite emits `fonts.css`
and its six woff2 files as a chunk the lightweight graph's bundle never
references.
