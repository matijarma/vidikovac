# Kaj ima? homepage

Owner-approved direction, 16 September 2026: **Manje zaslona. Više grada.**

The homepage is an evaluator-facing introduction to the working service, not
another dashboard or a separate demo. It leads with presence and time returned
to people, proves that idea with the actual product, and explains how to try it
without already having a code. The application, pairing protocol, shared theme
tokens and proposal documents are unchanged.

## Design contract

Manrope, paper, ultramarine ink and Zagreb blue, using the existing Dan grada
and Prozor identity. The sequence is hero, four-chapter blue story, asymmetric
product evidence, clearly separated current data, real trial instructions, and
the public-service case with a link to the proposal.

The four chapters are Priđi, Ponesi, Podijeli and Nastavi. On a sufficiently
large desktop, an IntersectionObserver drives a decorative sticky device stage.
The chapter text remains in reading order. Phones, short screens, large text,
reduced motion, lightweight mode and no JavaScript keep the complete in-flow
story. No scroll interception, video, iframe, live map, simulated session or
autoplay countdown is part of this page.

The impeccable craft process supplied the confirmed brief, progressive
enhancement requirements, and browser critique/revision pass. Image probes and
north-star image generation were skipped because native generation was not
available. Actual product captures are the visual material.

## Data and entry contracts

- Only `/api/teaser` and `/api/health` are read. No new endpoints or server
  contracts. Browsing the homepage never provisions a screen or redeems a code.
- The current-data strip loads as it approaches view, refreshes at one-minute
  intervals while visible, pauses in background tabs, and prevents overlapping
  requests. Returned values and statuses update immediately on language change.
- A responding source, a stale value and an active warning are different states.
  Missing data is never zero. Missing/stale warning data cannot claim an
  all-clear. Failed requests retain last-good values with explicit stale wording.
- Observation, source and fetch times are labelled separately. The health check
  timestamp is never presented as an observation.
- “Isprobaj” links to the trial instructions. Screen setup opens in a labelled
  new tab. A phone can scan, or code entry can open in another tab of the same
  browser. All grants still require normal single-use code redemption.
- Empty code entry has a quiet link back to `/#isprobaj`. The setup introduction
  explains keeping the screen open and using another phone/tab.

## Product imagery

`app/public/landing/captures.json` records the timestamp, viewport, route,
language and theme for each of the 28 captures. Each has two optimized WebP
widths. The source is the running local app with real source data, ordinary
self-service setup and ordinary code redemption. The second phone uses a real
five-minute shared session. The frozen view was captured after the real
ten-minute session ended.

QR, pairing-code and read-aloud-code regions are explicitly masked. Captures
are labelled as examples, not current information. Attribution remains in the
captured interface. No private credentials or raw session payloads are
published. The first-viewport image budget is 200 kB for the largest kiosk and
phone variants together; subsequent imagery is lazy-loaded.

To regenerate, run the local Worker on 8787 and the existing review server on
5174, then:

```powershell
node scripts/capture-landing.mjs
node scripts/share-landing.mjs
```

Capture is local-only and takes at least one real ten-minute session. New
captures are staged under the ignored `review.local/` directory and published
only when the full set is complete. The sharing image is composed from the
homepage and its actual captures, not separately invented UI.

## Verification

```powershell
npm run typecheck
npm run build
npm test
node scripts/review-landing.mjs
```

The visual review covers 320, 390, 768, 1440 and 1920px, light/dark, English,
reduced motion, lightweight mode, no JavaScript and 200% text. It captures every
chapter and the trial, checks overflow, targets, image failures, runtime errors,
accessibility and unintended POSTs. Evidence goes to `review.local/landing/`.
Use `--quick` for desktop/phone, or `--scene phone-zoom` for one scenario.

Playwright's `e2e/landing.spec.ts` covers scroll direction/jumps, language and
image changes, source failure/recovery, lightweight/no-JS/image-failure states,
and genuine same-browser and separate-phone trials. The existing pairing,
screen-creation, accessibility and lightweight suites remain relevant.

Wait for local builds to finish before browser tests: multiple Wrangler
instances otherwise rebuild the same `app/dist/` directory during navigation.
Self-service tests consume real local screen quotas; a fresh, isolated local
Worker state avoids interference with earlier manual evaluations without
changing production limits. No tests here authorize deployment or publication.

### Verification record, 16 September 2026

- Typecheck and the production build pass.
- The six focused landing, page, scan, copy, locale and budget files pass:
  149 tests.
- The landing, screen-creation, pairing, accessibility and lightweight browser
  suites pass: 36 Chromium tests. The updated mobile landing check also passes:
  37 browser checks in total, including actual twelve-second test-session expiry.
- All 15 rendered scenarios pass: no horizontal overflow, undersized targets,
  missing images, serious/critical axe findings, runtime exceptions or unintended
  POST requests. Desktop chapter order is verified in both directions.
- The full current-tree suite ran on the concurrent merge `19a2718`: 2,555 tests
  pass and one unrelated assertion fails at `test/app/overlays.test.ts:328`.
  It expects `event:barred` to remain excluded, while the owner-directed source
  expansion in `a13a40d` removed that filter from `placedEvents`. This work
  intentionally leaves the map change and its stale assertion untouched.
- These are automated browser checks, not physical iPhone/Android or QR-distance
  testing. This session did not commit, push or deploy. The external commit/merge
  that occurred during implementation was preserved.
