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
- [x] Fable visual foundation, map, domains and kiosk integrated.
- [x] Cross-review and browser refinement.
- [x] Tests, application-copy updates and protected deployment.

## Implementation evidence

Baseline commits: b035057 (approved brief and contracts), 8ae414f (real screens,
same-Wi-Fi, R2 and QR fallback), 3983482 (source correctness). The R2 regional
archive and self-hosted glyphs/sprites have been checked through the local Worker.
The integrated implementation was pushed as `33cd11a` and deployed by the
GitHub-connected Cloudflare Build on 13 September 2026. A real protected
screen-creation/pairing/all-domain browser smoke passed on the deployed app;
the repo remains private and anonymous requests remain Access-gated.

Fable's first independent security review found seven concrete issues: evaluation
failure provenance, post-cleanup DO schema, rolling-hour quotas, release of failed
creation reservations, feed resume after a stuck request, stale archive range
headers and noncanonical tile coordinates. Codex implemented corrections and
added regression tests; the final full-suite and cross-review remain required.

The Windows Bash transport truncates very long command strings. Fable edits use
the native apply_patch stdin bridge in scripts/apply-patch.mjs, with command-sized
chunks. This is a tooling constraint, not a reduction in code or design scope.

## Integrated delivery

Codex-side changes are implemented: real temporary screens and same-Wi-Fi pairing,
explicit secret requirements, Access validation, source date/availability fixes,
R2-backed vector tiles, QR fallback, independent source recovery, partial-teaser
coverage, no-JS safety design and application-copy updates. Latest full baseline
before the final source-recovery tests: 119 files / 1483 passing tests. The added
source recovery and screen cleanup/reservation tests pass in targeted runs.

As of 13 September 2026, the UI, vector transport workspace and kiosk are
integrated on main. Relevant milestones include `21b4bfa` (UI), `7fbfe6f`
(transport), `d8a3141` (kiosk), `ad08784` (cross-review corrections),
`89a6d3b` (expanded map, persistent workspace, opaque markers) and `cdb4309`
(paired-domain content). Historical incomplete-worktree notes above no longer
describe the app.

The integrated suite reached 135 files / 1,624 passing tests after the final
review corrections. Real browser journeys cover self-service setup, same-Wi-Fi
pairing, one-hop five-minute sharing, twelve-second test expiry, kiosk geometry,
motion, reduced motion, map expansion and outage hold. No-WebGL transport and
no-JavaScript safety also pass their browser checks.

The first 49-surface review found three repeated root issues: filter-list
semantics, light-theme safety-link contrast, and Safety/News overflow at 200%
text size. Those are fixed; the expanded 56-surface matrix passes. Kiosk
request-failure, temporal-state and whole-title refinements are integrated.
Fable independently rechecked print contrast, source timestamp wording and
consistent kiosk source states. All 52 browser tests pass. Evidence is in the
ignored `review.local/` directory; `scripts/review-experience.mjs` reproduces
the cross-viewport sweep. See `docs/kaj-verification.md` for the dated record.

Do not interpret passing unit tests as final visual acceptance or as physical
iPhone/Android/QR-distance testing. Fable remains the main frontend implementer
and independent reviewer, using maximum effort. Account selection follows
the owner's current instructions and is not part of the application configuration.

Delivery is verified in `docs/kaj-verification.md`, including the Cloudflare
version and the real protected smoke. Company/personal application fields,
the video link, physical device checks and the actual funding submission are
not represented as completed by this implementation.
