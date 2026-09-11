# Izvori podataka, licence i atribucija

Ovaj popis je jedini izvor istine o tome odakle Vidikovac uzima podatke, pod kojim uvjetima i kako ih navodi. Svaki modul iz `worker/feed/schema.ts` (`ModuleId`) ima točno jedan red u prvoj tablici; `worker/feed/registry.ts` mora se s njom slagati, a `npm run check:izvori` provjerava da svaka poveznica odgovara i da nijedan modul nije izostavljen. Vremena su u sekundama: **TTL** je koliko dugo se živi snimak servira iz predmemorije prije ponovnog dohvata, **maxStale** koliko dugo se posljednja dobra kopija iz KV-a još smije prikazati kao "zastarjelo" prije nego što modul postane "nedostupno".

## Moduli u prototipu (zeleni izvori: otvorena licenca, strojno čitljivo, bez ključa)

| Modul | Izvor i skup | Adresa | Licenca | TTL / maxStale | Atribucija (doslovno) |
|---|---|---|---|---|---|
| `zet-rt` | ZET, GTFS-Realtime (protobuf: položaji vozila, kašnjenja) | https://www.zet.hr/gtfs-rt-protobuf | Otvorena dozvola; ZET feed označava "SAMO ZA POTREBE TESTIRANJA" (pismo ZET-u je zadatak M2) | 30 / 300 | Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669 |
| `prometnice` | Grad Zagreb, data.zagreb.hr, skup "Zatvaranje prometnica na području Grada Zagreba" (JSON, osvježava se svake 3 minute) | https://data.zagreb.hr/dataset/7ff5514d-0a1f-4f6c-86bd-8ed9a3c55eee/resource/e48b6992-add0-45a1-ae95-c5d97d8db259/download/data.json | Otvorena dozvola (OD), http://data.gov.hr/otvorena-dozvola | 180 / 1800 | Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba', posljednja izmjena {datum} |
| `dhmz-now` | DHMZ, trenutna mjerenja (postaja Zagreb-Maksimir) | https://vrijeme.hr/hrvatska1_n.xml | Otvorena dozvola | 600 / 7200 | Izvor: DHMZ, Otvorena dozvola, {vrijeme} |
| `dhmz-forecast` | DHMZ, prognoza za danas (redak Zagreb i tekst `zg_text`) | https://prognoza.hr/prognoza_danas.xml | Otvorena dozvola | 1800 / 86400 | Izvor: DHMZ, Otvorena dozvola, {vrijeme} |
| `dhmz-cap` | DHMZ, upozorenja u formatu CAP 1.2 (područje "Zagrebačka regija", EMMA_ID HR002) | https://meteo.hr/upozorenja/cap_hr_today.xml | Otvorena dozvola | 300 / 7200 | Izvor: DHMZ, Otvorena dozvola, {vrijeme} |
| `emsc` | EMSC, FDSN event servis, potresi unutar 1,5° od Zagreba | https://www.seismicportal.eu/fdsnws/event/1/query?lat=45.81&lon=15.98&maxradius=1.5&format=json | Uvjeti EMSC-a: slobodno korištenje uz navođenje izvora | 60 / 3600 | Izvor: EMSC, seismicportal.eu |
| `hrt-news` | HRT, RSS Vijesti i Radio Sljeme (naslov, sažetak, poveznica) | https://feed.hrt.hr/vijesti/page.xml i https://feed.hrt.hr/sljeme/latest.xml | Tekst vijesti smije se preuzeti uz navođenje HRT-a i poveznicu na izvornik; audio i video su zabranjeni bez pisanog odobrenja i ne prikazuju se | 300 / 7200 | Izvor: HRT, {naslov}, poveznica na izvornik |
| `glasnik` | Grad Zagreb, Službeni glasnik Grada Zagreba, JSON API pristupnika (šifarnici, pretraga akata, puni tekst akta) | https://www1.zagreb.hr/sluzbeni-glasnik-gateway/api/v1/sifarnici | Službeni tekstovi akata; API nema objavljene uvjete, upit Gradskom uredu za digitalizaciju je zadatak M2; dijakritici se popravljaju na strani poslužitelja i to se označava kao prilagodba | 3600 / 604800 | Službeni glasnik Grada Zagreba {broj}/{godina}, akt {id} |
| `ckan-geo` | Grad Zagreb, prostorni slojevi (gradske četvrti, zborna mjesta civilne zaštite, ljekarne, vatrogasci, policija, javni zdenci, javni WC, knjižnice, muzeji) preko ArcGIS FeatureServera i CKAN API-ja | https://services8.arcgis.com/Usi0jGQwMmBUpFjr/arcgis/rest/services i https://data.zagreb.hr/api/3/action/package_show?id=prometnice | Otvorena dozvola (OD) | 86400 / 2592000 | Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup '{naziv}', posljednja izmjena {datum} |

Pomoćni skup izvan modula: ZET statični GTFS https://www.zet.hr/gtfs-scheduled/latest (oko 15 MB) čita se lokalno skriptom `scripts/gtfs-routes.mjs` i pretvara u `app/src/data/zet-routes.json` (imena linija). Ista atribucija kao za `zet-rt`.

## Izvori planirani za financirano razdoblje

| Izvor | Adresa | Stanje | Licenca ili uvjet | Kako ćemo ga navesti |
|---|---|---|---|---|
| DHMZ hidrološki bilten (vodostaj Save) | https://hidro.hr/hidro_bilten.xml | zeleno, XML potvrđen 11. 9. 2026. | Otvorena dozvola | Izvor: DHMZ, Otvorena dozvola, {vrijeme} |
| Hrvatska agencija za okoliš i prirodu, indeks kvalitete zraka (INSPIRE WFS/WMS) | https://iszz.azo.hr/iskzl/ | zeleno, bez ograničenja pristupa; JSON izvoz vraćao prazne nizove 11. 9. | navesti izvor | Izvor: Hrvatska agencija za okoliš i prirodu (iszz.azo.hr) |
| HŽ Putnički prijevoz, statični GTFS | https://www.hzpp.hr/GTFS_files.zip | zeleno, licenca nije navedena na data.gov.hr; upit je zadatak M2 | upit poslan | Izvor: HŽ Putnički prijevoz, GTFS (data.gov.hr); licenca nije navedena, upit poslan |
| Narodne novine, dokumentirani API (ELI) | https://narodne-novine.nn.hr/nn_api_hr.aspx | zeleno, najviše 3 zahtjeva u sekundi | službeni tekstovi | {ELI} |
| Plan komunalnih aktivnosti, data.zagreb.hr | https://data.zagreb.hr/dataset/fddb4f87-c002-4e3c-b988-adf013997ecc/resource/f90738b6-8bfa-4dd9-9db7-b3c532d90c97/download/data.json | zeleno, dnevno | Otvorena dozvola | Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Plan komunalnih aktivnosti', posljednja izmjena {datum} |
| Europeana API (baština Zagreba) | https://api.europeana.eu/ | zeleno, ključ potreban, metapodaci CC0 | prava svakog djela zasebno | Metapodaci: Europeana, CC0; djelo: {rights statement} |
| Digitalne zbirke NSK | https://digitalna.nsk.hr/ | zeleno za djela u javnom vlasništvu | navesti NSK | Digitalne zbirke Nacionalne i sveučilišne knjižnice u Zagrebu |
| HAK, stanje na cestama (tekst) | https://www.hak.hr/info/stanje-na-cestama/ | žuto: HTML, dopušteno prenošenje uz izvor, poveznicu i izvorno vrijeme, samo u besplatnim proizvodima | tekst samo | Izvor: HAK, stanje na cestama, {izvorni timestamp} |
| HEP ODS, planirani radovi bez struje | https://www.hep.hr/ods/ostalo/poveznice/bez-struje/19 | žuto: HTML tablica, uvjeti nisu pregledani | neslužbeni prikaz | Izvor: HEP ODS, {datum}; neslužbeni prikaz |
| Dežurne ljekarne Grada Zagreba | https://www.zagreb.hr/dezurne-ljekarne/497 | žuto: ručno održavan HTML | neslužbeni prikaz | Izvor: Grad Zagreb, dežurne ljekarne; neslužbeni prikaz |
| Peludna prognoza, NZJZ "Dr. Andrija Štampar" | https://stampar.hr/ | žuto: HTML | neslužbeni prikaz | Izvor: NZJZ "Dr. Andrija Štampar"; neslužbeni prikaz |
| SkylineWebcams, Trg bana Jelačića (fotogram svakih 5 minuta) | https://www.skylinewebcams.com/ | žuto: ugradnja dopuštena uz njihov kredit | kredit prema uvjetima ugradnje | prema uvjetima SkylineWebcams |
| Index.hr, RSS Zagreb; ZGportal | https://www.index.hr/rss/vijesti-zagreb | žuto: uvjeti nisu navedeni | naslov i poveznica samo | naslov + poveznica |

Crveni izvori, ne prikazuju se dok ne dobijemo pisano odobrenje ili dok podaci ne postanu otvoreni: HRT audio i video, HAK kamere, Zračna luka Zagreb, Zagrebparking (zahtjev 368 na data.gov.hr), ELEN punionice, MUP prometni događaji, JVP intervencije, SRUUK, Čistoća rasporedi, zakon.hr. HINA se nikada ne preuzima.

## Kako navodimo izvore

Atribucija se prikazuje na četiri mjesta i nikad se ne izostavlja: (1) u podnožju svakog panela, s izvorom, licencom, poveznicom i vremenom "ažurirano"; (2) na stranici `/izvori`, koja se generira iz ovog popisa; (3) u rotaciji podnožja na javnim zaslonima; (4) na početku svakog izvoza (kopiranje, ICS, GeoJSON, PDF). Prema Otvorenoj dozvoli (NN 67/17) navodi se izvor i datum posljednje izmjene kako ga je tijelo označilo, prilagodbe se označavaju (na primjer "prilagođeno: geometrija pretvorena u GeoJSON"), a ništa ne smije sugerirati službeno odobrenje tijela. Žuti izvori nose oznaku "neslužbeni prikaz".

## Izvedeni podaci

Sve što Vidikovac izvede iz gornjih izvora (na primjer zatvorene prometnice kao GeoJSON, sažeci upozorenja, stanje izvora) objavljuje se na `/open/*.json` pod Otvorenom dozvolom, s katalogom DCAT-AP na `/open/catalog.json` i dnevnim snimkama. Time je ispunjen uvjet data.zagreb.hr "omogući dijeljenje pod sličnim uvjetima". Statistika korištenja (brojači bez identifikatora) isporučuje se Gradu Zagrebu pod posebnom licencom opisanom u `docs/prijava/prijedlog-projekta.md`; mi je ne objavljujemo.
