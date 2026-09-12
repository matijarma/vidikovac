# Basemap assets

Glyphs and sprites are copied from the Protomaps basemaps-assets project by
`node scripts/map-assets.mjs`. Noto Sans is licensed under SIL OFL 1.1.
Protomaps sprites use the upstream project's asset licences (including CC0
Maki shapes). Original assets: https://github.com/protomaps/basemaps-assets.

The regional archive in R2 is an extract of Protomaps build 20260912, schema
v4.15.2, bounds 15.70,45.50,16.30,46.02, zooms 0–14. Original data:
© OpenStreetMap contributors, ODbL. The archive is a Produced Work.
The PMTiles Cloudflare adapter is BSD-3-Clause; adapted in worker/routes/maps.ts.

Extraction:

    pmtiles extract https://build.protomaps.com/20260912.pmtiles zagreb-v1.pmtiles --bbox=15.70,45.50,16.30,46.02 --maxzoom=14

The immutable archive key is `zagreb-v1.pmtiles` in the private `vidikovac-maps`
bucket. No underlying dataset is relabelled under the Croatian Open Licence.
