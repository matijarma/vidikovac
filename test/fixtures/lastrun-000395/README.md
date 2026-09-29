# Last departures of the four Trg bana Jelačića platforms, feed 000395

Test fixture only: never served by the Worker (its static assets are `app/dist`), never downloaded by a client. Four files in the shape of `app/public/data/lastrun/<stopId>.json` (`scripts/gtfs-lastrun.mjs`): `106_1.json` and `106_2.json` (the tram platforms), `1849_23.json` and `1849_24.json` (bus 150), 19,686 B together.

| | |
|---|---|
| source | ZET's static GTFS feed **000395** (`zet-gtfs-scheduled-000-000395.zip`, https://www.zet.hr/gtfs-scheduled/latest, Last-Modified Tue 01 Sep 2026 08:50:29 GMT) |
| cut | `node scripts/gtfs-lastrun.mjs --zip <archive>` on 22 September 2026 (`generatedAt` 2026-09-22T20:30:13Z, commit 8a5d7027): service dates 21 September to 12 October 2026 |
| taken from | `app/public/data/lastrun/` at commit 869ccf86, before the artefacts were rebuilt from feed 000396 |
| licence | ZET, Otvorena dozvola (Croatian Open Licence, NN 67/17) |

Attribution, verbatim:

> Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669

Why they are here: the wall's scenes (`e2e/scenes.ts`) stand on 21 and 22 September 2026, and the committed `lastrun/` follows the current feed and a window that starts on its build day, so it no longer names those dates. `e2e/departures-fixture.ts` builds the scenes' boards and last-run files from these copies and from feed 000395's trip index and network in `test/fixtures/frames/2026-09-21-1715-1744/artefacts/`; `test/app/kiosk-timeline.test.ts` reads `106_1.json`. Moving the scenes to days of a newer feed means cutting these files again from that feed, together with the trip index the fixture reads.
