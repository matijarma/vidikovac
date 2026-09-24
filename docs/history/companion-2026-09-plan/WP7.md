# WP7 — Closing pass: README to the new reality, a development-notes layer on `/prijava/`, repository hygiene

Part of the companion brief `docs/companion-2026-09-22.md` (§15). Written by hand on 22 September 2026 from the owner's instructions [O-75], [O-76]; not part of the planner/verifier workflow. Runs **after the final push to `main` and its deployment (D4)** and ends with one more push (**D5**).

## 0. Owner rulings (binding)

- "one final touch on this work, after full and final push to main and deployment, should be a strong pass at readme.md updating it with new reality. in fact that task will need to include also adding some sort of development notes/updates toggle to the /prijava/ page so that the original is there but with an optional layer that shows prototype progress since then." [O-75]
- "its a public repo and we dont want to spam or confuse readers and we certainly dont want to display the artifact mess or anything else. docs are fine and even development history etc but it needs to be intended not just leftover .md files from sessions and whatnot." [O-76]
- The submitted application text stays byte-identical (brief §1); the notes layer is additive and off by default.
- README.md was remade by the owner on 22 September (English, product-first). WP7 updates its content to the deployed product; it does not change its voice or structure without the owner.

## Goal

A reader who opens the repository or `/prijava/` after the companion round sees the product as deployed, not the September prototype: the README describes the timeline wall, the place-led phone, the three tabs and the cleared end of session; the proposal page still shows the submitted text exactly, with an optional, dated layer of what the prototype has done since submission; and `docs/` contains only documents someone meant to publish, each indexed and written for a reader.

## Depends on

- D4 deployed and observed (§16.7) so the README describes what is live, with fresh captures.
- The brief `docs/companion-2026-09-22.md` and this folder, as the record of the round.

## Steps

### 1. README.md to the new reality `[M]`

Files: `README.md`, `app/public/landing/*.webp`, `scripts/capture-landing.mjs` (local flow only; never against production without `AUDIT_KIOSK_URL`).

Rewrite the sentences that describe the retired prototype and keep the owner's structure and voice: "When time runs out, updates stop—not your ability to keep what you found. The last view remains as a dated snapshot, with attribution and export actions." → the content clears to the scan invitation and `/hitno`; the keepable-data vision is a later layer (brief §17 Q25). "On the wall: a passive overview with an anchored map, moving transport, current conditions, rotating highlights…" → the place in the header, one written sentence, the map framed around the place, the "U blizini" timeline, the QR card, the footer. "In your hand: local departures, search, saved stops and places, a map and an events agenda" → the place as title, one sentence, three departures, "U blizini", Karta as the timeline's map, Sada · Karta · Još. "At your desk: … direct access to transport, weather, events, civic information and safety" → the phone, wider. The "Try it" steps: one field "Adresa ili stajalište" and Pokreni; settings by a long press. "Verification and deployment": add `npm run accept`, `npm run accept:e2e`, `npm run replay:grade`, `npm run observe:production` and the read-only rule for production screens. "Under the hood": the matcher's own-path rule and the silent-vehicle rule in one sentence each; "Path matching and silence handling remain active areas of refinement" → what changed and what the grader measures. Replace the three captures with new ones of the deployed product (wall 1280 light, desktop 1280, phone 390) taken through the local flow with fixtures or from the owner's own screen; keep the caption rule (real data, masked credentials, dated, "an example capture, not current information"). "Explore the project": add the brief and `docs/history/`.

### 2. Development-notes layer on `/prijava/` `[M]`

Files: `docs/prijava/razvojne-biljeske.md` (new), `docs/prijava/src/template.html`, `docs/prijava/src/prijava.js` and `prijava.css` (the sources that produce `app/prijava/index.html` and `app/prijava/prijava.js`), `app/prijava/index.html`, `app/prijava/prijava.js`, `test/docs/prijava.test.ts`.

The submitted proposal (`docs/prijava/prijedlog-projekta.md`, its `.html` and `.docx`, the form texts) is **not edited**. Add `docs/prijava/razvojne-biljeske.md`: dated entries in Croatian (standard, natural; the owner reads them), each naming what changed since submission and pointing at the record (the brief, `docs/history/`), starting with the 14 September opening, the 17–21 September passes and the companion round. Render it into the hosted page as a layer: a single control at the top of the document, `<button type="button" aria-pressed="false" data-testid="prijava-notes">Razvojne bilješke od predaje</button>`, default off; when on, the notes appear as a marked aside (`<aside data-testid="prijava-notes-layer" aria-labelledby="…">`, distinct background, the label "Bilješke o razvoju nakon predaje, nisu dio predanog prijedloga") either above the document or as dated margin notes anchored to the sections they concern; the submitted text keeps its markup and order. The preference is remembered in `localStorage` (same key family as the theme control; try/catch). `noindex` stays. Keyboard: the button is focusable, `aria-pressed` toggles, the aside is `hidden` when off. Test in `test/docs/prijava.test.ts`: (a) the article text of `app/prijava/index.html` with the notes layer removed equals the text rendered from the committed `prijedlog-projekta.md` (or the pre-WP7 snapshot `docs/prijava/src/snapshot.json`, whichever the existing test already compares against); (b) the layer is `hidden` in the shipped HTML; (c) every entry in `razvojne-biljeske.md` has a date and a link. `test/docs/izvori.test.ts` parity with `prijedlog-projekta.md` is unaffected because the proposal text does not change.

### 3. Repository hygiene `[S]`

Files: `docs/`, `docs/history/` (new), `README.md` "Explore the project".

Move `docs/companion-2026-09-22-plan/` to `docs/history/companion-2026-09-plan/` and change the brief's pointers accordingly; the brief itself stays under `docs/` as the record of the round (dated file name chosen by the owner). Delete `docs/companion-2026-09-answerssection17.md` (its content is in the brief §17 and the ledger). Run `git ls-files docs '*.md'` and, for every file, either name the document that indexes it (README "Explore the project", PRODUCT.md, DESIGN.md or a parent document) or move it under `docs/history/` with one line in `docs/history/README.md` saying what it was; `docs/superpowers/` is already declared history by the README. No file from `review.local/`, no capture with a live code, no artifact export enters the tree.

## Tests to update

- `test/docs/prijava.test.ts`: the notes-layer cases of step 2.
- `test/docs/docs.test.ts`: if it pins README phrases, update the pins with the rewritten sentences; keep every existing pin that still holds.
- Any test that reads a path under `docs/companion-2026-09-22-plan/` (none expected).

## Acceptance (executable)

| # | Criterion | How |
|---|---|---|
| A1 | README describes the deployed product | `! grep -nE 'dated snapshot|export actions|rotating highlights|events agenda' README.md` and `grep -c 'U blizini' README.md` ≥ 1 and `grep -c 'accept' README.md` ≥ 1 |
| A2 | The submitted text is byte-identical | `git diff --stat D4..HEAD -- docs/prijava/prijedlog-projekta.md docs/prijava/prijedlog-projekta.html docs/prijava/prijedlog-projekta.docx docs/prijava/obrazac-*.md docs/prijava/plan-provedbe.md docs/prijava/rizici-i-odgovori.md` is empty; `npx vitest run test/docs/prijava.test.ts test/docs/izvori.test.ts` green |
| A3 | The notes layer is off by default and readable when on | `npx playwright test e2e/prijava.spec.ts` (new, local): `[data-testid=prijava-notes-layer]` hidden on load; after clicking `[data-testid=prijava-notes]` it is visible with ≥ 1 dated entry and `aria-pressed="true"`; axe serious + critical 0 on `/prijava/` |
| A4 | Only intentional documents in `docs/` | `git ls-files docs '*.md' | grep -v '^docs/history/'` lists only files named in README "Explore the project", PRODUCT.md, DESIGN.md or a parent document (checked by eye, listed in the PR); `test -e docs/companion-2026-09-answerssection17.md` fails; `test -d docs/history/companion-2026-09-plan` succeeds |
| A5 | Nothing sensitive or stray | `git ls-files | grep -E '(^|/)\.dev\.vars$|screen(-[0-9-]+)?\.json$|(^|/)recordings/|^review\.local/|test-results/' | wc -l` = 0 |
| A6 | Deploy | `git push` to `main`; Cloudflare Builds green; `/prijava/` and `/` render; `npm test` green |

## Risks

- The proposal HTML may be generated from the sources under `docs/prijava/src/` by a script; if so, the layer belongs in the template and the generator, not in the generated file, so a regeneration keeps it. Check how `app/prijava/index.html` is produced before editing.
- New captures for the README must come from the local flow with fixtures or from the owner's own screen; `scripts/capture-landing.mjs` refuses to create production screens after WP6 (`AUDIT_ALLOW_SCREEN_CREATE`).
- The notes are Croatian copy: the owner reads them before the push (brief §10 principle 11).

## Agent brief

One agent, after D4 is deployed and observed. Read: the owner's README.md as it stands, brief §11 and §15.9 (what shipped), §17 Q1/Q25 (what to say about the end of session), `docs/prijava/src/*` and `app/prijava/*` (how the page is built), `test/docs/prijava.test.ts`, `test/docs/docs.test.ts`. Do steps 1–3 exactly as written; keep the README's voice and structure; never edit the submitted proposal files; write the notes in standard, natural Croatian and list them for the owner's read-through; take captures only through the local flow. Done when A1–A5 hold locally and the owner has read the README diff and the notes; then `git push` to `main` (A6).
