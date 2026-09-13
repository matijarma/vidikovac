# Map independent review

Main's `review.local/map-stress.mjs` mounts the actual map/workspace with 332
parser-fixture vehicles dated to the test clock. At ready plus 1.2 seconds:

- Desktop: 49 numbered symbols, 88 visible vehicle dots, 363 route segments.
- Phone: 19 numbered symbols, 33 vehicle dots, 93 route segments.
- No console errors or horizontal overflow.
- Search text survives reparenting but focus is lost unless the page captures
  focus before `renderLayer`. The UI workstream has that integration finding.

Screenshots: `review.local/map-dense-desktop.png`, `review.local/map-dense-phone.png`
in the main repository. These are stable, outside Playwright's cleared output.

## Required visual refinement

The numbered pills are translucent enough that street/route lines show through
their numerals. This recreates the washed-out legibility problem. Keep the pill
fill and route number opaque with verified contrast; describe model confidence
in the detail/status, or use a secondary mark. Confidence must not fade the
primary route number below readable contrast. The text should remain legible
after one fresh observation, not only after a long established history.

The full transport view must be checked after integration into the new shell.
The old .dash map-mode CSS can collapse the map because it expects the previous
panel hierarchy; a standalone map test is not evidence that expansion in the
new app works.

Kiosk adapter: setView's routeId vs vehicle follow semantics must stay distinct.
Selected public items must resolve to live snapshot data, and stale data must
hold movement without freezing unrelated navigation.
