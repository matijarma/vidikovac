# Integrated Kaj ima? review, 13 September 2026

Fable independently reviewed the integrated main tree, including Codex's
uncommitted session recovery. The review ran 44 session/dashboard/view-store/
feed-store tests and inspected rendered evidence. It did not claim a physical
device or QR-distance test.

## Findings and ownership

1. Full-map CSS still targets the old `.dash` shell, and the old percentage
   height chain can collapse its canvas. Fable map implements the `.ki`
   layout with usable session, exit and expiry controls.
2. Transport reparenting can blur search before the dashboard records focus.
   Codex now captures focus and caret before rendering; Fable map adopts the
   reconciler's persistent-node placeholder. Real browser regression required.
3. A failed initial room handshake has no recovery. Codex adds bounded initial
   retry, handshake timeout, scan recovery after a spent ticket, and isolation
   of late events from abandoned sockets. Session suite: 24 passing.
4. History restoration does not immediately fetch the restored domain.
   Codex adds refresh and public-only relay on domain restoration.
5. A multi-source poll causes repeated synchronous full renders. Codex
   coalesces feed emissions within a microtask while keeping progressive data.
6. The national events filter can mistake Zagreb street names or the
   organiser's city for the venue. Codex removes street-name segments and
   uses venue evidence only, with regression cases.

Previously assigned follow-ups remain part of acceptance: kiosk source-state
hold and resize, no unsupported wind-calm claim, readable/opaque route numbers,
no live badge for slow/reference sources, and no side-stripe decoration.

## Independent checks with no new finding

Access JWT signature/issuer/audience checks; principal/global creation quotas;
reservation release on failure; one-hop peer rooms; public selection allowlist;
private queries not relayed; current-item export and attribution; no refresh
after expiry; source outages not treated as all-clear.

The review noted that old contributor transport screenshots still show the
removed schematic. Only the integrated vector-map application counts toward
final acceptance. New evidence is generated outside Playwright's cleared
directory, under `review.local/final/`.

## Follow-up review

Fable reviewed the integrated fixes and ran six suites / 155 tests. The
remaining shared-code issue was storage-dependent reconnection: a blocked
sessionStorage should not prevent a live tab from resuming. Codex now retains
the resume token in memory, clears it on invalidation/expiry and tests the
storage-failure path. Invalid grants emit one recovery event instead of two.
The transport unit test's fallback catalogue is mocked explicitly, eliminating
an accidental request to localhost:3000.

Map expansion now has measured browser checks at 390 and 1440 pixels and a
permanent E2E assertion for real increased height, retained canvas, visible
expiry recovery and Escape. The real sharing journey checks a separate
five-minute room, unchanged original expiry and no onward share control.

## Final presentation review and closure

Fable's final read-only review measured four material issues, subsequently
fixed by Codex and rechecked by Fable:

- Dark-mode print retained pale domain colours and dark tints. The print
  presentation now uses paper-safe text, transparent fills and visible rules.
- The 112 tile and route badges depended on filled backgrounds. They now print
  as outlined dark text even with browser background graphics disabled.
- During a failed preview request, the kiosk strip and paired content could
  choose different source states. Both now use the same merged snapshot set.
- Retrieval time could be labelled as data time. The kiosk now distinguishes
  the two; gazette headers no longer show a date-derived midnight; the closures
  parser no longer invents a dataset update timestamp from its retrieval clock.

Fable re-measured the previously failing printed text at 21:1 and verified
provenance opening/restoration during actual print-to-PDF. The focused
closure review ran 72 tests, all passing. Browser regressions cover the
printed kicker, 112 without background fill, and the full app's expiry path.

The final kiosk refinement (`9c3c054`, authored as `562f9f1`) keeps whole
primary titles, counts complete rows when space runs out, removes duplicated
six-source credit walls and per-act UUIDs, and retains publisher/licence
credits with full attribution available. The author's 1366/1920 light/dark
captures include every domain, selections, invitation and basics, with
no clipped primary rows and 44px or larger strip controls.
