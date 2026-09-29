# Rolling closure ends: two copies of the City's closures dataset

**Test fixture only.** These two files are inputs of this repository's tests and nothing else: the Worker never serves them and no client downloads them.

Two copies of the City of Zagreb's dataset "Zatvaranje prometnica na području Grada Zagreba" (the `prometnice` source of `docs/izvori.md`), byte for byte as the City served them from https://data.zagreb.hr/dataset/7ff5514d-0a1f-4f6c-86bd-8ed9a3c55eee/resource/e48b6992-add0-45a1-ae95-c5d97d8db259/download/data.json. The strike session's recorder fetched the resource every few minutes and kept a copy whenever the body changed (HTTP 200); the copies were cut from its local store, `review.local/strike/prometnice/`, which is never committed.

| File | Source copy | Fetched, UTC | Fetched, Zagreb | Rows | Bytes |
|---|---|---|---|---|---|
| `sun-2205Z.json` | `20260927T220501Z.json` | 2026-09-27 22:05:01 | Monday 28 Sep 00:05:01 | 39 | 16,409 |
| `mon-0800Z.json` | `20260928T080001Z.json` | 2026-09-28 08:00:01 | Monday 28 Sep 10:00:01 | 39 | 16,409 |

## What they show

The same 39 closures (matched by street, `expectedStartTime` and polyline) are in both copies. Between them, 19 moved `expectedEndTime` forward by exactly 24 hours: Petra i Tome Erdödyja, Vukomerec, Trnava I., Mirogojska cesta, Kneza Branimira, Mlinovi (two closures), Šestinska cesta, Karlovačka cesta, Brezovička cesta, Vladimira Nazora, Mrkšina, Zagrebačka avenija, Vatikanska, Prilaz Gjure Deželića, Velimira Škorpika, Palmotićeva, Savska cesta and Gornjodragonoška cesta. All 19 started between 13.1 and 182 days before the Monday copy and, in it, end 18.0 to 23.9 hours ahead: an end placeholder the City rolls forward every night.

The other 20 kept their end between the two copies. Nineteen of them started at least 16 days before the Monday copy and end within 14 hours of it; they are of the same kind and rolled the following night (the Amruševa and Gundulićeva ends read Monday 16:00 and 18:00 Zagreb in every Monday copy and Tuesday 16:00 and 18:00 in the Tuesday teaser). The one closure with a real end is Jazbina: started 13 days before, ending on 6 October 2026 at 02:00Z, 186 hours ahead. In `mon-0800Z.json` 19 closures end on 28 September, 19 on 29 September and one on 6 October. No closure is between 1 and 13 days old.

## What it pins

U0 step 4 and acceptance U0-4 of the upgrade pass (`test/city/closures.test.ts`, added by U0): at the Monday copy's fetch time, `closureEndKnown` is false for 38 of the 39 rows (older than 7 days with an end less than 24 hours away) and true for Jazbina alone, and no closure row yields a `closureUntil` fact.

## Licence

Grad Zagreb, data.zagreb.hr, Otvorena dozvola (NN 67/17). Attribution as `docs/izvori.md` gives it: "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba'".
