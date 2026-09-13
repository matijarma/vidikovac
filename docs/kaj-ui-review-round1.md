# Codex independent browser review, round 1

Fable UI must resolve these in its author worktree before approval. These are
observed in the actual browser, not taste inferred from source.

Screenshots to Read:

- `D:/scratch/vidikovac/test-results/kaj-ui-mobile-independent.png`
- `D:/scratch/vidikovac/test-results/kaj-ui-desktop-independent.png`

## P1: current overview falls short of the approved visual brief

Mobile: a large rounded weather card occupies roughly half the usable viewport,
then another large safety card. It is still a stack of soft text cards. The map,
transport interaction and agenda remain offscreen. Reduce repeated title/kicker,
move the long forecast prose into the weather domain, use a compact graphical
weather composition beside/above a genuinely useful transport action. Keep real
information and readable type; do not solve this by shrinking text.

Desktop: the six-domain overview is effectively a bento/card grid with tall
empty gaps and stretched rows. In the screenshot "Vijesti" has a kicker at the
top and a heading a large distance below; transport and events spread into long
columns. Remove space-between/stretch behaviour that distributes unrelated
content across an arbitrary full height. Use a composed hierarchy with distinct
shapes and compact supporting areas, not identical rounded boxes everywhere.

This is the user's central requirement, not a minor polish note. The design must
feel premium and purposeful, with density appropriate to useful city data.

## P1: stale warning becomes all-clear

The new real-browser experience regression fails: a stale CAP snapshot containing
an expired warning is filtered to no active warnings and safetyState claims calm.
`unconfirmed` must require a live successful confirmation for an all-clear,
regardless of whether stale raw items are present. Retain last-good content
visibly stale without treating it as a fresh confirmation.

`e2e/experience.spec.ts` in main has an explicit test for this.

## P1: misleading "Sljedeća događanja"

The overview starts with a November 2025 exhibition, then July events, including
known venues in Split and Hvar. If still ongoing, label "U tijeku" with the end
date and do not put its original start time under "Sljedeća". Upcoming events
should be the next future starts; ongoing exhibitions belong in a separate
bounded treatment. Known non-Zagreb venues must not be presented as Zagreb
events. Do not invent a venue for unknown data.

## P2: source freshness and source-footer density

Observation "Živo 12:00" at 14:00 and a gazette "Živo 00:00" communicate the
wrong concept. The server's successful fetch status is not a real-time source
timestamp. Use actual observation/publication/date and explicit stale/unavailable
state. The overview footer enumerating nine lengthy dataset names is a licence
wall. Use a concise source link/expandable provenance with required credits
available, not a paragraph competing with the useful interface.

## Integration checks

- Your weather domain reads dhmz-now but its LAYER_MODULES list currently omits
  it; direct/resumed entry into weather must fetch its own observation.
- Transport notices require dogadanja in the Promet fetch list.
- entries/dashboard.ts strips the whole fragment to room before mounting. Keep
  layer/public selection and remove ONLY spent ticket/label so links/resume work.
- Export metrics must use the existing `layer/kind` dimension; raw `copy`/`ics`
  is rejected by RoomDO. Preserve no-person-identifiers.
- Test browser Back through item detail; no duplicate state entries per poll.
- Sources/subsets remain correct; no fake arrival time, hourly weather, progress
  percentage, spend total or location.
