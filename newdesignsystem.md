# Kaj ima? — the "Dan grada" system
Design system & implementation guide · v1 · 14. 9. 2026

One time axis, one tile, one blue. What to change in `app/src/ui/*.css`, `app/src/layers/*` and `app/src/kiosk/*` to turn the current /d/ and /kiosk/ into the "iteracija 4a" design (palette) with layout from "iteracija 3" (time band + Zagreb blue + glyphs).

| | |
|---|---|
| **Keeps** | Stack, hostnames, keys, Manrope, Lucide, `--tone-*` role layer, session mechanics, no-JS /hitno, `?lagano=1`, all data contracts. |
| **Changes** | Palette values (layer 1), the Sada composition (time band replaces three column stacks), a tile component, glyph-for-word rules, status line, kvart panel, kiosk scenes. |
| **Needs new data** | Bikes, parking, waste pickup, works-by-kvart, saved stops, notifications. Shipped behind feature flags; the band renders without them. |

## 1. Principles

1. **Time is the only axis.** Sada is *sada · poslijepodne · večeras · sutra · tjedan*. Every domain writes into that axis. No column per domain, no "six feeds".
2. **The kvart is home.** The screen's stop (or the user's chosen gradska četvrt) scopes what is shown: lines from this stop, works in this kvart, waste for this kvart, events reachable from here.
3. **A tile, never a sentence.** Content is label · value · context. One number or one word per tile. Sentences survive only in detail views and in /hitno.
4. **Sign before word.** Time of day, walking, vehicle counts and line membership are glyphs or line badges. Words are reserved for state (*na vrijeme · rani 3 min · kasni 4 min · nema podataka*) and for names.
5. **Weather is status.** Temperature, condition glyph and sunset sit beside the clock in the status line, at 14 px. The full Vrijeme workspace still exists; it is not on Sada.
6. **Blue is material, not accent.** Ink is ultramarine, canvas is paper, Zagreb blue is reserved for line badges and primary actions. No grey exists in the palette.
7. **Honest data, unchanged.** Missing is not zero; fetch time is not observation time; ZET delay is per line, never an arrival. Every tile inherits the existing loading / stale / down states.

## 2. Colour — layer 1 values for `tokens.css`

Only `--palette-light-*` and `--palette-dark-*` change. The `--color-*` assignment and `--tone-*` role layer stay as written; components keep consuming roles. Replace the hex block and regenerate the OKLCH twins in the `@supports` block (values below are sRGB; OKLCH from any converter, keep 2 decimals).

### 2.1 Light — "papir i ultramarin"

| Token | Value | Role | Contrast on canvas |
|---|---|---|---|
| `--palette-light-canvas` | #f4f2ec | page, tiles on canvas | — |
| `--palette-light-canvas-deep` | #ece9df | sunken wells | — |
| `--palette-light-surface-1` | #fbfaf6 | status line, rail, tile fill | — |
| `--palette-light-surface-2` | #ebe8df | session pill, chips, search | — |
| `--palette-light-surface-3` | #ddd9cc | tracks, skeleton | — |
| `--palette-light-text-primary` | #0c1250 | ink; also the ink panel fill (Skupština tile, kvart button) | 15.4 : 1 |
| `--palette-light-text-muted` | #4a5178 | context lines, 12 px | 6.85 : 1 (6.26 on surface-2) |
| `--palette-light-text-subtle` | #5a6187 | placeholders, chevrons | 5.4 : 1 |
| `--palette-light-label` | #363d73 | uppercase 12 px labels | 9.05 : 1 |
| `--palette-light-accent` | #03409c | Zagreb blue: tram badge, primary button, "?" in wordmark, ring. A deep royal blue (oklch 40% 0.16 260), the ZET-livery family; the first value, #1428d8, sat at the hyperlink hue and chroma and read as a link in bulk (15. 9. 2026) | 8.46 : 1 · white on it 9.47 |
| `--palette-light-accent-deep` | #00327e | hover, links on tint | 9.75 on surface-2 |
| `--palette-light-on-accent` | #ffffff | text on accent | 9.03 : 1 |
| `--palette-light-transit` | #0c1250 | bus / bike / parking capsule (= ink) | white on it 17.2 |
| `--palette-light-warning` | #8a5800 | komunalno (radovi, odvoz), "rani" | 5.40 : 1 |
| `--palette-light-danger` | #b3271e | hitno, "kasni" | 5.82 : 1 |
| `--palette-light-success` | #1e6f47 | mirno, "na vrijeme" | 5.49 : 1 |
| `--palette-light-events` | #6b3fa0 | događanja | 6.60 : 1 |
| `--palette-light-border` | rgba(12,18,80,.14) | hairlines, tile stroke | — |
| `--palette-light-border-strong` | rgba(12,18,80,.34) | ghost buttons | — |
| `--palette-light-glass` | rgba(251,250,246,.9) | map overlays | — |

### 2.2 Dark — "ultramarinska noć"

| Token | Value | Role | Contrast on canvas |
|---|---|---|---|
| `--palette-dark-canvas` | #0b1150 | page | — |
| `--palette-dark-canvas-deep` | #080c40 | — | — |
| `--palette-dark-surface-1` | #121a63 | status line, tab bar, tiles | — |
| `--palette-dark-surface-2` | #1a2373 | pills, chips | — |
| `--palette-dark-surface-3` | #26307f | tracks | — |
| `--palette-dark-text-primary` | #f4f2ec | paper ink | 15.5 : 1 |
| `--palette-dark-text-muted` | #b6bbe0 | context | 9.23 : 1 (7.29 on surface-2) |
| `--palette-dark-text-subtle` | #8f96c9 | — | 5.6 : 1 |
| `--palette-dark-label` | #b6bbe0 | labels | 9.23 : 1 |
| `--palette-dark-accent` | #f4f2ec | **paper badge**: tram badge fill, primary button, segmented "on", "?" in wordmark | 15.5 : 1 |
| `--palette-dark-accent-deep` | #ffffff | hover | — |
| `--palette-dark-on-accent` | #0b1150 | blue number on paper badge | 15.5 : 1 |
| `--palette-dark-transit` | #9fb4ff | bus / bike / parking capsule | on-accent text on it 9.6 |
| `--palette-dark-warning` | #f2c46f | komunalno | 10.7 : 1 |
| `--palette-dark-danger` | #ff9d9d | hitno | 8.73 : 1 |
| `--palette-dark-success` | #7fd6a8 | mirno | 9.99 : 1 |
| `--palette-dark-events` | #c9b3ff | događanja | 9.40 : 1 |
| `--palette-dark-border` | rgba(244,242,236,.14) | hairlines | — |

**Tints** (`--tint-*`) keep the existing `color-mix(in oklab, role 12–14%, surface-1)` rule; no literal changes. **QR plate** stays #ffffff / #182423 → change ink to #0c1250 (scanner-safe). **Solar kiosk theme** maps to these two palettes exactly as today (theme.ts unchanged). Update `test/app/contrast.test.ts` expectations; every pair above is ≥ 5.4 : 1, so the AA assertions stay green.

## 3. Type, space, shape

| Role | Spec | Token | Where |
|---|---|---|---|
| Clock "sada" | 40 px · 700 · −0.03em · tabular | `--type-numeral` | time band head, only once per screen |
| Column head | 24 px · 700 · −0.02em | `--type-title` → set to 1.5rem | "do 18:00", "uto 15. 9." |
| Tile value | 32 / 24 / 17 px · 700 · tabular · `white-space: nowrap` | new `--type-tile-xl/l/m` = 2rem / 1.5rem / 1.0625rem | numbers, state words, titles |
| Tile time | 20 px · 700 · tabular | `--type-tile-time` = 1.25rem | first line of time tiles |
| Label | 12 px · 700 · +0.04em · uppercase · role colour | `.kicker` (exists), colour from domain | tile first line |
| Context | 12 px · 500 · muted | `--type-meta` | tile last line; status line 14 px |
| Body | 15 px / 1.4 | `--type-body` = 0.9375rem | details, /hitno keeps 16 px |

- **Family:** Manrope 400/500/700 self-hosted, unchanged. If the city's Exat becomes available under licence, it replaces Manrope only in `--font-display` for the clock, column heads and kiosk display tier; everything else stays Manrope.
- **Radius:** tile 14 px (`--r-md` → 0.875rem), badge 5 px, capsule pill, panel 16 px, kiosk block 20 px.
- **Space:** tile padding 14 × 16; tile gap 10; column gap 20; band → content 12; page inset 24 (phone 16).
- **Depth:** tiles on canvas have a 1 px stroke and no shadow; floating things (map overlays, kvart panel on kiosk, FAB) use `--tone-shadow-md`. Nothing is translucent except map overlays (`--tone-glass-bg`).
- **Motion:** unchanged (140–220 ms, ease-out). Tile value change = 180 ms crossfade via the existing `data-replace` wrap. Kiosk scene change = out 180 / in 220, same as story rotation today.

## 4. Components

### 4.1 Status line `.ki-status` (replaces `.ki-head` content)

- Desktop 56 px, phone 2 rows (52 + 40) then the segmented time control; total ≤ 132 px. Grid: `wordmark · kvart · search(1fr, max 420) · clock+weather · session · bell · safety`.
- **Kvart selector** is an ink button (`--tone-text-primary` fill, canvas text). Menu lists the 17 gradske četvrti plus "Stanica zaslona". Persist in `view-store` under `kvart`; the screen's stop sets the default.
- **Clock + weather**: `zagrebTime(now)` · condition glyph (`weather-icon.ts`) · temperature · sunset glyph + `sunToday().sunset`. Source `dhmz-now`; when down, render the clock alone — never a dash. Whole group is a link to `#layer=zrak-i-nebo`.
- **Session**: existing `.ki-session` pill, 40 px, ring 28 px; urgency colours unchanged. **Bell**: notifications sheet (4.9). **Safety**: existing `.ki-safety`, icon-only at 40 px on both surfaces.
- Polling hairline stays on the status line's bottom edge.

### 4.2 Time band `.tb` (replaces `.ov` in `layers.css`)

```html
<section class="tb" data-cols="5">
  <header class="tb-heads">   <!-- 5 × .tb-head: kicker + h3 -->
  <div class="tb-axis">        <!-- 2px ink rule, dot per column, filled dot on "sada" -->
  <div class="tb-lanes">       <!-- 5 × .tb-lane, each a column of .tile -->
</section>
```

```css
.tb { display:grid; grid-template-rows:auto 24px minmax(0,1fr); }
.tb-heads, .tb-lanes { display:grid; grid-template-columns: 2.2fr 1fr 1fr 1fr 1fr; column-gap:20px; }
.tb-lane { display:grid; gap:10px; align-content:start; min-width:0; }
.tb-lane[data-col="sada"] { grid-template-columns:1fr 1fr; }
.tb-lane[data-col="sada"] > .tile-band, .tb-lane[data-col="sada"] > .tile-row { grid-column:1/-1; }

@container ws (max-width:60rem) {
  .tb-heads, .tb-lanes { grid-template-columns:2fr 1fr 1fr; }
  .tb [data-col="sutra"], .tb [data-col="tjedan"] { display:none; }
}
@container ws (max-width:36rem) {
  /* phone: one lane at a time, .tb-seg segmented control above,
     lanes are a scroll-snap row */
}
```

- **Bucketing** (new `experience/timeband.ts`): *sada* = live values with no start time; *poslijepodne* = start ≥ now and < 18:00 today; *večeras* = 18:00 – 04:00; *sutra* = next calendar day; *tjedan* = day+2 … day+6. After 18:00 the second column becomes *noćas* and the axis shifts left one bucket; before 12:00 "poslijepodne" reads *danas*. Column heads come from i18n (`timeband.*`).
- Sort inside a lane: by start time; in *sada* by domain order transit → mobility → komunalno → safety → news. Cap: 6 tiles per lane on desktop, 4 on phone, "+ N" row link into the domain.
- DOM order = visual order (WCAG 2.4.3): heads, then lanes in time order; the reconciler keys tiles by `module:id` as today.
- The axis is decorative (`aria-hidden`); each head is an `h3` so a reader hears the five time words.

### 4.3 Tile `.tile` (new in `signage.css`)

| Variant | Lines | Fill | Used for |
|---|---|---|---|
| `.tile` (value) | label · value (24–32 px) · context | surface-1 + stroke | line at saved stop, bikes, parking, gazette number |
| `.tile-time` | time (20 px) · label · title (17 px) · context | surface-1 + stroke; the next event in *večeras* takes the events tint | events, waste, works end, assembly, last tram |
| `.tile-band` | glyph · label + title · trailing value | domain tint (komunalno) or 1.5 px role stroke, no fill (safety calm) | works now, safety verdict, unknown-state notices |
| `.tile-row` | glyph · title · trailing source/time | surface-1 + stroke | one news lead |
| `.tile-ink` | as `.tile-time` | `--tone-text-primary` fill, canvas text, accent label | exactly one per screen: the Skupština session (civic authority) |

- Whole tile is the control (`<a>` or `<button data-action="nav">`), min 44 px, hover = surface-2, press = surface-3; `aria-label` = label + value + context joined by ", ".
- Value line is `white-space: nowrap`; the tile's min width is 168 px. Titles may wrap to 2 lines (`-webkit-line-clamp: 2`); context never wraps (ellipsis).
- Loading: three `.sk` bars in the three type roles (same skeleton approach as `grad-sada.ts`). Stale: the existing `.badge[data-tone=stale]` replaces the context line. Down: the tile is not rendered; the domain's state is said once in the lane foot (`stateBlock`).

### 4.4 Line badge `.line` (exists; two changes)

- Colours come through `--tone-action-brand` / `--tone-transit` already; the dark palette values above make the tram badge paper-on-night automatically. Verify `test/app/signage-css.test.ts` equality with `.route-no` still holds or retire `.route-no`.
- Add `.line[data-size='xs']`: 1rem tall, min 1.375rem, 0.625rem font, radius 3 px. Used wherever a line is *mentioned* (event context "Pogon · 6 13", works "11 17 redovno", last tram). `lineBadge(label, kind, 'xs')`.

### 4.5 Glyph vocabulary (sign before word)

| Meaning | Render | Never | Source |
|---|---|---|---|
| Sunset / sunrise | `sunset`/`sunrise` Lucide 16 px amber + time | "zalazak 19:11" | `solar.ts` |
| Walking | new `footprints` (Lucide) 14 px muted + "N min" | "N min pješice" | straight-line ÷ 1.2 m/s until a routing feed exists; label as estimate in the detail |
| Vehicles on line | `tram-front`/`bus-front` 14 px muted + count | "6 vozila" | `vehicleCount`, `u-pokretu.ts` |
| Reachable by line | `.line[data-size=xs]` badges after the venue | "tramvaj 6, 13" | stop.routes of the nearest stop to the venue |
| Domain | label colour + shape: tram rectangle · bus/mobility capsule · komunalno square · events circle · civic ink · hitno triangle · mirno check outline | colour alone | — |
| State | word in role colour: **na vrijeme** · **rani 3 min** · **kasni 4 min** · nema podataka | arrows, ± signs, arrival times | `delayWord`, `delayTone` |

Add `footprints`, `bike`, `car-front`, `trash-2`, `cast`, `bell`, `star` to `ICON_NAMES` in `icons.ts` (Lucide ISC). Every glyph keeps an `aria-label` or adjacent text; none carries meaning alone.

### 4.6 Kvart panel `.kv` (desktop aside, 300 px; phone = "Kvart" tab)

- Rows: label + "Karta →" · map thumbnail (the existing `map-slots` MapLibre instance, static camera on the kvart, pins = tile domains) · *Spremljeno* chips (line badge + destination; "+ stanica" dashed) · walking row · **Prebaci na zaslon** primary (48 px, accent) · *Obavijesti za kvart* toggle · one 12 px sentence about no-account storage.
- **Prebaci na zaslon** = the existing `view` message from driver to screen (`RoomDO`), surfaced as a button with the screen's label; disabled with tooltip when the session has no screen.
- Saved stops/lines live in `localStorage` key `kajima:saved:v1` (array of `{kind:'route'|'stop', id}`); never sent to the room. Chips open the transport detail (`data-selection`).

### 4.7 Phone

- Header (4.1) + segmented control `.tb-seg` (5 segments, 34 px, "on" = accent fill with on-accent text) replace the current tab-per-domain top. Lanes are a horizontal scroll-snap row; swiping and the segments stay in sync (`view-store.timeband.col`).
- Tab bar: **Sada · Promet · Kvart · Još**. "Kvart" replaces "Događanja" (events live on the band and under Još). Directory under Još lists Vrijeme, Sigurnost, Događanja and Grad with the same dir-item rows.
- Floating "Na zaslon" (48 px pill, accent, bottom-right, 16 px inset above the tab bar) only while a session has a screen. The lane's bottom padding is 80 px so no tile sits under it.
- Safety = icon-only 40 px in the header (rose tint) on every width; the word lives in the tooltip and aria-label.

### 4.8 Kiosk `kiosk.css`: fixed frame, one field, no rotation

- Frame (never changes): header 96 px (wordmark · kvart/stop chip in paper · date · 48 px clock · condition glyph + temp · sunset glyph + time); right column 520 px at wide, 440 px compact, holding the ranked statements the room holds whole above the **invitation card** -- the ranker offers three at wide and on the totem, two at compact; what shows is measured, never promised past the room, and the e2e pins floors: at least two at 1920 × 1080 (three when every value is one line), at least one at 1366 × 768 (two when the transit value is one line), three on the totem (R-KP22); safety strip 96 px (mirno/hitno word · sources · pharmacy · /hitno pill, no countdown).
- Field: edge to edge, no radius, no cards on it, the only overlay MapLibre's own attribution. It draws through the `prozor` basemap profile -- two landuse tones and hairline streets as ground texture that is never the figure, the tram network as the figure in wider ink/paper, trams as rounded plates and buses as capsules, the screen's stop a 9× symbol-scale ring carrying the biggest label on the map -- one fixed camera, north-up, no padding, 2.8 km across at wide/compact/portrait and 1.4 km on the handheld band; no rotation, no chip, no `?prizor=`.
- Statement `.k-say`: three type tiers with hairline separators, no fill, no border -- label 24/18 px (uppercase kicker, optional line badges), value 40/28 px (≤ 2 lines, never ellipsised), context 26/20 px (muted, may ellipsise). A changed value crossfades on insertion through `data-replace`/`data-sig`, off under reduced motion and lagano. Reduced motion on the field itself only stops the vehicle plates' own movement crossfade; the map and the statements keep refreshing.
- Invitation card (R-KP21): accent fill (dark theme: paper fill, night text), two rows -- the 240 px QR beside the lead (28/22 px, weight 800, wrapping freely) over the 26/20 px hint with the typed address, then the code and its 8 px progress bar across both. The QR row is at least the QR tall and grows if the side outgrows it: the card never clips. Code letter-spacing 0.04em; the code is capped to its column (`15cqi`). Values in a statement put a no-break space between a number and its unit and inside a phrase ("6 kasni 4 min"), so a two-line value breaks only at " · ".
- Compact (1366 × 768): same frame with the compact tokens; column 440 px; the same card. Portrait: field on top, at least half the stage height, then statements and the card as one row, then the strip; the totem's card keeps the lead across the card over the QR-hint row (its height is the statements' room beside it). A phone stands the card's pieces up in one column.

### 4.9 Notifications (bell)

Sheet (existing `dialog-sheet`): toggles for *kašnjenja > 5 min na spremljenim linijama*, *radovi u kvartu*, *odvoz sutra*, *upozorenja DHMZ-a*. Stored locally; delivery via Web Push with a per-browser subscription and no identity — an anonymous `subscriptions` KV keyed by the push endpoint hash. Until the worker route exists, the sheet shows toggles that only filter the band ("istakni"), labelled as such.

## 5. Screens → code map

| Design | Today | Change |
|---|---|---|
| Status line | `chrome.ts topBarMarkup / wordmarkMarkup / sessionMarkup / safetyMarkup`, `dashboard.css .ki-head/.ki-rail` | Merge into `statusLineMarkup(i18n, s, weather)`; rail removed on desktop (domains move to Još / search); `.ki` grid becomes `rows: status 1fr`, `cols: 1fr 300px` ≥ 60rem. |
| Time band | `grad-sada.ts` weather / safety / transit / agenda / news / civic blocks in three `.ov-col` | Each block becomes a *tile producer* returning `Tile[]` with `{at?, bucket?, domain, variant, label, value, context, selection}`; `timeband.ts` buckets and renders. Weather block → status line only. |
| Kvart panel | — | New `experience/kvart.ts`; reuses `map-slots` for the thumbnail and `transport/detail.ts` selections. |
| Phone tabs | `PHONE_TABS`, `MORE_LAYERS` | `['grad-sada','u-pokretu','kvart']`; `MORE_LAYERS` += `'kultura'`. |
| Kiosk | `scenes.ts` chapter rotation + two value tiles | `field.ts` (the fixed map field, mounted once) and `say.ts` (`rankStatements`, up to three ranked statements) replace `scenes.ts`; `invitation.ts` composes field + column instead of field + rail. |
| Domain workspaces | `u-pokretu, zrak-i-nebo, kultura, uprava-i-pravo, sigurnost` | No layout change in phase 1; they inherit the palette, the `xs` badge and glyph rules. Phase 3: their heads become the same tile grammar. |

## 6. Data requirements (feature-flagged)

| Tile | Feed | Module id | Flag | Without it |
|---|---|---|---|---|
| Saved line at stop | zet-rt (exists) + local saved list | — | — | falls back to `stop.routes` top 2 |
| Bicikli | Nextbike GBFS `station_status` | `bikes` | `FEED_BIKES` | tile absent |
| Garaža | Zagrebparking occupancy (open data portal, when published) | `parking` | `FEED_PARKING` | tile absent |
| Odvoz | Čistoća pickup calendar by kvart (PDF/CSV → static JSON in `public/data`) | `waste` | `FEED_WASTE` | tile absent |
| Radovi | existing `komunalne` + closures, filtered by kvart polygon (`kiosk/districts.ts`) | exists | — | city-wide count |
| Zadnji tramvaj | GTFS static `stop_times` for the stop (build-time, `scripts/gtfs-stops.mjs`) | static | `FEED_LASTRUN` | tile absent |
| Obavijesti | Web Push route | — | `PUSH` | "istakni" filter only |

Every new module follows `ModuleSnapshot` (status, fetchedAt, sourceUpdatedAt, attribution) so the band's stale/down handling and the provenance block work unchanged. Attributions go into `docs/izvori.md`.

## 7. Phasing

1. **Palette + components (1 week).** tokens.css values; `.tile*`, `.line[xs]`, glyphs; status line; contrast tests; screenshots at 390/768/1440 light+dark. No behaviour change. Ships alone if needed — the current Sada already looks new.
2. **Time band with existing feeds (1–2 weeks).** `timeband.ts` + tile producers for transit, safety, events, civic, news, works; kvart selector (stop-based); phone segments; kiosk scenes with existing data. e2e: `experience.spec.ts` bucketing, `a11y` heading order, `kiosk-layout` scene frame.
3. **Kvart + new feeds (per feed).** Saved stops, bikes, parking, waste, last run, push. Each behind its flag and its own snapshot fixture in `test/fixtures`.

## 8. Checklists

- **Accessibility:** tiles ≥ 44 px; text ≥ 12 px only for labels/context, ≥ 15 px body; every glyph labelled; focus ring 2 px accent; 200% zoom collapses the band to 3 → 1 lanes via the existing `@container ws` queries; reduced motion stops scene rotation.
- **Copy:** sentence case, no sentences in tiles, state words from `delayWord`, dates via `zagrebWeekdayDate`. New i18n keys: `timeband.{sada,afternoon,tonight,tomorrow,week,today,night}`, `kvart.*`, `tiles.{bikesFree,parkingFree,waste.*,lastRun,worksOpen}`, `notify.*`, `cast.toScreen`. hr/en parity test.
- **Do not:** render arrivals; show weather as a tile; use grey; put more than one ink tile per screen; add a domain column; write "vozila", "pješice", "zalazak" where a glyph is defined.

---

Reference boards: 0 trenutno stanje · 1 dva smjera · 2 dan grada · 3 zagrebačka plava + znakovi · 4 paleta (4a odabrana). Code: AGPL-3.0-or-later; Lucide ISC; Manrope OFL.
