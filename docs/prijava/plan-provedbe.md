# Plan provedbe

Trajanje: 10 mjeseci od potpisa ugovora, u cijelosti unutar Programa (do 31. 12. 2027.). Mjeseci su relativni prema potpisu (M1 = prvi mjesec nakon potpisa). M0 je gotov prije roka prijave i može se provjeriti u trenutku ocjenjivanja.

### M0 Prototip uživo (javno od 14. 9. 2026., izvorni kod od 15. 9. 2026., prije potpisa)

Isporuke: javno dostupan prototip https://zagreb.aningfilm.hr s brendom Kaj ima?, sigurnošću bez sesije (`/hitno`), privremenim stvarnim zaslonima koje svatko postavi na `/kiosk/` sa stajališnim kontekstom i rotirajućim kodom, uparivanjem na istoj i različitim mrežama, desetominutnim sesijama i petominutnim dijeljenjem. Sedam područja čita deset postojećih modula podataka; karte koriste vlastiti regionalni vektorski izvadak. Stranice `/izvori`, `/privatnost`, `/pristupacnost` i `/open/`, javni repozitorij izvornog koda (od 15. rujna 2026.) i pregled stvarno provedenih testova dio su prijavnog paketa. Mjera: Povjerenstvo može proći stvarno uparivanje i isprobati svako implementirano područje na telefonu, radnoj površini i zaslonu. Javna pilot-usluga na zaslonima u prostorima kreće samo uz financiranje; javno dostupan prototip nije neovisno javno lansiranje.

### M1 Učvršćivanje protokola, izjave, prva revizija pristupačnosti (mjeseci 1 do 2)

Isporuke: terenska provjera uparivanja na istoj i različitim mrežama (kafić Wi-Fi, tri mobilna operatera, iPhone i Android), provjera rezervnog QR dekodera, Turnstile iza zastavice, provjera ograničenja po zaslonu, prva revizija pristupačnosti s korisnicima s invaliditetom i izjava o pristupačnosti v1 s deklariranim odstupanjem, izjava o privatnosti nakon pravnog pregleda. Ista mreža nije razlog odbijanja. Mjera: revizijski izvještaj i dvije izjave objavljene na stranici.

### M1b Lagani način rada za stare uređaje (mjesec 2)

Isporuke: lagani način zaslona bez karte, WebGL-a i `canvas` animacija, s rasporedom koji ne ovisi o novijim CSS mogućnostima (postojeći `?lagano=1` i automatsko prepoznavanje slabog uređaja se dorađuju); druga inačica koda prevedena za starije preglednike bez podrške za ES module (cilj prijevoda ES2017) uz postojeću modernu; prva matrica testiranih uređaja u `docs/kiosk.md` s nazivom preglednika, vremenom učitavanja, potrošnjom u vatima i, gdje uređaj padne, razlogom. Mjera: zaslon radi na najmanje četiri stvarna stara ili donirana uređaja različitih klasa (prijenosnik, tablet, Android TV kutija, Raspberry Pi) uz manje od 200 kB prijenosa po učitavanju i manje od 300 MB radne memorije, izmjereno i objavljeno; uređaj koji padne ostaje u matrici s razlogom.

### M2 Svi zeleni izvori u produkciji, pisma vlasnicima podataka (mjeseci 2 do 3)

Isporuke: hidrološki bilten (vodostaj Save), indeks zraka (INSPIRE WFS/WMS), dolasci po stajalištu iz GTFS-RT-a, HŽPP polasci prema voznom redu, Narodne novine (ELI), otvorena savjetovanja Grada, Europeana i NSK, Wikidata "na današnji dan", BAJS ako se GBFS izvor potvrdi, prostorni slojevi Grada (ljekarne, vatrogasci, policija, javni zdenci, javni zahodi, knjižnice, muzeji, parkovi, biciklističke staze); test za svaki parser prema spremljenom uzorku; pisma ZET-u (oznaka "samo za testiranje" na GTFS-RT izvoru i uvjeti RSS-a), HRT-u (audio i video te potvrda prikaza naslova s poveznicom na javnim zaslonima) i HAK-u (kamere), upit HŽPP-u o licenci, upit Gradskom uredu o uvjetima API-ja Službenog glasnika i uvjetima korištenja zagreb.hr, upit Etnografskom muzeju o licenci. Mjera: `/izvori` prikazuje sve zelene izvore sa statusom živo; kopije pisama u dokumentaciji.

### M3 Šest zaslona instalirano, administracija zaslona (mjeseci 3 do 4)

Isporuke: zasloni u pilot kafiću, prostoru udruge, na lokaciji koju odabere Grad i na tri daljnje lokacije, od toga **četiri na doniranim uređajima** koje projekt pregleda, pripremi i ostavi prostoru; operatersko sučelje za trajne zaslone (provizioniranje bez roka, opoziv, oznaka stanice, pregled dostupnosti) zaštićeno prijavom, uz javnu samoposlugu privremenih zaslona na `/kiosk/`; tiskane upute za osoblje; `docs/kiosk.md` dopunjen iskustvom s terena i izmjerenom potrošnjom svakog uređaja. Prijavitelj predlaže lokacije, a Grad odabire najmanje jednu do kraja drugog mjeseca; ako izbor izostane, zaslon ide u gradsku knjižnicu ili prostor udruge uz naknadnu zamjenu. Na lokaciji koju odabere Grad postavlja se nova postava Raspberry Pi 5 s tekućim sustavom; donirani uređaji idu u ostale prostore, na gostujuću mrežu odvojenu od poslovne. Mjera: šest zaslona javlja `kiosk_online` svakog dana u mjesecu 4; matrica uređaja sadrži šest stvarnih postava.

### M4 Prvi skup podataka Gradu, ZGBit, javni katalog `/open` (mjesec 5)

Isporuke: prvi mjesečni CSV i JSON `(mjesec, dan, sat, događaj, dim1, dim2, broj)` s zaokruživanjem na 5 i sažimanjem ćelija ispod 10, uz tekst licence za Grad; prezentacija na ZGBit susretu; `/open/catalog.json` (DCAT-AP) s dnevnim snimkama u R2, ispravljenom licencom skupa EMSC-a i ponudom Gradu za objavu skupova Grada i DHMZ-a na data.zagreb.hr; statička stranica "pogled izvana" s kartom javnih zaslona, na koju podijeljena poveznica vodi osobu bez sesije. Mjera: potvrda primitka Gradskog ureda; katalog validiran DCAT-AP validatorom; stranica "pogled izvana" objavljena.

### M5 Žuti izvori, sadržaj HRT-a i HAK-a ako je dopušten, izvještaj o pouzdanosti (mjeseci 6 do 8)

Isporuke: dežurne ljekarne, planirani prekidi HEP-a, Toplinarstva i VIO-a, peludni semafor, tekst HAK-a, sve s oznakom "neslužbeni prikaz" gdje je izvor HTML; fotogram Trga bana Jelačića ako HAK pisano odobri; ugradnja HRT-ovog ili HAK-ovog sadržaja samo ako pisano odobrenje stigne; prvi izvještaj o pouzdanosti izvora (postotak vremena živo, zastarjelo, nedostupno po izvoru), za prvo tromjesečje rada zaslona, Gradskom uredu. Mjera: izvještaj dostavljen; svaki žuti izvor ima test i atribuciju.

### M6 Druga revizija pristupačnosti, izjava v2, javni izvještaj (mjesec 9)

Isporuke: druga revizija s korisnicima s invaliditetom na stvarnim zaslonima (knjižnica ili četvrt), ispravci, izjava o pristupačnosti v2; javni izvještaj o šest mjeseci rada (broj zaslona, sesija po četvrti i vrsti prostora, pouzdanost izvora, što nije uspjelo) na stranici projekta. Mjera: izjava v2 objavljena; izvještaj objavljen.

### M7 Završni izvještaj, inačica 1.0, paket za predaju (mjesec 10)

Isporuke: inačica 1.0 označena u repozitoriju; paket za predaju Gradu: kod pod EUPL-1.2, dokumentacija na hrvatskom, licenca skupa podataka, vodič za provizioniranje zaslona, popis izvora s uvjetima; drugi izvještaj o pouzdanosti izvora, za drugo tromjesečje rada zaslona; završni sadržajni i financijski izvještaj prema ugovoru; dogovor o nastavku rada zaslona nakon projekta (trošak ispod 100 EUR godišnje, prostori zadržavaju zaslone). Mjera: izvještaj predan; paket zaprimljen.

## Tko što radi

| Uloga | M0 | M1 | M1b | M2 | M3 | M4 | M5 | M6 | M7 |
|---|---|---|---|---|---|---|---|---|---|
| Voditelj projekta i glavni razvoj (redak 1) | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| Drugi razvojni inženjer (redak 2) | | | ● | ● | | | ● | | ● |
| Revizor pristupačnosti (redak 2) | | ● | | | | | | ● | |
| UX i motion dizajner (redak 2) | | ● | ● | | ● | | | | |
| Pravni i privacy pregled (redak 2) | | ● | | | | ● | | | |
| Instalater zaslona (redak 2, redak 5) | | | | | ● | | | | |
| Promidžba (redak 3) | | | | | ● | ● | | ● | |
