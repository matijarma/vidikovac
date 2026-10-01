# The scheduler's fixture day: stop 106_1, Wednesday 30 September 2026 (reveal pass R2)

**Test fixture only.** `day-2026-09-30.json` is the input of `test/app/takt.test.ts` and nothing else: the Worker never serves it and no client downloads it. It describes one synthetic day at Trg bana J. Jelačića (stop 106_1), Zagreb time UTC+2, from 06:00 to 24:00, on which the beat scheduler (`shared/kiosk/takt.ts` `takt()`, docs/reveal-2026-10-plan/R2.md §0.2) is replayed beat by beat at Ritam 20 s through the wall's real candidate builder (`app/src/kiosk/timeline.ts` `taktCandidates`) into `beat-log.jsonl`, the committed snapshot the test pins.

The day is **synthetic**: it is no replay of the feed and no record of normal behaviour. The departures are a timetable of one departure every `headway` minutes (4 by day, 8 from 20:00, 12 from 21:00, 20 from 23:00, each band from its own start, to 00:40 the next day; ids `dep:<HHMM>`, `dep:2400` and after for the next day), the capacity is the rows the 1920 × 1080 wall holds after R1 (the departures line plus five rows by day, one fewer from 22:00, when the pharmacy and last-trams rows are 86 px; `review.local/reveal/analysis/captures-2026-09-30.md`), and the three quiet windows stand for the service fact pinning the header (07:30 to 07:40), a touch panel (12:00 to 12:01) and the paired phase (16:30 to 16:32).

## The ids

Real, from the committed fixtures:

| id | from |
|---|---|
| `closure:amruseva:2026-09-12T06:00:00.000Z`, `closure:gunduliceva:2026-07-04T05:00:00.000Z` | `test/fixtures/wall/2026-09-29-0745/teaser.json` (prometnice) |
| `event:etnografski:22673` | the same teaser (Radionica Nacrtaj svoj (sve)mir, Etnografski muzej) |
| `always:heritage:heritage-9cae1bf25c9ce440` | the monument row of the wall fixtures (`places.json`) |
| `always:pharmacy`, `last:2026-09-30`, `solar:sunset:2026-09-30` | the ids `app/src/city/nearby.ts` writes for those rows |

Synthetic, prefixed `fixture-`: the 228 bus notice of the 30 September capture, the openings, the kultura.zagreb.hr events of that evening (ZKM, Galerija Manuš, Rokov perivoj, Kinoteka, Tuškanac), the rain step, a cut tomorrow, three places open now, the HŽ trains at Glavni kolodvor every :15 and :45 (`rail:fixture-hz-<HHMM>`, each offered from 60 minutes before its time).

The sunset is `sunTimes(new Date('2026-09-30T12:00:00Z'))` (`app/src/ui/solar.ts`), 18:39 Zagreb, written as HH:MM.

## The log

One JSON object a line, keys in this order: `t` (Zagreb `HH:MM:SS`), `b` (the beat index, `beatIndex(t, 20000)`), then `page1` only when it differs from the last logged page 1 (and on the first beat), `reveal` (`{ kind, ids, replaces }`) only on a beat that carries one, `quiet: true` only on the first beat of a quiet window; a beat with none of the three writes no line.

Regenerate with

    npx vitest run test/app/takt.test.ts -u

**only with a reason in the commit body** (acceptance R2-6): the log changes when the scheduler's rules, R0's values or this day change, and each is a decision to record, never a refresh.
