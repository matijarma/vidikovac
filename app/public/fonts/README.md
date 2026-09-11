# Self-hosted fonts

Real woff2 binaries (not a CDN reference) for the three design-bible
typefaces:

| Family                  | Weights       | Subsets          | Files                    |
| ----------------------- | ------------- | ---------------- | ------------------------ |
| Space Grotesk (display) | 500, 700      | latin, latin-ext | `space-grotesk/*.woff2`  |
| Manrope (body)          | 400, 500, 700 | latin, latin-ext | `manrope/*.woff2`        |
| JetBrains Mono (mono)   | 400, 500      | latin, latin-ext | `jetbrains-mono/*.woff2` |

`latin-ext` covers the diacritics `packages/ui/src/i18n/locales/{es,hr}.json`
actually use (á é í ó ú ñ ü ¿ ¡ / č ć đ š ž).

## Provenance

Fetched **once**, at authoring time, from Google Fonts' `css2` API with a
desktop-Chrome `User-Agent` (so it returns woff2), parsed for the `latin` /
`latin-ext` `@font-face` blocks only (dropped cyrillic/greek/vietnamese/etc.),
and the referenced `fonts.gstatic.com` binaries downloaded straight into this
folder. The generating commands are recorded in
the M3.1 font-subsetting work (that scratch directory has since been deleted;
the provenance below is the record). Nothing in the shipped
product (`../src/fonts.css`, or any consumer) references
`fonts.googleapis.com` / `fonts.gstatic.com` — every `src: url(...)` in
`fonts.css` is a relative path into this folder.

Space Grotesk's weight-500 and weight-700 requests both resolved to the same
underlying file (and same for each Manrope/JetBrains Mono weight pair) — that
family ships as a variable font on Google's backend; Google's own css2
output does this too (multiple `@font-face` blocks, same `src`, a different
single-value `font-weight` descriptor each) and browsers instantiate the
correct weight per rule. Not a bug, not deduplicated further here so the
`@font-face` set in `fonts.css` matches one-for-one with what a normal
Google-Fonts-authored stylesheet would emit.

If these ever need to be regenerated/re-subset by hand instead: keep the
same filename convention (`<slug>-<weight>-<style>-<subset>.woff2`) so
`../src/fonts.css` doesn't need to change.
