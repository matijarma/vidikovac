# Frame-replay fixtures

Test fixtures only: nothing here is served by the Worker (its static assets are `app/dist`), downloaded by a client or linked from a page. The 162-frame tram sample of 21 September 2026 documents itself in [`2026-09-21-1715-1744/README.md`](2026-09-21-1715-1744/README.md).

## zet-expect-000395.json

The declared fleet of ZET's static GTFS feed **000395**, in the format of `app/public/data/zet-expect.json` (`scripts/gtfs-expect.mjs`, decoded by `shared/motion/expect.ts`): per service and five-minute slot of a 31-hour service day, the vehicle runs (blocks) in service by mode and the trips in service per route, and the services of every calendar date.

| | |
|---|---|
| source | `zet-gtfs-scheduled-000-000395.zip`, https://www.zet.hr/gtfs-scheduled/latest, Last-Modified Tue 01 Sep 2026 08:50:29 GMT (14,720,190 B), a local copy kept outside the repository |
| feed version | 000395 (`feed_info.txt`), eight services `0_20` to `0_27` |
| calendar | 2026-09-01 to 2026-12-31, 122 dates; Sunday 27 September runs `0_25`, Monday 28 September `0_23` |
| size | 878,731 B raw, 44,869 B gzip |
| licence | ZET, Otvorena dozvola (Croatian Open Licence, NN 67/17) |

Attribution, verbatim:

> Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669

Why it is here: feed 000396, the one the committed artefacts are cut from, starts its calendar on Monday 28 September 2026, so it cannot say what was expected on the evening of Sunday 27 September or in the small hours of the 28th, when the night runs of Sunday's service are still counted. The replays of the strike days (the collapse from 22:00 on the 27th, the start from 01:00 on the 28th) read this file for those hours.

Built with:

```
node scripts/gtfs-expect.mjs --zip <zet-gtfs-scheduled-000-000395.zip> --built-at 2026-09-01T08:50:29Z --out test/fixtures/frames/zet-expect-000395.json
```

The same archive and stamp build the same bytes.
