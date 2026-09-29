# October 2026 upgrade pass: execution files

*Executed. Moved here from `docs/upgrade-2026-10-plan/` by U4 as the record of the round; the brief stays at `docs/upgrade-2026-10.md`.*

These five files are the execution plan referenced by `docs/upgrade-2026-10.md` §4 (the packages) and §5 (lanes, seams, rules, the execution model). The brief is the master; each file here is one package with its own agent briefs, and the whole pass runs as nine briefs in parallel from one base commit, one integration, one gate, three pushes.

| File | Package | Briefs | Deploy |
|---|---|---|---|
| `U0.md` | Trust fixes: future stamps and header monotonicity, the count from positions, parked and depot vehicles, rolling closure ends, the unconfirmed feed on the screen, the wall list fitter, the artefact check | U0-twin, U0-client | DU1 |
| `U1.md` | The operator's voice: no-service alerts on the boards, ZET's notices as one row and one sentence | U1 | DU2 |
| `U2.md` | The expectation layer, first cut: the declared fleet expectation, the service state on the twin, the voice by state on every surface, the strike replays | U2-twin, U2-surfaces | DU2 |
| `U3.md` | Facts breadth: the City's culture calendar, the libraries' programme, DHMZ's hourly rain, HAK and the utilities' planned cuts, an OpenStreetMap opening-hours extract, rail on the phone and the wall, three joins, the thin-spot instrument | U3-modules, U3-osm, U3-surfaces | DU3 |
| `U4.md` | Harness, hygiene and closing: two observer rows, the small correctness items, the backlog picks, one documents pass, the README, the proposal page's note, this folder to history | U4 | DU3 |

How each file was built: one writer (Claude Opus) turned the design appendix of the planning record into the package against the tree at the base commit named in each header, verified every path and line anchor by grep, applied the decisions of the preparation phase (the analyses over the recorded days, the fixtures cut from them, the source probes) and wrote **§0 Reconciliation** as the binding text: the seams shared with the other packages, the decisions applied, what is not built in this round, and the merge order for the files several briefs touch. Precedence inside a file: §0, then the steps and the agent briefs. Line numbers are as of the base commit; re-anchor with `grep` before editing.

Rules that hold in every file: no `wrangler deploy` (deploy only by `git push` to `main` → Cloudflare Builds); no production screen outside the documented `/kiosk/` flow, one per verification day, never by an agent; `docs/prijava` and `app/prijava` untouched beyond the dated note; the presence gate, no accounts, tracking, push or route planning, no invented arrival estimates beyond the labelled ZET estimate; Croatian standard and natural, gender-neutral for things, never "zid", never a cause word; no caveat word inside a list row. Evidence behind every number: the repository owner's working folder for this round (`review.local/upgrade/`, not published).
