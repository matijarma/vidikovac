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
| `emsc` | EMSC, FDSN event servis, potresi unutar 1,5° od Zagreba | https://www.seismicportal.eu/fdsnws/event/1/query?lat=45.81&lon=15.98&maxradius=1.5&format=json | EMSC terms | 60 / 3600 | Izvor: EMSC, seismicportal.eu |
| `hrt-news` | HRT, RSS Vijesti i Radio Sljeme (naslov, sažetak, poveznica) | https://feed.hrt.hr/vijesti/page.xml i https://feed.hrt.hr/sljeme/latest.xml | Tekst vijesti smije se preuzeti uz navođenje HRT-a i poveznicu na izvornik; audio i video su zabranjeni bez pisanog odobrenja i ne prikazuju se | 300 / 7200 | Izvor: HRT, {naslov}, poveznica na izvornik |
| `glasnik` | Grad Zagreb, Službeni glasnik Grada Zagreba, JSON API pristupnika (šifarnici, pretraga akata, puni tekst akta) | https://www1.zagreb.hr/sluzbeni-glasnik-gateway/api/v1/sifarnici | Službeni tekstovi akata; API nema objavljene uvjete, upit Gradskom uredu za digitalizaciju je zadatak M2; dijakritici se popravljaju na strani poslužitelja i to se označava kao prilagodba | 3600 / 604800 | Izvor: Službeni glasnik Grada Zagreba, {broj}/{godina}, akt {id} |
| `ckan-geo` | Grad Zagreb, prostorni slojevi (gradske četvrti, zborna mjesta civilne zaštite, ljekarne, vatrogasci, policija, javni zdenci, javni WC, knjižnice, muzeji) preko ArcGIS FeatureServera i CKAN API-ja | https://services8.arcgis.com/Usi0jGQwMmBUpFjr/arcgis/rest/services i https://data.zagreb.hr/api/3/action/package_show?id=prometnice | Otvorena dozvola (OD) | 86400 / 2592000 | Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup '{naziv}', posljednja izmjena {datum} |
| `dogadanja` | Šest izvora zagrebačkih događanja: Kulturpunkt (najave), Skupština Grada Zagreba (rokovnik sjednica), Kvartovske novosti (mjesna samouprava), Plan komunalnih aktivnosti, ZET (obavijesti), Etnografski muzej (događanja i izložbe) -- puni popis, uključujući dva izvora isključena zbog robots.txt (Guru za kulturu, YouTube Atom feed Skupštine), u odjeljku niže | https://kulturpunkt.hr/wp-json/wp/v2/kp_22_announcement (predstavnička adresa; svaki od šest izvora ima svoju, vidi worker/feed/modules/dogadanja/*.ts) | Više licenci (CC BY-SA 3.0 HR za Kulturpunkt, Otvorena dozvola za ostalih pet) | 900 / 86400 | Šest izvora zagrebačkih događanja: Kulturpunkt (CC BY-SA 3.0 HR), Skupština Grada Zagreba, kvartovske novosti, plan komunalnih aktivnosti i ZET (Otvorena dozvola), Etnografski muzej; licenca i poveznica navedeni uz svaku stavku prema polju "source" |

Pomoćni skup izvan modula: ZET statični GTFS https://www.zet.hr/gtfs-scheduled/latest (oko 15 MB) čita se lokalno skriptom `scripts/gtfs-routes.mjs` i pretvara u `app/src/data/zet-routes.json` (imena linija). Ista atribucija kao za `zet-rt`.

### Šest izvora modula `dogadanja`, pojedinačno

Redak `dogadanja` iznad predstavlja modul kao cjelinu jednom adresom; ovdje je puni popis, jedan redak po izvoru, s vlastitom adresom i licencom svakog. ZET-ova dva feeda i Etnografski muzejova dva REST krajnja tijela dijele po jedan redak jer dijele istu licencu i isti sub-fetcher (`worker/feed/modules/dogadanja/*.ts`); polje `data.source` koje svaka stavka nosi ima sedam vrijednosti (ZET-ova dva feeda imaju svaki svoju: `zet-novosti`, `zet-promet`), navedenih u zagradi uz svaki redak.

| Izvor | Adresa | Licenca |
|---|---|---|
| Kulturpunkt (najave), `source: kulturpunkt` | https://kulturpunkt.hr/wp-json/wp/v2/kp_22_announcement?_fields=id,link,title,excerpt,class_list,date&per_page=40&orderby=date&order=desc | CC BY-SA 3.0 HR |
| Skupština Grada Zagreba (rokovnik sjednica), `source: skupstina` | https://skupstina.zagreb.hr/rokovnik-sjednica/76 | Otvorena dozvola |
| Kvartovske novosti (mjesna samouprava), `source: kvartovske` | https://aktivnosti.zagreb.hr/kvartovske-novosti/134585 | Otvorena dozvola |
| Plan komunalnih aktivnosti, `source: komunalne` | https://data.zagreb.hr/dataset/fddb4f87-c002-4e3c-b988-adf013997ecc/resource/f90738b6-8bfa-4dd9-9db7-b3c532d90c97/download/data.json | Otvorena dozvola |
| ZET, obavijesti, `source: zet-novosti` / `zet-promet` | https://www.zet.hr/rss_novosti.aspx i https://www.zet.hr/rss_promet.aspx | Otvorena dozvola |
| Etnografski muzej (događanja i izložbe), `source: etnografski` | https://emz.hr/wp-json/wp/v2/dogadjanja?_fields=id,link,title,type,meta,class_list,date&per_page=20&orderby=date&order=desc i https://emz.hr/wp-json/wp/v2/izlozbe?_fields=id,link,title,type,meta,class_list,date&per_page=20&orderby=date&order=desc | Licenca nije navedena (muzej ne navodi uvjete ponovne uporabe; stavke ostaju isključivo u sesiji, nikad na `/open`) |

Dva izvora navedena u ranijem prijedlogu ostaju izvan modula, isključena zbog robots.txt (R-P5):

- **Guru za kulturu** (https://kultura.zagreb.hr/) -- njegovi podaci o događanjima dostupni su samo preko putanje `kultura.zagreb.hr/api/`, koju robots.txt te domene izričito zabranjuje (uz `_next/`). Ostatak domene je dopušten, ali bez `/api/` nema strojno čitljivih podataka za čitanje.
- **YouTube Atom feed kanala Skupštine Grada Zagreba**, na putanji `youtube.com/feeds/videos.xml`, koju YouTube-ov robots.txt također zabranjuje. Umjesto zabranjenog feeda, uz svaku sjednicu u prijenosu prikazuje se poveznica na sam kanal (https://www.youtube.com/channel/UCRMm4Xt9ruoQ8FG7NpIHCsA) -- poveznica (linking) nije isto što i dohvat (crawling), pa je to i dalje dopušteno i prikazuje se.

Izvedeni podatak, mrežni artefakt za model kretanja (area T, `docs/arhitektura.md` §"Model kretanja vozila"): `app/public/data/zet-network.json` gradi lokalno skripta `scripts/gtfs-shapes.mjs`, iz istog ZET statičnog GTFS-a gore (geometrija linija pojednostavljena Douglas-Peuckerom na 5 m, oktilinearni dijagram na 120 m, stajališta s pozicijom na svakoj liniji). Klijent ga dohvaća kao statičku datoteku tek nakon prvog iscrtavanja, nikad u lagano načinu (R-L4) -- nikad iz Workera i nikad pod `/open`, jer je riječ o građevnom artefaktu aplikacije, a ne o objavljenom skupu. Njegova verzija putuje s njim (`feedVersion`, generatorova oznaka verzije ZET-ova GTFS-a) i čita se bez dohvaćanja ili raspakiravanja artefakta iz `app/src/motion/network-meta.ts`, koju skripta prepisuje pri svakoj gradnji; trenutno: feedVersion `000395`, izgrađeno 2026-09-12, 154 linije, 542 147 bajtova. Ista atribucija kao `zet-rt`; nije modul iz `worker/feed/schema.ts` pa nema svoj redak ni TTL/maxStale gore.

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

Svaki modul u `worker/feed/schema.ts` nosi jednu od dvije razine (`tier`): **open** ili **session**. Samo ono što Vidikovac izvede iz *open*-razine modula (`prometnice`, `dhmz-cap`, `emsc`, `ckan-geo` -- na primjer zatvorene prometnice kao GeoJSON, sažeci meteoroloških upozorenja, sigurnosne točke) objavljuje se strojno čitljivo na `/open/*.json` pod Otvorenom dozvolom, s katalogom DCAT-AP na `/open/catalog.json` i dnevnim snimkama; time je ispunjen uvjet data.zagreb.hr "omogući dijeljenje pod sličnim uvjetima". **Session**-razina modula (`zet-rt`, `dhmz-now`, `dhmz-forecast`, `hrt-news`, `glasnik` i `dogadanja`) se na `/open` ne objavljuje nikako, ni djelomično -- ti podaci postoje samo unutar sesije koju otvara skeniranje.

Modul `dogadanja` je u cijelosti session razine, jer jedan od njegovih šest izvora, Kulturpunkt, nosi licencu CC BY-SA 3.0 HR koju bi republikacija na `/open` pogrešno prikazala kao Otvorenu dozvolu (a Etnografski muzej ne navodi nikakvu licencu za ponovnu uporabu, pa ni on ne smije napustiti sesiju). Iznimka koju treba čitati doslovno: pet njegovih izvora koji jesu pod Otvorenom dozvolom (Skupština Grada Zagreba, kvartovske novosti, plan komunalnih aktivnosti, ZET-ove obavijesti) ipak se uživo prikazuju na javnom zaslonu prije skeniranja, na kiosk kartici "Grad javlja" -- to je zaseban mehanizam od `/open/*.json` izvoza, ne republiciranje: ti retci se ondje ne arhiviraju niti nude za strojno preuzimanje, samo se prikažu na zaslonu i nestanu sljedećim osvježavanjem. Ni Kulturpunkt ni Etnografski muzej se na toj kartici nikad ne prikazuju.

Statistika korištenja (brojači bez identifikatora) isporučuje se Gradu Zagrebu pod posebnom licencom opisanom u `docs/prijava/prijedlog-projekta.md`; mi je ne objavljujemo.
