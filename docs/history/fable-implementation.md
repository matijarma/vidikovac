# Fable implementation instructions

Read PRODUCT.md, design.md, implementation-kaj-ima.md and the role below. This is implementation, not another plan. The owner approved the full plan, no compromise with quality, and specifically chose Fable as principal implementer/reviewer of the hardest work.

## Reliable file editing on Windows

Previous attempts did not land source edits because the shell/batch patch path was unreliable. Use this verified bridge, which invokes the real `apply_patch` binary directly:

```sh
node D:/scratch/vidikovac/scripts/apply-patch.mjs <<'PATCH'
*** Begin Patch
*** Add File: path/relative/to/your/worktree.ts
+// code
*** End Patch
PATCH
```

Run in YOUR worktree. The bridge reads UTF-8 stdin and passes an actual multi-line argument without cmd.exe interpretation. It is not a substitute file writer. Existing files use `*** Update File`, not Add. Avoid delete+add same path in one envelope. Large changes can be applied in multiple patches; validate git diff immediately after the first real edit. Do not spend an entire run diagnosing shell quoting or generating unapplied code. No Edit/Write tool or cat/python file writes.

Use Read for UTF-8 file contents, rg/Glob for discovery, Bash for verified patch calls/tests. Don't read secrets, .dev.vars, .claude configuration or .superpowers. Credentials are not needed for this work. No deployment, pushing, npm install, destructive git or cleanup outside your owned files. node_modules is a junction to main's installed dependencies.

Use git add with explicit owned paths, commit implemented milestones locally on your assigned branch, and report commits/tests/browser evidence. Do not stop after an outline. Inspect the actual browser UI at intended viewports and fix material problems. The integration agent will run the complete app, cross-review, and deploy through git once verified.

## Core contracts already implemented

- `core/contracts.ts`: ExperienceActions inherited by LayerContext; `view`, `screen`, `errors`, `navigate`, `setFilter`, `onRetry`, `onItemCopy`, `onItemShare`, `onItemExport`. MAP_CONFIG contains same-origin tiles/glyphs/sprites.
- `core/feed-store.ts`: snapshots/loading/errors/subscriptions. Keeps last-good data marked stale through request failures; pause prevents late-response repaint.
- `core/view-store.ts`: existing LayerId, public selection, per-layer filters, fragment/history compatibility. Filter text remains local.
- `core/screens.ts`: `createTemporaryScreen({area,stopId,operatorLabel?})`, returns real credentials plus screen metadata. `loadStops()` returns ScreenStop[].
- `worker/public-selection.ts`: `publicItemKey(module,id)` returns 16-hex key; selection `{kind:'route'|'stop',id}` or `{kind:'item',id,module}`; `selectionParams` and `parseSelection`. No arbitrary query or coordinate relay.
- `api.fetchTeaser(fetch?,stopId?)`: stop-scoped real public teaser. `api.fetchData(module,token)`: real session data.
- BeaconCredentials has optional `screen`; BeaconClientDeps has `onContext?(screen)`; SessionSnapshot includes optional `screen`. Actual screen metadata has kind, expiresAt, stop. Ten-minute screen and five-minute one-hop grants unchanged, same Wi-Fi allowed.
- FeedItem.dateBasis: event/published/updated/observed/unknown. ModuleSnapshot.sources has independent statuses. Kvartovske notices are undated, not today. `canExportCalendarItem`, `icsForItem`, `itemExportSummary`, `itemExportText` available in export.ts.
- Working backend on `http://127.0.0.1:8787`: API, actual pairing, self-service, maps. Map tile `/maps/zagreb-v1/13/4459/2920.mvt` verified. Self-hosted glyphs/sprites and stops also there.
- MapLibre6.4.1, pmtiles4.5.0, @protomaps/basemaps and jsQR installed. No other dependency needed.

## Fable UI workstream

Worktree `kaj-ui`, branch kaj-ui. OWN: app/src/dashboard.ts, entries/dashboard.ts, app/d/index.html, layers EXCEPT u-pokretu.ts/types.ts, UI styles EXCEPT map.css/kiosk.css, UI helpers EXCEPT theme.ts/lagano.ts/qrScanner.ts, i18n, landing HTML/entry, scan HTML/scan.ts/scan.css, static page presentation, new experience/*, corresponding unit tests. Do not edit core, map/transport, kiosk, Worker, exports, package/config.

Build the complete premium visual system and app: active workspace desktop/sidebar, mobile Sada/Promet/Događanja/Još, safety shortcut, compact session and usable share/freeze/resume/error actions. Hook real core state. Preserve keyboard focus, inputs, scroll, map DOM and camera across polls (stable nodes and delegated interactions).

Every domain is designed for its content. Overview has genuinely useful cross-domain composition, no hero fleet count or clock. Weather uses actual condition/daily range/observation/wind/humidity/computed sun, not fake hourly series. Events use real dates/category/agenda/detail, unknown notices separate. Civic uses phases/listed amounts/assembly and searchable gazette metadata, not fake spend/progress. News has actual dates/source hierarchy/available summaries. Safety prioritises action and treats unknown as unknown. No repeated equal-card template, no skyline/meander/mono-gallery-caption. One Manrope font, considered light/dark, OKLCH with sRGB fallback, readable sizes and targets.

No preview route, fake session, or new feeds. Native imagegen unavailable; use real browser screenshots. Vite port5174 for own UI. Backend can be proxied in an ignored test harness, not by changing shared config.

## Fable map workstream

Worktree `kaj-map`, branch kaj-map. OWN: map/*, new transport/*, layers/u-pokretu.ts, ui/map.css, matching motion/map tests. Do not edit motion-model constants, other layers, dashboard/kiosk, token styles, core, package or Worker.

Replace schematic-plus-raster duplication with one superb map/transport workspace. Same-origin Protomaps v4 vector style, light/dark, named streets/stops/parks/water. Existing model provides smooth vehicle estimates, never call them ETA. Numbered vehicles/routes, declutter, tram/bus selection, route/stop search, vehicle follow, closures and notices, keyboard equivalent. Desktop map with coordinated detail/search, phone map with useful peek and readable expanded details. One persistent controller/MapLibre context, no poll resetting camera/state. Plain route/stop fallback when WebGL fails; tile failure preserves independent network geometry. Lightweight mode never loads geometry/MapLibre/fonts/canvas.

Preserve existing public helpers and createCityMap/map-slots contracts additively. Expose optional center/zoom/selected route/stop/follow for kiosk use. MAP_CONFIG tiles use source-layer schema from Protomaps v4. `@protomaps/basemaps` generates matching style with lang hr; self-hosted fonts include Noto Sans Regular/Medium/Italic. Local map assets ready at main backend. Prior ignored `test-results/patches` may contain useful Fable draft code but nothing was applied; recover only what is good. Vite5175 for browser.

## Fable kiosk workstream

Worktree `kaj-kiosk`, branch kaj-kiosk. OWN: kiosk.ts, entries/kiosk.ts, ui/kiosk.css, app/kiosk/index.html, new kiosk/*, kiosk tests. No other app files, Worker, package/config. Use local hr/en string helper if needed; common appName will be Kaj ima? after UI integration.

Build full kiosk composition and two-step real self-service setup. No empty QR card with a not-provisioned alert. Choose district/stop(default106_1), createTemporaryScreen, persist ordinary credentials and boot actual beacon. Handle Access403,quota429,network failure,revoked/expired/restart. No automatic recreation loop or auto-grant for host. Secret never rendered/logged.

Unpaired kiosk: ~60% useful local map; fixed-position invitation and rotating QR (at least240px) with readable code, local weather/service and bounded secondary story; safety strip always. Explicit1920x1080 and1366x768 layouts, not proportional shrinking. No skyline/meander/gallery captions. Main text40/28 and supporting28/22. No primary content ellipsis or unreadable license wall. No touch needed. Basics remains sessionless with90sidle only outside active grants.

Paired: mirror domain and public selected route/stop/item with a deliberately glanceable composition, not a long mobile page cropped into a kiosk. Existing newest-scanner drive behaviour preserved. Session expiry returns kiosk to invitation, no memory/socket leaks. Keep useful injected test seams.

Use createCityMap/map-slots; map workstream adds optional center/zoom/selection support. Do not draw two maps. Low-resource mode has useful local route data without canvas/geometry/font/MapLibre. Vite5176 for browser.

## Shared quality and handoff

Owner's style: premium city companion with craft comparable to Flighty/Apple Weather/Transit, not a copy. Mineral light#f6f8f7, ink#182423, peacock#08777b; deep-neutral dark#17201f, ink#eff6f3, action#63d7c3. Roles can be refined after actual contrast and browser checks. No mandatory decorative motif. Body16,controls14,metadata12 minimum,targets44/48. English and Croatian, keyboard,reduced motion,200%zoom,light/dark,states. Canvas/SVG visuals encode actual data only.

The product is for the City financing application, inside evaluation Access. No independent launch, no newsletter controversy, no independence disclaimers. Technical Vidikovac names and storage keys remain.

Finish with actual commits, exact tests, screenshots and remaining integration hooks. Distinguish tested facts from suggestions. Source/data correctness and premium visual craft are both required.
