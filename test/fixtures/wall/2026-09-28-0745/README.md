# Wall fitter fixture: stop 106_1, Monday 28 September 2026, 07:45 Zagreb (the control)

**Test fixture only.** These files are inputs of this repository's tests and nothing else: the Worker never serves them and no client downloads them. They hold everything the seed replay of the wall at stop 106_1 (Trg bana J. Jelačića) read for one ten-minute observer slot, cut down to what can reach that wall, so the fitter test of U0 step 6 (acceptance U0-6, `test/app/wall-fit-0929.test.ts`, added by U0) runs on any machine without the strike session's local recordings, which are never committed.

This is the control: the same stop and slot a day earlier, when the event that emptied Tuesday's wall was a day ahead and the fitter kept three departures and both closures. The seed's replay equals the recorded row ids in 294 of 300 readings; in five of the six others the live wall listed two departures where the replay lists three, and in one it still held a departure the replay had let go.

Both mornings fall in the ZET general strike of 28 to 29 September 2026: every departure on the board is a timetable time and no vehicle is live. The fixture pins the list fitter, not transit behaviour, and is no normal-behaviour replay of the feed.

## Files

| File | What | Cut from (local, never committed) | Bytes |
|---|---|---|---|
| `boards/106_1.json`, `boards/106_2.json` | the departure boards of the platforms the seed read, byte for byte (ZET timetable as the Worker served it: generatedAt 2026-09-28T01:07:28.695Z, service 0_23) | `review.local/strike/boards/20260928T054500Z/`, the copy of 05:45:00Z (07:45:00 Zagreb) | 3,644, 3,834 |
| `teaser.json` | the wall's `/api/teaser` answer: `prometnice` (39 closures), `zet-rt` and `dhmz-now` whole, `dogadanja` with the 8 of 129 items located within 3 km of stop 106_1 (etnografski 7, kulturpunkt 1); `dhmz-cap`, `emsc`, `ckan-geo`, `dhmz-forecast`, `glasnik` dropped | `review.local/strike/teaser-full/20260928T054700Z.json` (generatedAt 2026-09-28T05:47:00.916Z) | 33,011 |
| `places.json` | catalogue places: `culture-56e13dd4127bc7ea` Gradsko dramsko kazalište Gavella (culture); `culture-d323541c8ae45b00` Etnografski muzej u Zagrebu (culture); `heritage-9cae1bf25c9ce440` Spomenik banu Josipu Jelačiću (heritage, no coordinates); `heritage-60cfa241f3591c19` Zakladni blok (heritage) | `app/public/data/city/manifest.json` and its chunks at 869ccf86 | 5,131 |
| `stops.json` | stop 106_1 and every stop with a tram route within 3.4 km of it, 180 in all (the tram-to-venue line searches 400 m around venues up to 3 km away) | `app/public/data/stops.json` at 869ccf86 (feed 000395) | 19,968 |
| `readings.jsonl` | the 300 readings of the slot, one a line: `{n, at, rowIds, departures, sentence}` | `review.local/strike/observe-0928-0745/rotation.jsonl` | 95,244 |

## The slot

| | |
|---|---|
| readings | 300, 2026-09-28 05:45:10 to 05:55:55 UTC (07:45:10 to 07:55:55 Zagreb, UTC+2) |
| departures shown | 2 in 5, 3 in 295 readings |
| timeless row shown | `always:heritage:heritage-9cae1bf25c9ce440`, "Spomenik banu Josipu Jelačiću" / "Trg bana Josipa Jelačića", in every reading |
| boards on the wall | 106_1 at 05:45:02.948Z (26 rows), 106_2 at 05:45:03.188Z (27 rows), 1849_23 at 05:45:03.049Z (13 rows), 1849_24 at 05:45:03.187Z (0 rows) (the observer's `boards.jsonl`). The strike recorder copied no board of 1849_23 or 1849_24 (bus line 150), so the seed and this fixture hold 106_1 and 106_2 only; no line 150 departure appears in the recorded readings. The seed switches from 106_1 alone to every board at 05:45:03.1Z. |

## What the seed read, and what is here

The seed (`review.local/strike/scratch/wall-fit.test.ts`, with `replay-nearby.ts` and `run.mjs` beside it) read: the boards of 106_1, 106_2, 1849_23 and 1849_24 from the 05:45:00Z copy, of which only the first two exist; the teaser copy of 05:47:00Z; the whole city catalogue (`manifest.json` and every chunk without `part`: places, streets, paths, settlements); `app/public/data/stops.json`; and the slot's `rotation.jsonl`. Every part of those inputs that reaches the wall is here.

Verified: the seed's kiosk loop and timeline, run once on the seed's inputs and once on these files alone, give identical `selectNearby` rows (every field) and identical shown row ids at all 301 instants of the slot (the switch to every board and the 300 reading instants) and at every 2 s of the seed's scene from 05:45:02.9Z to 05:56:00Z (329 instants). Both runs match the recorded wall's row ids in 294 of 300 readings.

The seed's scenes A to G need nothing else: A and B are the two fixtures as recorded, C takes Tuesday's boards and teaser with the `zet-rt` module of the control, D to G edit the selected rows (closures removed, the event removed, the event with a short title, the event moved to Monday).

Left out on purpose: streets, paths and settlements (the street story does not take the timeless slot at these instants, so the selection's timeless row is the same heritage row either way) and the other catalogue places (no opening row and no other venue reaches this wall in the slot).

The recorded timeless row is the monument `heritage-9cae1bf25c9ce440`, which the committed catalogue holds without coordinates (its register record did not join the Ministry's geometry in that build), so the local selection's timeless row is the nearest located protected building, Zakladni blok (113 m). The seed substitutes the recorded row's `id`, `title` and `sub` for the timeless row before the fitter runs; a port does the same, and `places.json` carries the monument's record for its name and address.

## Licences

- Boards, `stops.json` and `zet-rt`: ZET static GTFS and GTFS-Realtime under the Croatian Open Licence (Otvorena dozvola); attribution, verbatim: "Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669".
- `prometnice`: Grad Zagreb, data.zagreb.hr, "Zatvaranje prometnica na području Grada Zagreba", Otvorena dozvola (NN 67/17).
- `dhmz-now`: DHMZ, Otvorena dozvola.
- `dogadanja` items, each with its own credit in the module: Etnografski muzej (emz.hr): no licence stated; shown with the source credit, never on `/open` (docs/izvori.md); Kulturpunkt (kulturpunkt.hr): CC BY-SA 3.0 HR.
- `places.json`: Kulturne ustanove Grada Zagreba (Geoportal, Otvorena dozvola) and the Registar kulturnih dobara of the Ministarstvo kulture i medija (data.gov.hr, Otvorena dozvola; geometry from the Geoportal kulturnih dobara, informational).
- `readings.jsonl`: the product's own observer readings of its production wall.
