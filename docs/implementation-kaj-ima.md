# Kaj ima? implementation contract

Owner-approved full overhaul, implemented jointly by Codex and Claude Fable.

## Ownership

- Codex: `app/src/core/*`, Worker/protocol/security/provisioning, feed correctness, app dependencies/config, map hosting, exports, integration and end-to-end verification.
- Fable UI: dashboard/session presentation, app entry integration, all layers except transport, shared UI CSS/tokens/graphics, landing/scan/static presentation and locale copy.
- Fable map: `app/src/map/*`, new `app/src/transport/*`, `app/src/layers/u-pokretu.ts`, map CSS and map tests. Do not change motion-model constants without review.
- Fable kiosk: kiosk presentation after shared visuals land; preserve real BeaconClient and SessionClient.
- No pushes from contributor worktrees. No overlapping writes. Commit each bounded slice locally, with a short evidence report. Codex integrates; Fable reviews Codex's security/data changes.

## Shared UI contracts

`app/src/core/contracts.ts` defines the additive screen and view contracts. `LayerContext` gains optional `view`, `navigate`, `setFilter`, `onRetry`, `errors`, `screen` and item export actions. Existing fields remain compatible.

- Data: existing ModuleSnapshot shape with optional subsource availability/coverage; `createFeedStore` keeps good snapshots through request failures. Real item dates remain separate from fetchedAt.
- Selection: existing LayerId and bounded route/stop/item selection. `publicItemKey(module,id)` is a stable public identity, not a credential. `createViewStore` owns history state and selection. Existing session fragments remain compatible.
- Screen: reactive locale/theme/preferences/lightweight/reduced-motion/stop/session. No React hooks or new framework.
- Map: `MAP_CONFIG` owns version, tile/glyph/sprite URLs and bounds. Same-origin R2-backed vector tile path. One map per active workspace, persistent across poll updates.
- UI reconciliation: event delegation on stable roots; keyed child updates. Preserve controlled input/scroll/focus and `data-persist` map containers. Do not attach new closure handlers to nodes that reconciliation discards.

## Behaviour

Seven LayerIds remain stable, user labels become Sada, Promet, Vrijeme, Sigurnost, Grad, Događanja, Vijesti. Phone Sada/Promet/Događanja/Još; desktop sidebar. No new decorative panorama or meander.

Real screen creation: `POST /api/screens`, Access-verified evaluator, five creations per principal/hour, thirty globally/hour, 24h screen TTL, default Donji grad / stop 106_1. Returns ordinary credentials and context. Setup never bypasses session tokens. Same-Wi-Fi redemption succeeds. APP_ENV=test is the only admin test-bypass gate, missing env means production. All session signing secrets explicit.

Selection relay allows only layer/module/public item key/routeId/stopId. No search strings, coordinates, arbitrary URLs or private location. Screen stop metadata reaches phone and kiosk. New screen expiry prevents grants but leaves existing sessions to complete. Temporary evaluation metrics remain separate from venue metrics.

Current feeds only: ZET realtime and route geometry; closures; observation/forecast/warnings; EMSC; HRT/Sljeme; gazette; spatial sources; six-source events. No stop ETA. Fix synthetic Kvartovske dates; separate undated notices. Missing source is never zero/all-clear. Preserve licence boundaries.

## Verification and handoff

Baseline: 116 test files / 1299 tests; clean typecheck. Add real selfservice/pairing/all-domain/expiry journeys, state fixtures and screenshot checks. 390/768/1440 app, 1920/1366 kiosk, light/dark/reduced-motion/noWebGL/no-JS/200% zoom. Check runtime errors and state preservation, not only axe.

MapLibre 6.4.1 (security fix), Protomaps v4 PMTiles bounded region [15.70,45.50,16.30,46.02], z0–14, private R2 + existing Worker, immutable versioned tile route, self-hosted glyphs/sprites. Preserve `?lagano=1` <=200kB initial assets; full initial JS <=600kB compressed target and tiles <=1.5MB.

Application documents and README reflect Kaj ima?, actual capabilities and revised network rule. Prototype remains Council-facing behind Access. Deployment is git push -> existing Cloudflare build, never wrangler deploy.

## Progress

- [x] Owner approved product direction, name, scope, selfservice screens, R2 and Fable implementation.
- [x] Baseline inspected and approved brief recorded.
- [x] Shared contracts and isolated worktrees.
- [x] Security, screen creation, source truth.
- [ ] Fable visual foundation, map, domains and kiosk.
- [ ] Cross-review and browser refinement.
- [ ] Tests, application materials and protected deployment.

## Implementation evidence

Baseline commits: b035057 (approved brief and contracts), 8ae414f (real screens,
same-Wi-Fi, R2 and QR fallback), 3983482 (source correctness). The R2 regional
archive and self-hosted glyphs/sprites have been checked through the local Worker.
No implementation commits have been pushed to the evaluation deployment yet.

Fable's first independent security review found seven concrete issues: evaluation
failure provenance, post-cleanup DO schema, rolling-hour quotas, release of failed
creation reservations, feed resume after a stuck request, stale archive range
headers and noncanonical tile coordinates. Codex implemented corrections and
added regression tests; the final full-suite and cross-review remain required.

The Windows Bash transport truncates very long command strings. Fable edits use
the native apply_patch stdin bridge in scripts/apply-patch.mjs, with command-sized
chunks. This is a tooling constraint, not a reduction in code or design scope.

## Resume checkpoint

Codex-side changes are implemented: real temporary screens and same-Wi-Fi pairing,
explicit secret requirements, Access validation, source date/availability fixes,
R2-backed vector tiles, QR fallback, independent source recovery, partial-teaser
coverage, no-JS safety design and application-copy updates. Latest full baseline
before the final source-recovery tests: 119 files / 1483 passing tests. The added
source recovery and screen cleanup/reservation tests pass in targeted runs.

Frontend implementation is NOT finished or integrated. Fable's preserved changes:

- `kaj-ui`: tokens, baseline, fonts, icons and partially completed HR/EN catalogues
  (`@@chunk3` marker). Dashboard, domain renderers, landing and scan still need work.
- `kaj-map`: basemap styling, badge geometry, extended map contracts, route/stop
  catalogues/search and tests. The replacement city-map implementation and
  transport workspace remain incomplete.
- `kaj-kiosk`: strings, screen setup, credentials, layout, map adapter, local data,
  invitation and paired-view helpers. Paired view/CSS have continuation markers;
  the main kiosk controller and entry integration remain incomplete.

An earlier interruption was caused by Fable usage credits. The owner restored
access and a real Fable call returned READY. All three full implementation
workstreams have resumed at maximum effort from their saved code, without
reducing scope or quality. Do not treat unfinished work as reviewed or deploy it.
Current implementation logs are the ignored `fable-*-continue.jsonl` files under
`.superpowers/kaj/`; preserve them for continuity.
The original Fable security review is complete; a final review after corrections
and the rendered frontend cross-review are still required.
