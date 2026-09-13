# Plan provedbe

Trajanje: 10 mjeseci od potpisa ugovora, u cijelosti unutar Programa (do 31. 12. 2027.). Mjeseci su relativni prema potpisu (M1 = prvi mjesec nakon potpisa). M0 je gotov prije roka prijave i može se provjeriti u trenutku ocjenjivanja.

### M0 Prototip uživo (do 16. 9. 2026., prije potpisa)

Isporuke: evaluacijsko okruženje https://zagreb.aningfilm.hr s brendom Kaj ima?, sigurnošću bez sesije (`/hitno`), privremenim stvarnim zaslonima sa stajališnim kontekstom i rotirajućim kodom, uparivanjem na istoj i različitim mrežama, desetominutnim sesijama i petominutnim dijeljenjem. Sedam područja čita deset postojećih modula podataka; Karte koriste vlastiti regionalni vektorski izvadak. Stranice `/izvori`, `/privatnost`, `/pristupacnost`, otvoreni kod, pregled stvarno provedenih testova i demo video dio su prijavnog paketa. Mjera: Povjerenstvo može proći stvarno uparivanje i isprobati svako implementirano područje na telefonu, radnoj površini i zaslonu. Javna pilot-usluga kreće samo uz financiranje; evaluacijski pristup nije neovisno javno lansiranje.

### M1 Učvršćivanje protokola, izjave, prva revizija pristupačnosti (mjeseci 1 do 2)

Isporuke: terenska provjera uparivanja na istoj i različitim mrežama (kafić Wi-Fi, tri mobilna operatera, iPhone i Android), provjera rezervnog QR dekodera, Turnstile iza zastavice, provjera ograničenja po zaslonu, prva revizija pristupačnosti s korisnicima s invaliditetom i izjava o pristupačnosti v1 s deklariranim odstupanjem, izjava o privatnosti nakon pravnog pregleda. Ista mreža nije razlog odbijanja. Mjera: revizijski izvještaj i dvije izjave objavljene na stranici.

### M1b Lagani način rada za stare uređaje (mjesec 2)

Isporuke: lagani način zaslona bez karte, WebGL-a, `canvas` animacija i upitnika o spremniku, s prijelomnom točkom rasporeda u JavaScriptu; druga inačica koda prevedena za starije preglednike (cilj ES2017) uz postojeću modernu; automatsko prepoznavanje slabog uređaja i ručni prekidač `?lagano=1`; prva matrica testiranih uređaja u `docs/kiosk.md` s nazivom preglednika, vremenom učitavanja, potrošnjom u vatima i, gdje uređaj padne, razlogom. Mjera: zaslon radi na uređaju iz 2014. ili starijem i na tabletu iz 2015., uz manje od 200 kB prijenosa po učitavanju i manje od 300 MB radne memorije, izmjereno i objavljeno.

### M2 Svi zeleni izvori u produkciji, pisma vlasnicima podataka (mjeseci 2 do 3)

Isporuke: hidrološki bilten, indeks zraka (INSPIRE WFS/WMS), HŽPP polasci prema voznom redu, Službeni glasnik s ispisom u PDF, Narodne novine (ELI), Europeana i NSK, Wikidata "na današnji dan", BAJS ako se GBFS izvor potvrdi; test za svaki parser prema spremljenom uzorku; pisma ZET-u (oznaka "samo za testiranje"), HRT-u (audio i video) i HAK-u (kamere), upit HŽPP-u o licenci, upit Gradu o uvjetima API-ja Službenog glasnika. Mjera: `/izvori` prikazuje sve zelene izvore sa statusom živo; kopije pisama u dokumentaciji.

### M3 Šest zaslona instalirano, administracija zaslona (mjeseci 3 do 4)

Isporuke: zasloni u pilot kafiću, prostoru udruge, na lokaciji koju odabere Grad i na tri daljnje lokacije, od toga **četiri na doniranim uređajima** koje projekt pregleda, pripremi i ostavi prostoru; administracija zaslona (provizioniranje, opoziv, oznaka stanice, pregled dostupnosti) iza Cloudflare Accessa; tiskane upute za osoblje; `docs/kiosk.md` dopunjen iskustvom s terena i izmjerenom potrošnjom svakog uređaja. Mjera: šest zaslona javlja `kiosk_online` svakog dana u mjesecu 4; matrica uređaja sadrži šest stvarnih postava.

### M4 Prvi skup podataka Gradu, ZGBit, javni katalog `/open` (mjesec 5)

Isporuke: prvi mjesečni CSV i JSON `(mjesec, dan, sat, događaj, dim1, dim2, broj)` s zaokruživanjem na 5 i sažimanjem ćelija ispod 10, uz tekst licence za Grad; prezentacija na ZGBit susretu; `/open/catalog.json` (DCAT-AP) s dnevnim snimkama u R2 i ponudom Gradu za objavu na data.zagreb.hr. Mjera: potvrda primitka Gradskog ureda; katalog validiran DCAT-AP validatorom.

### M5 Žuti izvori, sadržaj HRT-a i HAK-a ako je dopušten, izvještaj o pouzdanosti (mjeseci 6 do 8)

Isporuke: dežurne ljekarne, planirani prekidi HEP-a, Toplinarstva i VIO-a, peludni semafor, tekst HAK-a, sve s oznakom "neslužbeni prikaz" gdje je izvor HTML; ugradnja HRT-ovog ili HAK-ovog sadržaja samo ako pisano odobrenje stigne; prvi tromjesečni izvještaj o pouzdanosti izvora (postotak vremena živo, zastarjelo, nedostupno po izvoru) Gradskom uredu. Mjera: izvještaj dostavljen; svaki žuti izvor ima test i atribuciju.

### M6 Druga revizija pristupačnosti, izjava v2, javni izvještaj (mjesec 9)

Isporuke: druga revizija s korisnicima s invaliditetom na stvarnim zaslonima (knjižnica ili četvrt), ispravci, izjava o pristupačnosti v2; javni izvještaj o šest mjeseci rada (broj zaslona, sesija po četvrti i vrsti prostora, pouzdanost izvora, što nije uspjelo) na stranici projekta. Mjera: izjava v2 objavljena; izvještaj objavljen.

### M7 Završni izvještaj, inačica 1.0, paket za predaju (mjesec 10)

Isporuke: inačica 1.0 označena u repozitoriju; paket za predaju Gradu: kod pod EUPL-1.2, dokumentacija na hrvatskom, licenca skupa podataka, vodič za provizioniranje zaslona, popis izvora s uvjetima; završni sadržajni i financijski izvještaj prema ugovoru; dogovor o nastavku rada zaslona nakon projekta (trošak ispod 100 EUR godišnje, prostori zadržavaju zaslone). Mjera: izvještaj predan; paket zaprimljen.

## Tko što radi

| Uloga | M0 | M1 | M1b | M2 | M3 | M4 | M5 | M6 | M7 |
|---|---|---|---|---|---|---|---|---|---|
| Voditelj projekta i glavni razvoj (redak 1) | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| Drugi razvojni inženjer (redak 2) | | | ● | ● | | | ● | | ● |
| Revizor pristupačnosti (redak 2) | | ● | | | | | | ● | |
| UX i motion dizajner (redak 2) | | ● | ● | | ● | | | | |
| Pravni i privacy pregled (redak 2) | | ● | | | | ● | | | |
| Instalater zaslona (redak 2, redak 5) | | | | | ● | | | | |
| Promidžba (redak 3) | ● | | | | ● | ● | | ● | |
