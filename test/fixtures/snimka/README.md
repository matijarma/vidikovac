Deviation fixture: the ZET general strike of 28 to 30 September 2026. Never a normal-behaviour replay, tuning or fixture day.

# Snimka dataset sample (/snimka/, lane S1)

One ten-minute motion chunk of the public /snimka/ dataset and the manifest of the build it came from, cut with `node scripts/snimka/fixture-cut.mjs` (this README is generated: edit the script, not the file). The dataset itself is built from the private recordings by `node scripts/snimka/build.mjs` and lives on R2, never in git.

| File | What |
|---|---|
| `motion-396-20260928-0730.a6abc6025822650e.json` | network 396, 2026-09-28 07:30 to 2026-09-28 07:40 Zagreb, 2 vehicle entries, 432 bytes; the positions the product's twin published for every 10-second tick, as metres along the paths and shapes of zet-network.json (feed 000396) |
| `manifest.sample.json` | a manifest in the v2 shape (two comparison days, eight boards, nine downloads, places, routes, the voice index), hand-updated and minified on 2 October 2026 from the v1 build of 1 October so the folder stays under 20,000 bytes; every ref except the chunk and the networks names an object that is not here, with a placeholder hash. `fixture-cut.mjs` re-cuts it from the real v2 build. |

Derived positions only: the raw GTFS-Realtime frames they come from are never committed and never served. ZET publishes the feed under the Croatian Open Licence (Otvorena dozvola); attribution, verbatim:

> Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669

Read by `test/snimka/fixture.test.ts`.
