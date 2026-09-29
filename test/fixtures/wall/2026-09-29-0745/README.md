# Wall fitter fixture: stop 106_1, Tuesday 29 September 2026, 07:45 Zagreb

**Test fixture only.** These files are inputs of this repository's tests and nothing else: the Worker never serves them and no client downloads them. They hold everything the seed replay of the wall at stop 106_1 (Trg bana J. Jelačića) read for one ten-minute observer slot, cut down to what can reach that wall, so the fitter test of U0 step 6 (acceptance U0-6, `test/app/wall-fit-0929.test.ts`, added by U0) runs on any machine without the strike session's local recordings, which are never committed.

This is the one-departure wall. From about 06:00 to 12:00 Zagreb that Tuesday the wall at stop 106_1 showed a single departure and the timeless row in a mostly empty box. `selectNearby` returned three departures, two closures (Amruševa and Gundulićeva, their ends rolled to 16:00 and 18:00 Zagreb), the sunset, three events and the timeless row in every reading; the list fitter (`app/src/kiosk/timeline.ts`) then estimated the title of the one event of the day, "Promocija kataloga izložbe „Joso Bužan: iz fundusa Nacionalnog muzeja moderne umjetnosti i Etnografskog muzeja”" (`event:etnografski:22659`, Etnografski muzej u Zagrebu, 2026-09-29 12:00 Zagreb), at 9 lines on the simulated 1920 × 1080 wall (17 characters a line), and dropped the second and third departures and both closures to keep it. ZET's feed was frozen from 06:28 to 07:56 Zagreb (`sources.zet.status: stale` in `teaser.json`); neither the freeze nor the strike caused the drop.

Both mornings fall in the ZET general strike of 28 to 29 September 2026: every departure on the board is a timetable time and no vehicle is live. The fixture pins the list fitter, not transit behaviour, and is no normal-behaviour replay of the feed.

## Files

| File | What | Cut from (local, never committed) | Bytes |
|---|---|---|---|
| `boards/106_1.json`, `boards/106_2.json` | the departure boards of the platforms the seed read, byte for byte (ZET timetable as the Worker served it: generatedAt 2026-09-29T01:07:28.841Z, service 0_30) | `review.local/strike/boards/20260929T054500Z/`, the copy of 05:45:00Z (07:45:00 Zagreb) | 3,644, 3,834 |
| `teaser.json` | the wall's `/api/teaser` answer: `prometnice` (39 closures), `zet-rt` and `dhmz-now` whole, `dogadanja` with the 9 of 129 items located within 3 km of stop 106_1 (etnografski 7, kulturpunkt 1, komunalne 1); `dhmz-cap`, `emsc`, `ckan-geo`, `dhmz-forecast`, `glasnik` dropped | `review.local/strike/teaser-full/20260929T054700Z.json` (generatedAt 2026-09-29T05:47:00.492Z) | 32,303 |
| `places.json` | catalogue places: `culture-56e13dd4127bc7ea` Gradsko dramsko kazalište Gavella (culture); `culture-d323541c8ae45b00` Etnografski muzej u Zagrebu (culture); `heritage-9cae1bf25c9ce440` Spomenik banu Josipu Jelačiću (heritage, no coordinates); `heritage-60cfa241f3591c19` Zakladni blok (heritage) | `app/public/data/city/manifest.json` and its chunks at 869ccf86 | 5,131 |
| `stops.json` | stop 106_1 and every stop with a tram route within 3.4 km of it, 180 in all (the tram-to-venue line searches 400 m around venues up to 3 km away) | `app/public/data/stops.json` at 869ccf86 (feed 000395) | 19,968 |
| `readings.jsonl` | the 300 readings of the slot, one a line: `{n, at, rowIds, departures, sentence}` | `review.local/strike/observe-0929-0745/rotation.jsonl` | 53,546 |

## The slot

| | |
|---|---|
| readings | 300, 2026-09-29 05:45:20 to 05:55:53 UTC (07:45:20 to 07:55:53 Zagreb, UTC+2) |
| departures shown | 1 in 300 readings |
| timeless row shown | `always:heritage:heritage-9cae1bf25c9ce440`, "Spomenik banu Josipu Jelačiću" / "Trg bana Josipa Jelačića", in every reading |
| boards on the wall | 106_1 at 05:45:02.867Z (26 rows), 106_2 at 05:45:03.071Z (27 rows), 1849_23 at 05:45:03.072Z (13 rows), 1849_24 at 05:45:03.064Z (0 rows) (the observer's `boards.jsonl`). The strike recorder copied no board of 1849_23 or 1849_24 (bus line 150), so the seed and this fixture hold 106_1 and 106_2 only; no line 150 departure appears in the recorded readings. The seed switches from 106_1 alone to every board at 05:45:03.1Z. |
| the event that caused the drop | `event:etnografski:22659`: "Promocija kataloga izložbe „Joso Bužan: iz fundusa Nacionalnog muzeja moderne umjetnosti i Etnografskog muzeja”", Etnografski muzej u Zagrebu, 2026-09-29T10:00:00.000Z (12:00 Zagreb), 111 characters, 9 lines at 17 characters |

## What the seed read, and what is here

The seed (`review.local/strike/scratch/wall-fit.test.ts`, with `replay-nearby.ts` and `run.mjs` beside it) read: the boards of 106_1, 106_2, 1849_23 and 1849_24 from the 05:45:00Z copy, of which only the first two exist; the teaser copy of 05:47:00Z; the whole city catalogue (`manifest.json` and every chunk without `part`: places, streets, paths, settlements); `app/public/data/stops.json`; and the slot's `rotation.jsonl`. Every part of those inputs that reaches the wall is here.

Verified: the seed's kiosk loop and timeline, run once on the seed's inputs and once on these files alone, give identical `selectNearby` rows (every field) and identical shown row ids at all 301 instants of the slot (the switch to every board and the 300 reading instants) and at every 2 s of the seed's scene from 05:45:02.9Z to 05:56:00Z (329 instants). Both runs match the recorded wall's row ids in 298 of 300 readings.

The seed's scenes A to G need nothing else: A and B are the two fixtures as recorded, C takes Tuesday's boards and teaser with the `zet-rt` module of the control, D to G edit the selected rows (closures removed, the event removed, the event with a short title, the event moved to Monday).

Left out on purpose: streets, paths and settlements (the street story does not take the timeless slot at these instants, so the selection's timeless row is the same heritage row either way) and the other catalogue places (no opening row and no other venue reaches this wall in the slot).

The recorded timeless row is the monument `heritage-9cae1bf25c9ce440`, which the committed catalogue holds without coordinates (its register record did not join the Ministry's geometry in that build), so the local selection's timeless row is the nearest located protected building, Zakladni blok (113 m). The seed substitutes the recorded row's `id`, `title` and `sub` for the timeless row before the fitter runs; a port does the same, and `places.json` carries the monument's record for its name and address.

## Licences

- Boards, `stops.json` and `zet-rt`: ZET static GTFS and GTFS-Realtime under the Croatian Open Licence (Otvorena dozvola); attribution, verbatim: "Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669".
- `prometnice`: Grad Zagreb, data.zagreb.hr, "Zatvaranje prometnica na području Grada Zagreba", Otvorena dozvola (NN 67/17).
- `dhmz-now`: DHMZ, Otvorena dozvola.
- `dogadanja` items, each with its own credit in the module: Etnografski muzej (emz.hr): no licence stated; shown with the source credit, never on `/open` (docs/izvori.md); Kulturpunkt (kulturpunkt.hr): CC BY-SA 3.0 HR; Plan komunalnih aktivnosti, Grad Zagreb (data.zagreb.hr): Otvorena dozvola.
- `places.json`: Kulturne ustanove Grada Zagreba (Geoportal, Otvorena dozvola) and the Registar kulturnih dobara of the Ministarstvo kulture i medija (data.gov.hr, Otvorena dozvola; geometry from the Geoportal kulturnih dobara, informational).
- `readings.jsonl`: the product's own observer readings of its production wall.
