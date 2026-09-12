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
- [ ] Shared contracts and isolated worktrees.
- [ ] Security, screen creation, source truth.
- [ ] Fable visual foundation, map, domains and kiosk.
- [ ] Cross-review and browser refinement.
- [ ] Tests, application materials and protected deployment.
