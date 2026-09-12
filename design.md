# Kaj ima? · approved implementation direction

This document supersedes the Vidikovac/Modrotisak visual instructions. See PRODUCT.md for the owner-approved purpose and audience.

## Scene and visual system

A person holds a phone in daylight on a Zagreb street, seeking a quick answer; the Council evaluator explores the same service at a desk; a public screen is read from several steps away in a cafe or library. Light is the app's first-paint fallback; support OS/manual dark and solar/manual kiosk themes equally.

Full functional palette: mineral-light canvas, near-charcoal text, deep green-neutral dark surfaces, peacock action, amber weather, violet events and rose urgency. Colours have roles, not one arbitrary colour per panel. Use OKLCH tokens with sRGB fallbacks, rendered contrast tests, and three clear surface levels in dark mode. Start from canvas #f6f8f7, ink #182423, muted #526461, action #08777b, dark #17201f, dark ink #eff6f3, dark action #63d7c3. Never use pure white/black as the app's large surfaces.

One self-hosted Manrope family, system fallback, tabular numbers. Sentence case and readable navigation. A compact Kaj ima? wordmark, not a display-size question mark. Reuse the existing Lucide icon system. Product motion 140–220ms, ease-out, reduced-motion alternative. Use opaque surfaces and purposeful depth; no default glass or ornament.

Remove panorama, meander, gallery numbers, mono legends and their reserved space. No replacement banner.

## Composition

- Desktop: seven labelled domains in a sidebar, one active workspace, contextual details. Never render all seven as long parallel columns.
- Mobile: Sada / Promet / Događanja / Još, with an inline labelled directory for Vrijeme / Sigurnost / Grad / Vijesti. Safety directly accessible. Compact session status, at most 56px. First viewport contains meaningful information from at least two domains.
- Overview: unequal, composed transport/weather/activity/safety treatments. Not equal cards, a fleet-count hero, a clock or a decorative map.
- Transport: one custom map, numbered vehicles/routes, named stops, geographic context, coordinated search/route/stop/detail controls. Route delays are not arrivals.
- Weather: actual condition, observation, daily range, wind, humidity and computed sun path. No fabricated hourly curve.
- Events: dated agenda, category controls, detail; undated notices separate. Date-only entries are all-day, not midnight.
- Civic: work phases and listed amounts with dataset coverage, assembly dates, searchable issue/act navigation. No invented progress percentages, expenditure totals or legal summary.
- Safety: urgent priorities and practical actions; equivalent no-JS information. Never claim all-clear while data is unavailable.
- News: source-separated hierarchy, real dates, existing permitted summaries and source links.
- Kiosk: explicit 1920×1080 and 1366×768 compositions. About 60% map; fixed-position invitation/rotating QR; useful local/weather/service content; bounded secondary story. Main text 40/28px, supporting 28/22px, QR at least 240px. Paired domains have their own glanceable compositions. Basics idle return applies only without an active session.

## Interaction and fidelity

Production-quality interactive prototype using real feeds and real sessions. Back, details, filters, map camera, scroll and focus survive polls. Locale/theme changes update dynamic content. Loading, valid empty, partial, stale, unavailable, reconnecting, expired and revoked states are designed, not afterthoughts. Attribution is accessible without overwhelming the composition; exports preserve it.

Anchor quality references: Flighty's hierarchy, Apple Weather's graphical information, Transit’s readable transit interactions. These are craft references, not themes to copy.

## Implementation visual gate

Shape approved by the owner. Native image-generation probes and raster north-star mocks are skipped because the harness has no native image-generation capability. The first real phone overview, desktop transport workspace and paired kiosk are the visual checkpoint. Both models inspect screenshots at real sizes, correct the first implementation, then extend it across remaining domains.

## Invariants

Keep the current TS/Vite/Cloudflare stack, technical names, keys and hostname. Keep Access protection for evaluation. No independent public launch. Keep `?lagano=1` and no-JS safety. No new air quality, heritage, HŽ or arrival-time feed in this iteration.
