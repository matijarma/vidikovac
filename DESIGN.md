---
name: "Kaj ima?"
description: "Dan grada: paper, ultramarine and useful city information."
colors:
  palette-light-canvas: "#f4f2ec"
  palette-light-canvas-deep: "#ece9df"
  palette-light-surface-1: "#fbfaf6"
  palette-light-surface-2: "#ebe8df"
  palette-light-surface-3: "#ddd9cc"
  palette-light-text-primary: "#0c1250"
  palette-light-text-muted: "#4a5178"
  palette-light-text-subtle: "#5a6187"
  palette-light-label: "#363d73"
  palette-light-accent: "#03409c"
  palette-light-accent-deep: "#00327e"
  palette-light-on-accent: "#ffffff"
  palette-light-warning: "#8a5800"
  palette-light-danger: "#b3271e"
  palette-light-success: "#1e6f47"
  palette-light-events: "#6b3fa0"
  palette-light-transit: "#0c1250"
  palette-dark-canvas: "#0b1150"
  palette-dark-canvas-deep: "#080c40"
  palette-dark-surface-1: "#121a63"
  palette-dark-surface-2: "#1a2373"
  palette-dark-surface-3: "#26307f"
  palette-dark-text-primary: "#f4f2ec"
  palette-dark-text-muted: "#b6bbe0"
  palette-dark-text-subtle: "#8f96c9"
  palette-dark-label: "#b6bbe0"
  palette-dark-accent: "#f4f2ec"
  palette-dark-accent-deep: "#ffffff"
  palette-dark-on-accent: "#0b1150"
  palette-dark-transit: "#9fb4ff"
  palette-dark-warning: "#f2c46f"
  palette-dark-danger: "#ff9d9d"
  palette-dark-success: "#7fd6a8"
  palette-dark-events: "#c9b3ff"
typography:
  type-body:
    fontFamily: "Manrope, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.4
  type-control:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.2
  button-primary-label:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.2
  type-secondary:
    fontSize: "0.8125rem"
    fontWeight: 700
  type-meta:
    fontSize: "0.75rem"
    lineHeight: 1.3
  type-head:
    fontSize: "1.125rem"
    fontWeight: 700
  type-title:
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
  type-display:
    fontSize: "1.75rem"
    fontWeight: 700
  type-numeral:
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1
  type-numeral-xl:
    fontSize: "3.5rem"
    fontWeight: 700
    lineHeight: 1
  type-tile-xl:
    fontSize: "2rem"
    fontWeight: 700
  type-tile-l:
    fontSize: "1.5rem"
    fontWeight: 700
  type-tile-m:
    fontSize: "1.0625rem"
    fontWeight: 700
  type-tile-time:
    fontSize: "1.25rem"
    fontWeight: 700
rounded:
  r-xs: "0.375rem"
  r-sm: "0.5rem"
  r-md: "0.875rem"
  r-lg: "1rem"
  r-xl: "1.25rem"
  r-2xl: "1.5rem"
  r-pill: "999px"
spacing:
  sp-1: "0.25rem"
  sp-2: "0.5rem"
  sp-3: "0.75rem"
  sp-4: "1rem"
  sp-5: "1.25rem"
  sp-6: "1.5rem"
  sp-8: "2rem"
  sp-10: "2.5rem"
  sp-12: "3rem"
components:
  button-primary-light:
    backgroundColor: "{colors.palette-light-accent}"
    textColor: "{colors.palette-light-on-accent}"
    rounded: "{rounded.r-md}"
    padding: "0 1.25rem"
    height: "3rem"
    typography: "{typography.button-primary-label}"
  button-primary-dark:
    backgroundColor: "{colors.palette-dark-accent}"
    textColor: "{colors.palette-dark-on-accent}"
    rounded: "{rounded.r-md}"
    padding: "0 1.25rem"
    height: "3rem"
    typography: "{typography.button-primary-label}"
  button-ghost:
    rounded: "{rounded.r-md}"
    padding: "0 1rem"
    height: "2.75rem"
    typography: "{typography.type-control}"
  button-quiet:
    rounded: "{rounded.r-md}"
    padding: "0 1rem"
    height: "2.75rem"
    typography: "{typography.type-control}"
  input:
    rounded: "{rounded.r-md}"
    padding: "0 0.75rem"
    height: "2.75rem"
  chip:
    rounded: "{rounded.r-pill}"
    padding: "0 0.75rem"
    height: "2.75rem"
    typography: "{typography.type-control}"
  card:
    rounded: "{rounded.r-lg}"
    padding: "{spacing.sp-4}"
---

# Design System: Kaj ima?

## Overview

**Creative North Star: "Dan grada"**

Local, capable, alive. The phone serves a person outside, often moving and reading in daylight. The public screen is read across a room, throughout the day and night. These are different compositions of one product, not scaled copies.

This is an implementation reference, not a redesign brief. The source of values is `app/src/ui/tokens.css`; component styles and builders decide how those values are used. Latest explicit product decisions take precedence over historical prose. `newdesignsystem.md` records the earlier direction and is not a list of unimplemented features to resurrect.

The time band organizes Sada by time, not by domain. Promet is an interactive map stage with a detail sheet. The desktop has a Kvart aside; the phone uses Sada, Promet, Kvart and Još tabs. The Prozor kiosk has one edge-to-edge map field and a separate ranked statements column, with no chapter rotation or overlay rail. The schema replaces only the field's renderer.

Key characteristics:

- Paper and ultramarine, with Zagreb blue in meaningful actions and transit badges.
- One self-hosted type family, legible controls and a deliberately larger kiosk scale.
- Label, value and context in tiles; prose and evidence in details.
- Missing, stale and down are distinct states, never disguised as zero.
- Croatian and English; keyboard, reduced-motion and lightweight paths.

Source paths: `app/src/experience/{chrome,timeband,tiles,kvart}.ts`, `app/src/transport/workspace.ts`, `app/src/kiosk/{layout,scenes,invitation}.ts`.

## Colors

Light is **papir i ultramarin**; dark is **ultramarinska noć**. The frontmatter records the exact sRGB palette used by the contrast tests. `tokens.css` also defines the existing OKLCH equivalents for capable browsers. Do not invent a second, independently tuned palette.

**The Role Rule.** Components consume `--tone-*`, not raw colour values. Palette primitives feed theme assignments, which feed surface, text, action, state and domain roles. Theme resolution is `data-theme-resolved="light|dark"`. Auto, light, dark and solar are preferences, not four separate palettes.

Zagreb blue is the light-theme action colour. In the dark theme, the action badge becomes paper with night-coloured text. Warning, danger, success and events have specific meanings; they do not identify arbitrary panels. Light transit uses the primary ink value; dark transit has its own lighter value.

Action, events, urgency, transit and success tints use the implemented 12% `color-mix(in oklab, …)` rule against surface-1. Weather uses 14%. Border, glass, scrim and glow alpha values come from the same token file.

**The Printed Object Rule.** QR contrast is pinned, not theme-inverted. The shared QR uses the light surface and light primary ink. The kiosk explicitly uses a white plate and ultramarine ink. These are existing, scanner-driven exceptions; do not silently unify them.

ZET schema line colours belong to the source artwork, not the UI palette. Preserve their identities in both themes; apply surface/text/tint roles to the canvas, stop outlines, labels and water.

## Typography

Manrope is self-hosted in 400, 500 and 700. Body and display roles use the same family. The declared semibold role resolves to 700, not an unshipped 600 face. Lightweight mode uses the system stack and does not fetch fonts.

Use the frontmatter type roles instead of inventing intermediate sizes. Body is 16px, controls 14px, secondary 13px and metadata 12px at the default root size. `.kicker` uses secondary, bold, uppercase and `0.04em` tracking. The older guide's 15px body and 12px kicker are superseded.

The baseline body line height is `--leading-normal` (1.5). A component explicitly using `--lh-body` uses 1.4. Preserve this distinction instead of changing all paragraphs to the same leading. Headings use the display family and existing tight leading; numerals and time use tabular figures.

**The One Family Rule.** Do not add a display font, Exat, or an icon font. The mono stack is reserved for pairing codes and existing technical presentation; new UI labels use Manrope.

Kiosk roles are scoped separately in `kiosk.css`. Wide/compact pairs include display 84/64px, clock 48/36px, main 40/28px, supporting 28/22px, hints 26/20px and labels 24/18px. Handheld has explicit overrides. The pairing-code cap is `15cqi`. Do not apply desktop body sizes to a public sign.

## Elevation

Depth is structural. Time-band tiles have a stroke and no resting shadow. General cards and banners use the soft shadow; floating map sheets and the cast action use medium; dialogs use heavy. Shadow values are theme-specific, captured in `DESIGN.json` from `tokens.css`.

Map overlays may use the glass role. This does not authorize decorative glass elsewhere. Generic dialog backdrops and bottom-sheet backdrops deliberately differ: the sheet removes blur.

**The State Motion Rule.** Motion communicates a change. The system uses 140/180/220ms durations and the existing ease-out curves. Value replacement fades only when its value changes. A routine poll must not replay an entrance. Reduced motion removes choreography; the Prozor kiosk has no chapter rotation in any mode.

## Components

### Buttons, fields and chips

Buttons have 44px minimum targets, 14px labels and medium weight. Primary touch actions are 48px with 16px labels. The rounded rectangle uses `r-md`. Ghost and quiet variants retain their own border/text/hover behavior, including disabled and pressed states.

Text/search fields have 44px minimum height and 16px text, a strong stroke and the existing focus glow. Placeholder text uses the subtle role. Do not shrink inputs to fit more controls.

Chips are 44px pill controls. A selected chip uses primary ink on canvas, not an invented brand fill. Static badges are not controls and need not be inflated to touch-target size. Focus remains visible, with the global 2px ring.

### Tiles and line badges

The implemented time-band family is `.tl[data-variant="value|time|band|row|ink"]`. `.tile` is a different existing fact component. Do not confuse the historical guide's names with current selectors.

Tile builders create real navigation links and composed accessible names. Skeletons are not interactive. Stale state replaces context; missing/down content follows the domain's own rule. Safety's unknown state must remain visible. The ink tile uses canvas-coloured label text.

Tram badges are rectangular; bus badges are capsules. Shape and adjacent text reinforce colour. The XS line badge uses 13px type inside an 18px-high badge, not the old proposed 10px type.

### Navigation and composition

The phone header is one 52px row. Desktop switches at 60rem to a 56px header with a 300px Kvart aside. The phone navigation remains four destinations. The cast action follows its existing session/surface eligibility.

Time-band thresholds are container queries: below 60rem it uses three lanes; below 36rem it uses the snap-scrolling presentation and segments. Segment faces sit inside 44px controls. The night band has four columns, not a permanent five.

Promet has a peek/half/open phone sheet, a desktop board and a right-side short-landscape sheet. Fits account for the covered viewport. Schema mode uses the same controls and sheet, not a new dialog.

Kiosk layout is classified by its layout code: handheld below 900px, wide landscape from 1700px, otherwise compact with a distinct portrait arrangement. The total zoom clamps to 0.8–2.5; invitation sign zoom caps at 1.35. Do not revive the guide's fixed left-field tile grids.

### Scope and data

The design does not create feeds. Bikes, parking, waste and push availability follow `core/flags.ts`; notification controls currently highlight locally and must not promise Web Push. News/HRT were explicitly removed from the product. Last-run data is distinct from live arrival prediction.

## Do's and Don'ts

- Do use semantic roles, existing type sizes and component builders.
- Do keep 44px targets, 48px primary actions, labelled glyphs and visible keyboard focus.
- Do test both themes, Croatian/English, 200% text, reduced motion and lightweight mode.
- Do preserve the distinction between calculated vehicle position, route delay and an arrival time.
- Do check code and rendered output before updating this document.
- Don't revive Modrotisak, panorama, meander, gallery numbering and captions.
- Don't substitute another decorative banner or mandatory graphic motif.
- Don't add municipal document portals, tables disguised as dashboards, endless equal cards, washed-out surfaces, generic SaaS, ornamental glass, or visual complexity without a useful interaction.
- Don't introduce news, nonexistent push delivery or future feeds as implemented capabilities.
- Don't change production tokens merely to agree with `newdesignsystem.md` or this generated reference.
- Don't use colour as the sole indication of state, hide missing data as zero, or claim ZET publishes live arrivals.
