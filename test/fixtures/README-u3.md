# Source fixtures for the facts-breadth package (U3)

These files were saved on 29 Sep 2026 (15:42 to 15:47 UTC) from the live sources the U3 modules will read, one request per URL, with the product's own User-Agent (`Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)`, `worker/feed/http.ts`). `sources-u3.json` is the record: for each file the URL, the fetch instant, the HTTP status, the bytes fetched and saved, a sha256, the cut applied, the robots.txt lines for that path and the terms seen on the site. Read it before you trust a fixture. Every file is the response body byte for byte except `kultura-zagreb-events.json` (first 150 of 1000 rows) and `dhmz-7d.xml` (head plus two station blocks of a 6.9 MB document). The HTML files keep the servers' CRLF line endings on purpose (`.gitattributes` marks them `-text`): a parser tested here must cope with them. Together the fixtures take 1.19 MB, inside the 2 MB budget.

| File | Source | Purpose |
|---|---|---|
| `kultura-zagreb-events.json` | kultura.zagreb.hr internal route, read under the owner's ruling O-70 | `kultura-zg` parser; keeps `event_description` on purpose, so a test can prove it is never read |
| `kgz-dogadjanja-p1.html`, `kgz-dogadjanja-p2.html` | Knjižnice grada Zagreba programme, pages 1 and 2 | KGZ parser (branch, date, free-text start time) |
| `arena-program.html` | Arena Zagreb programme, whole year in one table | Arena parser; the list has dates but no time of day |
| `dinamo-utakmice-cf-challenge.html` | gnkdinamo.hr fixtures page | NOT the fixtures page: the Cloudflare challenge (HTTP 403) the site returns to the identifying User-Agent; pins the failure mode |
| `dhmz-7d.xml` | DHMZ hourly model output, ZAGREB-GRIČ and ZAGREB-MAKSIMIR, run 06 | `dhmz-hourly` slicing and parsing; the slice is dry |
| `dhmz-7d-rain.xml` | `dhmz-7d.xml` made wet by hand (not a saved response) | the rain rules of `dhmz-hourly`; in the ZAGREB-GRIČ block the steps of 29.09.2026. at 13 and 14 h carry oborina 0.6 with vjerojatnost 70 and oborina 2.4 with vjerojatnost 90, a leading comment says so, every other byte is `dhmz-7d.xml` |
| `hak-stanje.html` | HAK road state | `hak` parser (sections, "Ažurirano" times) |
| `hep-ods-bez-struje-today.html`, `hep-ods-bez-struje-tomorrow.html` | HEP ODS Elektra Zagreb outages for 29.09.2026 and 30.09.2026 | `prekidi` (electricity) parser |
| `vio-obavijesti.html` | Vodoopskrba i odvodnja notices | `prekidi` (water) parser |
| `osm-hours-overpass.json` | one Overpass query, 200 nodes with `opening_hours`, ODbL | `scripts/osm-hours.mjs --input` and the opening-hours evaluator |

Licences differ per source and are quoted in `sources-u3.json`: OpenStreetMap data is ODbL 1.0; kultura.zagreb.hr allows reuse with the source named and a link; HAK's terms allow relaying a limited selection with source, time and link but forbid scripted collection without written approval; DHMZ is recorded in the plan as an open licence with attribution; KGZ, Arena, HEP and VIO state nothing.
