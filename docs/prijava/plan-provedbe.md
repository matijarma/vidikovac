# Plan provedbe

Trajanje: 10 mjeseci od potpisa ugovora, u cijelosti unutar Programa (do 31. 12. 2027.). Mjeseci su relativni prema potpisu (M1 = prvi mjesec nakon potpisa). M0 je gotov prije roka prijave i može se provjeriti u trenutku ocjenjivanja.

### M0 Prototip uživo (do 16. 9. 2026., prije potpisa)

Isporuke: https://zagreb.aningfilm.hr s otvorenim slojem `/hitno`, javnim zaslonom s rotirajućim kodom, skeniranjem s karticom potvrde, sesijom od deset minuta sa zamrzavanjem, pet izvora u stvarnom vremenu (upozorenja DHMZ-a, potresi, ZET, zatvorene prometnice, vrijeme) i tri u dnevnom ritmu (vijesti HRT-a, prognoza, gradski prostorni slojevi), stranice `/izvori`, `/privatnost`, `/pristupacnost`, javni repozitorij pod AGPL-3.0-or-later, Playwright testovi zeleni protiv produkcije, demo video. Mjera: definicija gotovog prototipa iz dizajnerske specifikacije.

### M1 Učvršćivanje protokola, izjave, prva revizija pristupačnosti (mjeseci 1 do 2)

Isporuke: dovršena provjera iste mreže u načinu enforce na stvarnim mrežama (kafić Wi-Fi, tri mobilna operatera, iPhone i Android), WASM rezervni skener za preglednike bez BarcodeDetectora, Turnstile iza zastavice, ograničenja po zaslonu (30 sesija na sat, 200 na dan), prva revizija pristupačnosti s korisnicima s invaliditetom i izjava o pristupačnosti v1 s deklariranim odstupanjem, izjava o privatnosti nakon pravnog pregleda. Mjera: revizijski izvještaj i dvije izjave objavljene na stranici.

### M2 Svi zeleni izvori u produkciji, pisma vlasnicima podataka (mjeseci 2 do 3)

Isporuke: hidrološki bilten, indeks zraka (INSPIRE WFS/WMS), HŽPP polasci prema voznom redu, Službeni glasnik s ispisom u PDF, Narodne novine (ELI), Europeana i NSK, Wikidata "na današnji dan", BAJS ako se GBFS izvor potvrdi; test za svaki parser prema spremljenom uzorku; pisma ZET-u (oznaka "samo za testiranje"), HRT-u (audio i video) i HAK-u (kamere), upit HŽPP-u o licenci, upit Gradu o uvjetima API-ja Službenog glasnika. Mjera: `/izvori` prikazuje sve zelene izvore sa statusom živo; kopije pisama u dokumentaciji.

### M3 Četiri zaslona instalirana, administracija zaslona (mjeseci 3 do 4)

Isporuke: zasloni u pilot kafiću, prostoru udruge, na lokaciji koju odabere Grad i na četvrtoj lokaciji; administracija zaslona (provizioniranje, opoziv, oznaka stanice, pregled dostupnosti) iza Cloudflare Accessa; tiskane upute za osoblje; `docs/kiosk.md` dopunjen iskustvom s terena. Mjera: četiri zaslona javljaju `kiosk_online` svakog dana u mjesecu 4.

### M4 Prvi skup podataka Gradu, ZGBit, javni katalog `/open` (mjesec 5)

Isporuke: prvi mjesečni CSV i JSON `(mjesec, dan, sat, događaj, dim1, dim2, broj)` s zaokruživanjem na 5 i sažimanjem ćelija ispod 10, uz tekst licence za Grad; prezentacija na ZGBit susretu; `/open/catalog.json` (DCAT-AP) s dnevnim snimkama u R2 i ponudom Gradu za objavu na data.zagreb.hr. Mjera: potvrda primitka Gradskog ureda; katalog validiran DCAT-AP validatorom.

### M5 Žuti izvori, sadržaj HRT-a i HAK-a ako je dopušten, izvještaj o pouzdanosti (mjeseci 6 do 8)

Isporuke: dežurne ljekarne, planirani prekidi HEP-a, Toplinarstva i VIO-a, peludni semafor, tekst HAK-a, sve s oznakom "neslužbeni prikaz" gdje je izvor HTML; ugradnja HRT-ovog ili HAK-ovog sadržaja samo ako pisano odobrenje stigne; prvi tromjesečni izvještaj o pouzdanosti izvora (postotak vremena živo, zastarjelo, nedostupno po izvoru) Gradskom uredu. Mjera: izvještaj dostavljen; svaki žuti izvor ima test i atribuciju.

### M6 Druga revizija pristupačnosti, izjava v2, javni izvještaj (mjesec 9)

Isporuke: druga revizija s korisnicima s invaliditetom na stvarnim zaslonima (knjižnica ili četvrt), ispravci, izjava o pristupačnosti v2; javni izvještaj o šest mjeseci rada (broj zaslona, sesija po četvrti i vrsti prostora, pouzdanost izvora, što nije uspjelo) na stranici projekta. Mjera: izjava v2 objavljena; izvještaj objavljen.

### M7 Završni izvještaj, inačica 1.0, paket za predaju (mjesec 10)

Isporuke: inačica 1.0 označena u repozitoriju; paket za predaju Gradu: kod pod EUPL-1.2, dokumentacija na hrvatskom, licenca skupa podataka, vodič za provizioniranje zaslona, popis izvora s uvjetima; završni sadržajni i financijski izvještaj prema ugovoru; dogovor o nastavku rada zaslona nakon projekta (trošak ispod 100 EUR godišnje, prostori zadržavaju zaslone). Mjera: izvještaj predan; paket zaprimljen.

## Tko što radi

| Uloga | M0 | M1 | M2 | M3 | M4 | M5 | M6 | M7 |
|---|---|---|---|---|---|---|---|---|
| Voditelj projekta i glavni razvoj (redak 1) | ● | ● | ● | ● | ● | ● | ● | ● |
| Drugi razvojni inženjer (redak 2) | | | ● | | | ● | | ● |
| Revizor pristupačnosti (redak 2) | | ● | | | | | ● | |
| UX i motion dizajner (redak 2) | | ● | | ● | | | | |
| Pravni i privacy pregled (redak 2) | | ● | | | ● | | | |
| Instalater zaslona (redak 2, redak 5) | | | | ● | | | | |
| Promidžba (redak 3) | ● | | | ● | ● | | ● | |
