# Map tile fixtures

Three z14 vector tiles of the served map, used by `test/scripts/streets-geo.test.ts` to build the street index (`scripts/streets-geo.mjs`) offline and deterministically.

| File | Tile | Bytes | What it holds |
|---|---|---|---|
| `14-8919-5841.mvt` | 14/8919/5841 | 117,661 | Trg bana J. Jelačića, the east end of Ilica, Donji grad |
| `14-8920-5840.mvt` | 14/8920/5840 | 74,993 | Kvaternikov trg (Trg Eugena Kvaternika), the east end of Vlaška ulica |
| `14-8920-5841.mvt` | 14/8920/5841 | 75,998 | the blocks south of Kvaternikov trg |

Fetched on 22 September 2026 from `https://zagreb.aningfilm.hr/maps/zagreb-v1/{z}/{x}/{y}.mvt` (the application's own tile route over the Protomaps archive `zagreb-v1`) and stored exactly as served: raw Mapbox Vector Tiles, not gzip (the first bytes of 14/8919/5841 are `1a ca`). The Worker decompresses the archive's tiles before serving them (`worker/routes/maps.ts`).

The tiles are OpenStreetMap data: © OpenStreetMap contributors, ODbL 1.0, via Protomaps (see `docs/izvori.md`, "Statički skupovi").
