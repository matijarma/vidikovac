# Readable city refinement

Implementation of the owner's September 20 plan, based on `7b56363`.
The owner subsequently authorized pushing the verified result to `main`
through GitHub → Cloudflare Builds. Submitted application artifacts are
unchanged.

## Implemented

- Phone search opens the full visible sheet; keyboard occlusion uses
  VisualViewport, navigation bounds and the actual stage. Short landscape is
  list-first. Filters have one disclosure. One ranked combobox covers routes,
  stops, places and streets; co-located Wi-Fi records are grouped.
- Passive kiosk composition replaces touch discovery and the header ticker.
  Conditions, a 20-second attributed highlight and the QR have reserved
  regions. Ambient map geometry is separate from selection and presentation.
- Explicit handheld/desktop/public-display symbol profiles and bounded
  route-cluster labels. Settings preserve unsaved drafts.
- Sada uses the page-owned departure cache and arrival calculation; local
  context is named, duplicated event previews and empty time sections removed.
- Saved routes/stops/places are retrievable through Još; desktop does not
  duplicate its primary navigation. Notifications renamed in-app highlights.
- Event date navigation, accessible venue actions, scoped counts, agenda
  return position; weather hierarchy and station-index labels; compact civic
  phase filter and independent columns.
- Shared dialogs account for the visible keyboard viewport. Share progress
  animates transforms. Product/design and public reference descriptions updated.

## Verification, September 21

Heavy checks were run sequentially, with one test worker and no subagents.

- TypeScript and production build pass.
- Final full unit suite: 2,679 passing tests across 183 files, including
  the final copy/ordering polish and Croatian bicycle-count regression.
- Worker integration: 176 passing tests across 28 files, with remote bindings
  disabled in the test harness only. Production bindings are unchanged.
- Built-browser batch: 47 passing tests covering the public pages, all six
  personal screens, small/standard phones, short landscape, tablet, desktop,
  200% text, both themes, and Croatian/English.
- Kiosk: 1366×768, 1920×1080, 1080×1920 and 3840×2160; long titles, quiet
  records, warning persistence, source outages, multiple highlight/QR cycles,
  pause/resume, and handheld preview. Ambient geometry cannot change a
  personal selection or send a presentation command.
- Phone: complete stop result at 320×568, including simulated VisualViewport
  keyboard occlusion. Saved place → leave → retrieve → reload stays private.
  Event → venue → map, street stories, heritage and BAJS rent/return pass
  with and without a map. DPR 1/2/3 checks preserve CSS symbol scale.
- Real pairing in independent browser contexts: ten-minute direct access,
  five-minute one-hop sharing, single-use codes, no presentation on scanning,
  confirmed takeover, acknowledgement, source removal/recovery, reload,
  stopping and shortened real-server expiry all pass.
- Four session accessibility sweeps pass, including keyboard focus clear of
  the header/navigation. Four print/no-JavaScript tests pass; selected civic
  exports retain attribution and emergency numbers remain legible.
- Lightweight transfer: 184,765 bytes for `/kiosk/`, 192,709 for `/d/`,
  under the existing 200,000-byte budget. No font/map import is added to
  the lightweight path.

Rendered review found and corrected a filter-panel geometry defect that the
initial tests did not cover. The visible detent now bounds its own scrollport,
opening filters raises the sheet, and lightweight mode never creates a
detent controller. Live capture review also moved nearby practical actions
before citywide counts and corrected Croatian bicycle-count nouns.

All 28 live-data capture variants were refreshed on September 21, between
02:56 and 03:07 UTC, using ordinary local screen creation and code redemption.
The four frozen variants were captured after genuine ten-minute expiry.
QR/code credentials are masked, and the homepage sharing image was rebuilt
from those actual captures. The final build and both test suites passed
after the capture assets were published to `app/public/landing/`.
The final post-capture browser smoke run passed all 15 tests: homepage trial,
language/theme and lightweight behavior, 320px keyboard search, saved-item
retrieval, DPR 1/2/3, and the long-title/warning/outage kiosk sequence.

## Venue-pilot limitations

Browser evidence does not establish physical-display legibility, camera
scanning at distance, mobile Safari keyboard behavior, or VoiceOver usability.
Those checks still require the actual devices before a venue pilot.
Keyboard occlusion in automation is simulated, not a physical software
keyboard. Feed outages remain labelled; no test turns an unavailable source
into a claim of current confirmation.

## Local verification

Use `wrangler dev --local` to disable remote bindings for local pairing and
source fetching. The final browser checks use the built app. A local service
keeps the API alive across agent interruptions; it does not deploy anything.

```sh
npx wrangler dev --local --port 8787 --inspector-port 9229 --var APP_ENV:test
node scripts/review-server.mjs --built --port 5180
E2E_NO_WEBSERVER=1 E2E_APP_URL=http://127.0.0.1:5180 npx playwright test e2e/readable-city.spec.ts --project chromium
```

Test logs and review evidence stay in ignored `review.local/`. Published
landing captures use real source data and local code redemption; pairing
credentials are explicitly masked. The frozen captures wait for real expiry,
without clock substitution.
