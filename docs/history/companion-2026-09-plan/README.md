# Companion round, September 2026 — execution files

*Executed. Moved here from `docs/companion-2026-09-22-plan/` by WP7 as the record of the round; the brief stays at `docs/companion-2026-09-22.md`.*

These eight files are the execution plan referenced by `docs/companion-2026-09-22.md` §15 (sequence, lanes, gates, shared seams, probe contract, rules) and §16 (verification). The brief is the master; each file here is one work package.

| File | Package | Lane | Deploy |
|---|---|---|---|
| `WP0.md` | Trust: tram path stability, silent vehicles, whole-line pills, four small defects | T | D1 |
| `WP1.md` | Wall composition: header sentence, "U blizini" timeline, QR card, footer, night, outage | W-C | D2 |
| `WP2.md` | Wall map: frame N stops around the place, curated markers, full-number pills, legend | W-B | D2 |
| `WP3.md` | Setup and settings: one "Adresa ili stajalište" field, derived place, click-toggles behind a long press | W-A (step 0 in lane S) | D2 |
| `WP4.md` | Phone and desktop: Sada feed, Karta as the timeline's map, three tabs, folded Događanja, end of session | P | D3 |
| `WP5.md` | Copy catalogue, vocabulary, dead paths, docs | C | D4 |
| `WP6.md` | Verification harness: research instruments as acceptance tests | V (probes + guard in lane S) | D4 |
| `WP7.md` | Closing pass after the final push and deployment: README to the new reality, an optional development-notes layer on `/prijava/`, repository hygiene | closing | D5 |

How each file is built: a planner wrote the package against the working tree at build `b300af3` (22 Sep 2026); an adversarial verifier checked every path, line pointer, owner decision and acceptance command against the tree and wrote problems and corrections; a consistency critic compared the seven and fixed names, owners and order. Each file therefore has, in reading order: **§0 Reconciliation (binding)** → goal, dependencies, protocol changes, superseded contracts, file-level steps, parallel lanes, tests to update, executable acceptance, risks, agent briefs → **Verifier verdict** (problems and corrections). Precedence: §0, then the verdict, then the planner text. Line numbers are as of `b300af3`; re-anchor with `grep` before editing.

Rules that hold in every file: no `wrangler deploy` (deploy only by `git push` to `main` → Cloudflare Builds); no production screen outside the documented `/kiosk/` flow and never more than one per verification day; `docs/prijava` and `app/prijava` untouched; presence gate, no accounts/tracking/push/route planning, no invented arrival estimates beyond the labelled ZET estimate. This folder is a working plan: once executed it moves to `docs/history/` (WP7). Evidence behind every number: `review.local/companion/` (ledger, walkthroughs, replay baselines, planner notes under `plan/WP*/notes.md`).
