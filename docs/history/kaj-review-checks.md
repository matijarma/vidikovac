# Kaj ima? integration review checks

These are acceptance checks, not findings against an unfinished worktree.

## State and input

- Keep the same focused input/selection and scroll position across a poll, in a
  real browser, not only happy-dom. Reordering an existing node with insertBefore
  can drop browser focus even if the node is still connected.
- Do not temporarily move a live map into a detached render tree on every poll.
  Camera, selected item, follow state, WebGL context and keyboard focus survive.
- New callbacks must read the current item/snapshot, not a closure left over from
  the first render. Copy/export after an update uses the updated content.
- A whole-request failure marks formerly live subsources stale too. Pause/resume
  is not held hostage by an older pending request.
- Every 401/403/no-ticket/reconnect state has a working route to recovery.

## Maps and kiosk

- Map and kiosk adapters agree on center, stop, selection and follow contracts.
  A route id is not a vehicle id. Unknown selection falls back to the domain.
- New source outage pauses vehicle presentation; an empty update must not let
  the motion model continue as if the feed were confirmed live.
- Route-level median delay is not a vehicle-specific delay or an ETA. A trip
  update count is not necessarily the current number of GPS-tracked vehicles.
- Declutter a dense real network, not just three separated test marks.
- A no-map domain must not destroy/recreate the map unnecessarily on each poll.
- The paired kiosk remains readable without scrolling. Primary content must not
  silently disappear into overflow:hidden. Different domains have useful,
  bounded compositions, not one generic text stack.
- Kiosk expiry/idle clocks do not end an active grant early. Explicit setup
  restart never loops through automatic creation or quota consumption.

## Data and exports

- Event dates, publication dates and last-change dates remain distinct.
  Undated neighbourhood notices are never a dated agenda item.
- Source coverage applies to the displayed subset. Successful empty sources and
  unavailable sources remain distinguishable after teaser filtering.
- Full legal text, hourly weather values, progress percentages, spending totals,
  nearest pharmacies and missing place coordinates are never invented. Arrival
  estimates are labelled and never invented: a countdown only where a tracked
  vehicle carries that trip, a scheduled clock time otherwise, and the list
  says which is which.
- Item export/copy/share retains attribution and the item timestamp. Calendar
  actions use the actual eligibility helper; no dead enabled button.
- A source outage is not an all-clear. Open safety and session safety agree.

## Design and delivery

- No panorama, meander, gallery labels or replacement decorative banner.
- Readable source metadata; no footer walls obscuring the useful content.
- First phone viewport shows useful content from at least two domains.
- Desktop opens one active workspace, not seven endless columns.
- Light/dark, Croatian/English, 390/768/1440, kiosk 1366/1920, keyboard, reduced
  motion, no-WebGL, no-JS safety and 200% zoom are actually inspected.
- Fable and Codex both review rendered output. Green tests alone are not a
  statement that the design is good.
- Repo remains private; source/public-launch claims in submission text must
  match that fact. Evaluation deployment retains Access. Do not push incomplete
  worktree code.
