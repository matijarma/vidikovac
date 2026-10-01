# Source fixtures for the more-city package (R3)

Saved on 1 Oct 2026 between 02:07:21 and 02:07:57 UTC, one request per URL, sequentially with pauses of 1.5 s, with the product's own User-Agent (`Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)`, `worker/feed/http.ts`). The tests never call these hosts. robots.txt answers 404 on vrijeme.hr, prognoza.hr and plinara-zagreb.hr (recorded on 30 Sep 2026, `review.local/reveal/analysis/sources.md`); DHMZ's terms (NN 66/19, art. 17) allow reuse with "Izvor: DHMZ"; Gradska plinara Zagreb states no terms (none seen). The HTML pages keep the server's CRLF line endings (`.gitattributes` marks them `-text`).

"Served" is the response body's size and sha256; "saved" is the file here. Where they differ the file is edited, and an XML comment right after its declaration says how.

| File | URL | Fetched (UTC) | Served bytes, sha256 | Saved |
|---|---|---|---|---|
| `radar/kompozit-20261001T020410Z.png` | https://vrijeme.hr/kompozit-stat.png | 02:07:21 | 381,146, `925e4c28d77d10062fa0103294b8841c528f8e10295f37267995bb2ea5cb9324` | as served (`radar/README.md`) |
| `bio_novo.xml` | https://prognoza.hr/bio_novo.xml | 02:07:22 | 1,262, `c53f7bd70c4d61e4f9482922b64146ddaf434c398747a98a94a1b1d3e2d36771` | 1,656, `fd736bcf6cb87405c45eb2f861ed47e4d826bfcfdf3dfcebd73300c0711e6219`: a comment added, nothing else; two days (01.10, 02.10) |
| `hladnival-stale.xml` | https://prognoza.hr/hladnival.xml | 02:07:24 | 1,921, `19ee2aca5a59cd54a28ac72b5becc661abe636b6455377d590c7f66530028a0d` | as served (last filled 24 Feb 2026, every value W) |
| `hladnival.xml` | the same response | 02:07:24 | as above | 2,188, `93e56286780f9d4d0ab9c935e59c705b950c932f67d2c3761c191fe9bce4608c`: datatime, creationtime and Zagreb's four values edited |
| `toplinskival_5-empty.xml` | https://prognoza.hr/toplinskival_5.xml | 02:07:25 | 306, `9add60351a98de81f67285ac522436f6a9132bd8d66b549779eea17c9ccbce7c` | as served (an empty section) |
| `toplinskival_5.xml` | the same response, plus https://web.archive.org/web/20241111204612id_/https://prognoza.hr/toplinskival_5.xml (the file of 13 Sep 2024) | 02:07:25 and 02:07:57 | archive copy 2,186, `e227a135f908b1c2d6e15185683a71af5c1b4771f2868eb1b1948b25c8acb466` | 2,649, `7f77970ce3abd897518ab47757d2d2ea3ee8fb5e2019f24aa07f2f85c405ff07`: filled with the archive's eight stations, the dates of 30 Sep 2026 and Zagreb Y, O, R, Y, G |
| `gpz-novosti.html` | https://www.plinara-zagreb.hr/novosti/50 | 02:07:27 | 23,807, `d2410d764d10715f0b352de023ec1616c2be2f4c634466c55a70da07e2fb0667` | as served |
| `gpz-obavijest-1576.html` | https://www.plinara-zagreb.hr/ostalo/novosti/obavijst-obustava-ntp-kajfesov-brijeg/1576 | 02:07:47 | 22,924, `60a1b2cfe48f67d660b9eba9523b518ce68966c414e094ffc20b2130b3acd3d3` | as served |
| `gpz-obavijest-1577.html` | https://www.plinara-zagreb.hr/ostalo/novosti/obavijest-ntp-selska/1577 | 02:07:49 | 22,965, `2660107b20123bca436f0dc53c30b4354418f01ce69ea27a355718e04796ab10` | as served |
| `gpz-obavijest-1579.html` | https://www.plinara-zagreb.hr/ostalo/novosti/obavijest-ntp-selska/ntp-selska-1-etapa-etapa-1-5-faza-2/1579 (the child link on 1577) | 02:07:55 | 23,268, `de6e53ac420850dedecdccee6810e9d8764ca164c259eadb854eea7fa40df29f` | as served |

The list still showed 1576 and 1577 on 1 October, so both were fetched from the list's own links. The wave files declare ISO-8859-1 but carry one UTF-8 "ö" in the `creator` attribute; the module decodes them as windows-1252 and reads nothing from that attribute.
