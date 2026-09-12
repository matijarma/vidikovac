# Prijedlog projekta: Vidikovac. Zagreb, povezan.

**Prijavitelj:** Aning Film d.o.o., [[POPUNITI: adresa sjedišta]], OIB [[POPUNITI: OIB]]. Zakonski zastupnik: Matija Radeljak, direktor.
**Javni poziv:** za dodjelu potpora male vrijednosti za financiranje projekata korištenja otvorenih podataka za 2026.
**Zatraženi iznos:** 20.000,00 EUR (bez PDV-a). **Trajanje:** 10 mjeseci od potpisa ugovora, unutar 31. 12. 2027.
**Prototip:** https://zagreb.aningfilm.hr · **Izvorni kod:** https://github.com/matijarma/vidikovac (AGPL-3.0-or-later) · **Video (90 s):** [[POPUNITI: poveznica na video nakon 15. 9.]]

## Sažetak

Vidikovac je pogled na Zagreb u stvarnom vremenu, izgrađen isključivo na otvorenim podacima Grada Zagreba, ZET-a, DHMZ-a, EMSC-a i drugih javnih izvora, koji se otključava na deset minuta skeniranjem rotirajućeg QR koda s javnog zaslona u kafiću, knjižnici, uredu gradske četvrti ili prostoru udruge, ili na pet minuta s telefona druge osobe koja ga upravo gleda. Nitko ništa ne plaća, ni novcem ni pažnjom. Ograničenje nije cijena nego svrha: da bi se pogled otključao, treba doći do zaslona u prostoru ili do druge osobe koja ga upravo gleda, a nakon deset minuta sesija sama završi i vrati čovjeka u grad. Vidikovac je namjerno dobar koliko treba da zamijeni beskrajno listanje, i namjerno kratak koliko treba da to ne postane. Sigurnosni sloj (upozorenja DHMZ-a, potresi, zatvorene prometnice, dežurne ljekarne, zborna mjesta civilne zaštite, planirani prekidi) otvoren je svima, bez skeniranja i bez ograničenja trajanja. Javni zasloni su čitljivi i bez telefona. Zaslon ne mora biti nova oprema: aplikacija se ne instalira, radi u pregledniku i u laganom načinu rada drži uređaje stare deset godina, pa stari prijenosnik, tablet ili televizor s odbačenom Android kutijom postaje gradski zaslon umjesto da postane elektronički otpad. Sav kod je otvoren, svi izvedeni podaci su otvoreni, a Grad Zagreb mjesečno dobiva anonimne, identifikatorima neopterećene zbrojeve korištenja po satu, četvrti i vrsti prostora, kao podatak o potražnji za gradskim informacijama koji danas ne postoji. Prototip je javno dostupan prije roka prijave.

## 1. Popis funkcionalnosti

### 1.1 Otvoreni sloj, dostupan svima bez skeniranja

Stranica `/hitno` prikazuje se bez JavaScripta, na svakom uređaju i u svakom pregledniku, i može se ispisati: važeća upozorenja DHMZ-a za Zagrebačku regiju riječima i oblikom (nikad samo bojom), potresi u posljednja 72 sata u krugu od 150 km (EMSC), vodostaj Save iz hidrološkog biltena, brojevi za hitne slučajeve (provjereni prema službenoj stranici), dežurne ljekarne, zborna mjesta civilne zaštite, javni zdenci i javni zahodi, trenutno zatvorene prometnice, planirani prekidi struje, toplinske energije i vode (označeni kao neslužbeni prikaz) i tekst HAK-a o stanju na cestama s izvornim vremenom. Isti sloj identičan je unutar otključane sesije.

### 1.2 Javni zaslon (Prozor), čitljiv bez telefona

Zaslon bez dodira prikazuje sigurnosnu traku uz donji rub (stanje upozorenja, zatvorene prometnice u blizini, najbliža dežurna ljekarna) i iznad nje izmjenu kartica svakih 20 sekundi: vrijeme sada, sljedeći polasci na stanici prostora, zrak na najbližoj postaji, jedan naslov HRT-a s izvorom, jedna arhivska slika Zagreba s atribucijom i pozivna kartica "Skeniraj za 10 minuta grada. Manje ekrana, više Zagreba." QR kod rotira svakih 30 sekundi, vidljivi brojač pokazuje koliko je ostalo do sljedećeg koda, kod je ispisan u dvije skupine za čitanje naglas ili tipkanje, a podnožje rotira izvore podataka. Zaslon s dodirom nosi i vlastiti gumb "Osnovno": jedan dodir otvara sigurnosni sloj, sljedeće polaske sa stanice tog zaslona, vrijeme i zatvorene prometnice, bez skeniranja, bez sesije i bez odbrojavanja, a nakon devedeset sekundi bez dodira zaslon se vraća na poziv. Gradski zaslon ne smije uskratiti informaciju čovjeku koji nema telefon za skeniranje; skeniranje otključava grad na vlastitom uređaju, a ne oduzima ga zaslonu pred kojim čovjek stoji. Tema je tamna nakon zalaska i svijetla danju, prema izračunatim vremenima sunca, uz mogućnost da prostor odabere. Nakon skeniranja zaslon prikazuje sloj koji gleda osoba koja ga vodi, u rasporedu za velike zaslone (tijelo najmanje 40 px, naslovi 72 px na 1080p).

### 1.3 Otključana nadzorna ploča (Ruka na telefonu, Stol na radnoj površini)

Sedam slojeva, svaki s oznakom svježine (Živo ispod 5 minuta, Danas, Referenca) i atribucijom u podnožju svakog panela:

- **Grad sada:** sat, mjerenje s postaje Zagreb-Maksimir, prognoza i tekst za Zagreb, stanje CAP upozorenja, broj ZET vozila u pokretu, broj aktivnih zatvaranja, peludni semafor, fotogram Trga bana Jelačića.
- **U pokretu:** karta ZET vozila u stvarnom vremenu s imenima linija, polasci sa stanice koju osoba odabere (lokacija ostaje na telefonu), zatvorene prometnice kao linije na karti, tekst HAK-a s atribucijom, polasci HŽPP-a prema voznom redu, poveznica na zračnu luku, BAJS ako se otvoreni GBFS izvor potvrdi.
- **Zrak i nebo:** indeks kvalitete zraka po postaji, prognoza, upozorenja, pelud, potresi u krugu od 1,5° u sedam dana, vodostaj Save, izlazak i zalazak sunca izračunati na uređaju.
- **Sigurnost:** otvoreni sloj, identičan.
- **Uprava i pravo:** najnoviji akti Službenog glasnika Grada Zagreba s popravljenim dijakriticima i ispisom u PDF, najnovija izdanja Narodnih novina (ELI), sljedeća sjednica Gradske skupštine s prijenosom, otvorena savjetovanja, plan komunalnih aktivnosti.
- **Kultura i sjećanje:** baština Zagreba iz Europeane i Digitalnih zbirki NSK s atribucijom, knjižnice i muzeji iz gradskih prostornih slojeva, događanja s atribucijom i poveznicom, "na današnji dan" iz Wikidate; program HRT-a i radija kao tekst s poveznicom na njihov vlastiti player, nikad ugrađeno.
- **Vijesti:** HRT i Radio Sljeme kao tekst s izvorom i poveznicom, ostali portali samo naslov i poveznica; HINA se ne preuzima.

### 1.4 Uparivanje bez računa, bez aplikacije i bez kolačića

Telefon skenira QR kod vlastitom kamerom; otvara se stranica koja prikazuje karticu potvrde ("Zaslon: kafić, Donji grad, 10 minuta") i gumb Otključaj. Kod je jednokratan, vrijedi 30 sekundi uz kratku toleranciju, a poslužitelj odbija skeniranje s telefona koji je na istoj mreži kao zaslon ("Ovaj zaslon i tvoj telefon dijele istu mrežu. Isključi Wi-Fi i skeniraj mobilnim podacima."), čime se dokazuje fizička prisutnost. Kod se uvijek može i utipkati, što je put za osobe koje ne mogu koristiti kameru. Osoba u sesiji može pritisnuti "Podijeli grad" i dati drugoj osobi pet svježih minuta s vlastitog telefona (jedan skok, bez lančanja).

### 1.5 Istek sesije koji ništa ne gubi

Šezdeset i dvadeset sekundi prije kraja prikazuje se upozorenje (i čita čitaču zaslona). Istekom se prikaz zamrzne kao statička, atribuirana snimka: navigacija i osvježavanje prestaju, ali kopiranje, dijeljenje i izvoz i dalje rade. Ponovno skeniranje istog zaslona vraća isti sloj ("Nastavi gdje si stao"). Nema hlađenja.

### 1.6 Izvoz i dijeljenje

Svaki panel: kopiraj s izvorom, podijeli poveznicu (otvara statičku stranicu "pogled izvana" s kartom javnih zaslona), ICS (zatvaranja, sjednice, događanja), GeoJSON izvedenih zatvaranja (označeno kao prilagodba), PDF akta kroz stilove za ispis. Atribucija je na početku svakog izvoza.

### 1.7 Otvoreni izvedeni podaci i sučelje

Sve što sustav izvede objavljuje se na `/open/*.json` pod Otvorenom dozvolom s katalogom DCAT-AP i dnevnim snimkama; stranica `/izvori` navodi svaki izvor, licencu i vrijeme posljednje promjene; `/privatnost` i `/pristupacnost` (izjava o pristupačnosti s deklariranim odstupanjem) su dio proizvoda.

### 1.8 Podaci za Grad Zagreb

Brojači bez identifikatora `(dan, sat, događaj, dimenzija 1, dimenzija 2) → broj` u zatvorenim rječnicima: početak i kraj sesije s vrstom prostora i četvrti, neuspjela skeniranja s razlogom, dostupnost svakog izvora podataka, otvaranja slojeva i izvozi, pogledi otvorenog sloja. Mjesečni CSV i JSON te tromjesečni HTML izvještaj Gradskom uredu za digitalizaciju, nove tehnologije i tehničke poslove: brojevi zaokruženi na 5, ćelije ispod 10 sažete u "ostalo". Grad dobiva trajnu, besplatnu, neisključivu licencu za planiranje i unapređenje gradskih usluga, s pravom objave na data.zagreb.hr.

### 1.9 Upravljanje zaslonima

Provizioniranje zaslona kroz stranicu zaštićenu Cloudflare Accessom (vrsta prostora, četvrt, oznaka, stanica), jednokratna adresa za postavljanje, opoziv jednim klikom, vodič za Raspberry Pi 5 i bilo koji preglednik (`docs/kiosk.md`).

### 1.10 Lagani način: stari uređaj postaje gradski zaslon

Ništa se ne instalira. Zaslon je bilo koji uređaj koji zna otvoriti web-stranicu i ostati upaljen: prijenosnik iz 2014., tablet iz 2015., televizor s Android kutijom koja više ne dobiva ažuriranja, uredsko računalo koje je otpisano jer ne podržava novi operacijski sustav, ili Raspberry Pi. Uređaj ne treba trgovinu aplikacija, račun ni ažuriranje sustava; treba preglednik i struju.

Da to ne ostane na obećanju, projekt isporučuje mjerljiv **lagani način rada** (`?lagano=1` i automatsko prepoznavanje slabog uređaja):

- bez karte i bez WebGL-a, bez `canvas` animacija, bez upitnika o spremniku (`container queries`) i bez ostalih mogućnosti novijih od 2017.; prijelomna točka rasporeda računa se u JavaScriptu, a ne CSS-om koji stari preglednici ne razumiju;
- posebna inačica koda prevedena za starije preglednike (cilj prijevoda ES2017) uz postojeću modernu inačicu, tako da novi uređaji ne plaćaju cijenu starih;
- `/hitno` i danas radi bez JavaScripta i bez stilova, pa i najstariji preglednik prikaže sigurnosni sloj;
- mjerila koja se objavljuju i provjeravaju: manje od 200 kB prijenosa po učitavanju zaslona, manje od 300 MB radne memorije, rad na uređaju s 1 GB RAM-a, potrošnja izmjerena utičnim mjeračem i objavljena po uređaju;
- **matrica testiranih uređaja** u `docs/kiosk.md`: najmanje jedan uređaj iz 2014. ili starijeg, jedan tablet iz 2015., jedna Android TV kutija i jedan Raspberry Pi, svaki s nazivom preglednika, izmjerenim vremenom učitavanja i potrošnjom u vatima; uređaj koji padne na testu ostaje u matrici s oznakom zašto.

Prostori koji ugošćuju zaslon mogu donirati uređaj koji im leži neiskorišten; projekt ga priprema (napajanje, kabel, medij za pohranu, nosač), postavlja i ostavlja prostoru. Od šest pilot zaslona četiri su takvi uređaji, a samo dva su nova (Obrazac 3, redak 5.).

## 2. Potencijalni profil korisnika

- **Stanovnici u prostoru s javnim zaslonom** (gosti kafića, posjetitelji knjižnice, stranke u uredu gradske četvrti, članovi udruge): deset minuta pregleda grada bez instaliranja, prijave ili kolačića; sigurnosni sloj uvijek.
- **Posjetitelji i turisti** s inozemnim SIM karticama: skeniranje radi s mobilnim podacima bilo kojeg operatera; engleski jezik jednim dodirom; nikakav račun.
- **Starije osobe i osobe koje ne koriste pametne telefone:** zaslon je čitljiv sam, s velikim tipom i riječima umjesto boja; osoblje može pročitati kod naglas; u knjižnicama i četvrtima zaslon je servis, ne reklama.
- **Osobe s invaliditetom:** utipkani kod umjesto kamere, čitač zaslona vodi kroz svaki korak, kontrast i zum 200 %, bez treptanja, ozbiljnost uvijek riječima i oblikom; otvoreni sloj bez vremenskog ograničenja za svaku informaciju (WCAG 2.2, kriterij 2.2.1 s deklariranim odstupanjem i alternativama).
- **Prostori koji ugošćuju zaslon** (kafići, knjižnice, četvrti, udruge, ZET): sadržaj koji zadržava ljude, bez troška i bez održavanja; zaslon može biti uređaj koji prostor već ima i koji bi inače bacio.
- **Škole, udruge i uredi s otpisanom opremom:** stari prijenosnik ili tablet dobiva svrhu kao gradski zaslon, bez instalacije, licence i ažuriranja sustava; oprema ostaje u vlasništvu prostora.
- **Grad Zagreb:** prvi skup podataka o potražnji za gradskim informacijama po satu, četvrti i vrsti prostora, te mjesečni izvještaj o pouzdanosti vlastitih otvorenih izvora.
- **Razvojna zajednica:** otvoreni kod, otvoreni izvedeni podaci, dokumentirani protokol uparivanja koji svatko može ponovno upotrijebiti.

## 3. Tip rješenja

Progresivna web-aplikacija (PWA) za telefon i radnu površinu, softver za javne zaslone (isti kod, kiosk raspored, radi u svakom pregledniku, preporučeno na Raspberry Pi 5) i otvoreno sučelje za izvedene podatke. Tehnički: jedan Cloudflare Worker sa statičkim datotekama, četiri Durable Object klase sa SQLite pohranom (zaslon, sesija, indeks kodova, brojači), KV za posljednju dobru kopiju svakog izvora, WebSocket s hibernacijom za zaslone i sesije, HMAC tokeni bez stanja za podatke, MapLibre GL karta s otvorenim pločicama. Bez baze korisnika, bez kolačića, bez identifikatora uređaja. Sve je opisano na jednoj stranici u `docs/arhitektura.md`.

## 4. Obrazloženje interesa projekta za Grad Zagreb

Grad Zagreb je usvojio okvirnu strategiju pametnog grada sa šest područja i 27 mjera, vodi Centar za upravljanje prometom sa 160 semaforiziranih raskrižja, pilotira ZET-ove e-ink zaslone sa stvarnim vremenom, razvija Pristupačni Zagreb i Guru za kulturu, te kroz ovaj Program i ZGBit susrete gradi zajednicu koja koristi njegove otvorene podatke. Vidikovac spaja te niti u jedan javni proizvod:

1. **Vidljivost otvorenih podataka na ulici.** Podaci s data.zagreb.hr, ZET-a i DHMZ-a danas žive u portalima i aplikacijama za one koji ih traže. Javni zaslon u kafiću, knjižnici ili uredu četvrti donosi ih ljudima koji ih ne traže, s izvorom i licencom ispisanima na zaslonu. Svaki zaslon je stalna, javna referenca na data.zagreb.hr.
2. **Sigurnosna informacija bez ikakve prepreke.** Otvoreni sloj s upozorenjima DHMZ-a, potresima, zatvaranjima i zbornim mjestima civilne zaštite radi bez JavaScripta i bez telefona, čitljiv na zaslonu, ispisiv na papir. To je javna usluga koju Grad može pokazati kao izravni rezultat svoje politike otvorenih podataka.
3. **Podatak koji Grad nema: potražnja.** Gradski uredi znaju što objavljuju, ali ne znaju kad i gdje građani traže gradske informacije. Anonimni zbrojevi po satu, četvrti i vrsti prostora, dostavljeni mjesečno pod licencom koja Gradu daje pravo objave, prvi su takav skup. Izvještaj o pouzdanosti izvora (koliko često koji gradski izvor kasni ili pada) izravna je povratna informacija timu za otvorene podatke.
4. **Inkluzivniji Zagreb.** Zasloni u knjižnicama, uredima gradskih četvrti i prostorima udruga, utipkani kod, čitač zaslona, veliki tip i riječi umjesto boja, engleski za posjetitelje. Projekt je izravno na temi 9. ZGBita "Otvoreni podaci za inkluzivniji Zagreb".
5. **Trajno vlasništvo.** Kod je pod AGPL-3.0-or-later s ponudom Gradu pod EUPL-1.2; Grad može preuzeti, pokrenuti i mijenjati sustav bez ikakve ovisnosti o prijavitelju. Predlažemo ugovorno da najmanje jedan zaslon bude na lokaciji koju Grad odabere (gradska četvrt, knjižnica ili ZET stanica).
6. **Manje elektroničkog otpada, a ne više.** Digitalni projekti obično traže novu opremu. Ovaj je traži najmanje moguće: zaslon je stari uređaj koji prostor već ima, jer se ništa ne instalira i jer lagani način rada (1.10) drži uređaje stare deset godina. Nacrt Plana gospodarenja otpadom Grada Zagreba do 2029. predviđa centar za ponovnu uporabu u Heinzelovoj kao mjesto pripreme ispravnih uređaja za ponovnu uporabu; Vidikovac je svrha za takav uređaj nakon pripreme, i spreman je da centar, škola ili ured četvrti ponudi uređaj koji projekt postavlja kao zaslon i ostavlja prostoru. Odluka Vlade o obveznoj provedbi zelene javne nabave iz studenoga 2024. uredsku i informatičku opremu drži prioritetnom skupinom, a produljenje vijeka uređaja je najjeftinija mjera u toj skupini. U pilotu to nije načelo nego brojka: za isti novac šest zaslona umjesto četiri, od toga četiri na doniranim uređajima (Obrazac 3, redak 5.), s izmjerenom potrošnjom objavljenom po uređaju.

## 5. Popis otvorenih podataka koji bi se koristili

Potpuni popis s licencama, adresama, učestalošću i doslovnim atribucijama je u `docs/izvori.md` u repozitoriju i na stranici `/izvori`; ovdje sažeto.

| Izvor | Skup | Licenca | Osvježavanje |
|---|---|---|---|
| ZET | GTFS-Realtime (položaji vozila, kašnjenja) i statični GTFS | Otvorena dozvola | 30 s; dnevno |
| Grad Zagreb, data.zagreb.hr | Zatvaranje prometnica; Plan komunalnih aktivnosti | Otvorena dozvola | 3 min; dnevno |
| Grad Zagreb, ArcGIS prostorni slojevi | Gradske četvrti, zborna mjesta civilne zaštite, ljekarne, vatrogasci, policija, javni zdenci, javni WC, knjižnice, muzeji, parkovi, biciklističke staze | Otvorena dozvola | dnevno |
| DHMZ | Trenutna mjerenja, prognoza, upozorenja CAP, hidrološki bilten | Otvorena dozvola | 10 min; 30 min; 5 min; dnevno |
| EMSC | Potresi (FDSN event servis) | slobodno uz izvor | 1 min |
| Hrvatska agencija za okoliš i prirodu | Indeks kvalitete zraka (INSPIRE WFS/WMS) | otvoreno uz izvor | 1 h |
| HŽ Putnički prijevoz | Statični GTFS (data.gov.hr) | nije navedena, upit poslan | dnevno |
| Grad Zagreb | Službeni glasnik Grada Zagreba (JSON API) | službeni tekstovi | 1 h |
| Narodne novine | API s ELI identifikatorima | službeni tekstovi | dnevno |
| HRT | RSS Vijesti i Radio Sljeme (tekst s poveznicom) | uz navođenje HRT-a i poveznicu | 5 min |
| Zagrebački događaji (šest izvora: Kulturpunkt, Skupština, kvartovske novosti, plan komunalnih aktivnosti, ZET, Etnografski muzej) | Najave, sjednice, mjesna samouprava, komunalni radovi, prometne obavijesti, izložbe | CC BY-SA 3.0 HR (Kulturpunkt) i Otvorena dozvola (ostalih četvero); Etnografski muzej ne navodi licencu | 15 min |
| Europeana, NSK, Wikidata, Wikimedia Commons | Baština Zagreba, metapodaci | CC0 / javno vlasništvo / CC BY-SA | dnevno |
| HAK | Stanje na cestama (tekst) | uz izvor, poveznicu i izvorno vrijeme | 10 min |
| HEP ODS, HEP Toplinarstvo, VIO | Planirani prekidi (neslužbeni prikaz) | uvjeti u provjeri | dnevno |

Izvori su ocijenjeni zeleno (otvorena licenca, strojno čitljivo, bez ključa), žuto (službeni HTML, uz oprez i oznaku "neslužbeni prikaz") i crveno (zatvoreno; prikazuje se samo poveznica dok pisano odobrenje ne stigne). U prototipu su isključivo zeleni izvori. Pisma ZET-u (oznaka "samo za testiranje" na GTFS-RT feedu), HRT-u i HAK-u te upit HŽPP-u o licenci dio su plana provedbe.

Redak "Zagrebački događaji" iznad sažima šest izvora čiji puni popis, s adresom i licencom svakog pojedinačno, čuva `docs/izvori.md`:

- **Kulturpunkt** (najave) -- `https://kulturpunkt.hr/wp-json/wp/v2/kp_22_announcement?_fields=id,link,title,excerpt,class_list,date&per_page=40&orderby=date&order=desc` -- CC BY-SA 3.0 HR
- **Skupština Grada Zagreba** (rokovnik sjednica) -- `https://skupstina.zagreb.hr/rokovnik-sjednica/76` -- Otvorena dozvola
- **Kvartovske novosti** (mjesna samouprava) -- `https://aktivnosti.zagreb.hr/kvartovske-novosti/134585` -- Otvorena dozvola
- **Plan komunalnih aktivnosti** -- `https://data.zagreb.hr/dataset/fddb4f87-c002-4e3c-b988-adf013997ecc/resource/f90738b6-8bfa-4dd9-9db7-b3c532d90c97/download/data.json` -- Otvorena dozvola
- **ZET, obavijesti** -- `https://www.zet.hr/rss_novosti.aspx` i `https://www.zet.hr/rss_promet.aspx` -- Otvorena dozvola
- **Etnografski muzej** (događanja i izložbe) -- `https://emz.hr/wp-json/wp/v2/dogadjanja?_fields=id,link,title,type,meta,class_list,date&per_page=20&orderby=date&order=desc` i `https://emz.hr/wp-json/wp/v2/izlozbe?_fields=id,link,title,type,meta,class_list,date&per_page=20&orderby=date&order=desc` -- Licenca nije navedena

## 6. Kriteriji iz Priloga 1. Programa

### 6.1 Dosadašnje iskustvo prijavitelja u razvojnim ili istraživačkim programima (0–10 bodova)

Aning Film d.o.o. je produkcijska tvrtka čiji direktor posljednjih godina samostalno razvija i vodi softverske proizvode u produkciji, s tehnološkim temeljem identičnim ovom projektu: psh.lat (uparivanje uređaja QR kodom i WebSocket na Cloudflare Durable Objects, PWA s više od trideset komponenata bez okvira, dvojezično sučelje), kompmajstor.eu (Cloudflare Workers s ograničivačima brzine, Turnstile provjerom i brojanjem posjeta bez kolačića), radi.li (karta i servisni radnik) i cjenik.app (PWA). Svi su javno dostupni i mogu se provjeriti u trenutku ocjenjivanja. Filmski i produkcijski rad tvrtke: [[POPUNITI: tri do pet naslova s godinom i ulogom, iz službene filmografije]]. Ta dva iskustva se u ovom projektu sastaju: softver koji radi u produkciji i vizualni zanat za javne zaslone.

### 6.2 Kapacitet prijavitelja za provedbu projekta (0–10 bodova)

Prototip je na https://zagreb.aningfilm.hr prije roka prijave: otvoreni sloj, javni zaslon s rotirajućim kodom, skeniranje, sesija s istekom i pet izvora u stvarnom vremenu. Primitivi koje projekt koristi već rade u produkciji drugih proizvoda prijavitelja i preneseni su datoteka po datoteku (QR generator i skener, WebSocket Durable Object s hibernacijom, brojači bez identifikatora, sigurnosna zaglavlja, sustav tema, i18n, Playwright testovi u dva konteksta). Infrastruktura je plaćeni Cloudflare Workers račun s Durable Objects u produkciji. Suradnici po ulozi i satu su u financijskom planu: drugi razvojni inženjer za integracije izvora i testove, revizor pristupačnosti koji testira s korisnicima s invaliditetom, UX i motion dizajner, pravni i privacy pregled, instalater zaslona. Otvorena licenca uklanja rizik ovisnosti o jednoj osobi: kod je javan od prvog commita.

### 6.3 Tehnička izvedivost (0–10 bodova)

Arhitektura je na jednoj stranici (`docs/arhitektura.md`): jedan Worker, četiri Durable Object klase, KV, tri ograničivača, bez baze korisnika. Protokol uparivanja slijedi provjerene obrasce (OAuth device flow, rotacija kodova kao TOTP, jednokratni tokeni, 40 bita entropije, provjera posjedovanja karticom potvrde) i opisan je u `worker/protocol.ts`. Svaki izvor ima ocjenu, rok dohvata od 6 sekundi, predmemoriju s TTL-om, posljednju dobru kopiju i iskren status (živo, zastarjelo, nedostupno); stranica nikad nije prazna. Testovi: jedinični za svaki parser prema spremljenim živim uzorcima, integracijski za Durable Objects u Workers runtimeu, Playwright u dva preglednička konteksta za uparivanje i istek, axe i Lighthouse za pristupačnost. Postavljanje je `git push`; povratak na prethodnu inačicu je `git revert`. Prototip je dokaz izvedivosti u trenutku ocjenjivanja, ne obećanje.

### 6.4 Društvena korist (0–30 bodova)

Prvo, sigurnost bez prepreka: upozorenja, potresi, zatvaranja, ljekarne, zborna mjesta i prekidi na jednoj stranici koja radi bez JavaScripta, na zaslonu bez telefona i na papiru. Drugo, inkluzija: zasloni u knjižnicama, uredima gradskih četvrti i prostorima udruga (predlažemo da Grad ugovorno odabere najmanje jednu lokaciju), utipkani kod za osobe koje ne koriste kameru, čitač zaslona vodi kroz svaki korak, veliki tip i riječi umjesto boja, engleski za posjetitelje s inozemnim SIM karticama, izjava o pristupačnosti s revizijom uz korisnike s invaliditetom dvaput tijekom projekta. Treće, privatnost kao struktura, ne kao obećanje: nema računa, kolačića, identifikatora uređaja, IP adresa ni koordinata; mrežna usporedba radi se u memoriji i odbacuje; brojači nemaju identifikatore; nema pristanka koji treba tražiti jer nema ničega što bi se pratilo. Četvrto, podatak za Grad: skup o potražnji za gradskim informacijama i izvještaj o pouzdanosti gradskih izvora, mjesečno, s pravom objave. Peto, korist za prostore: kafić, knjižnica ili udruga dobivaju sadržaj koji zadržava ljude, bez troška, s pripremljenim uputama za osoblje. Šesto, vidljivost otvorenih podataka: svaki zaslon ispisuje "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom" stotinama ljudi dnevno. Sedmo, produljenje vijeka uređaja: lagani način rada (1.10) čini stari prijenosnik, tablet ili televizor s Android kutijom upotrebljivim gradskim zaslonom bez instalacije i bez ažuriranja sustava, pa projekt smanjuje količinu elektroničkog otpada umjesto da je povećava; četiri od šest pilot zaslona su donirani uređaji, a matrica testiranih uređaja s izmjerenom potrošnjom objavljuje se javno.

### 6.5 Inovativnost (0–20 bodova)

Dosad financirani projekti ovog Programa su vrijedne aplikacije za pojedina područja: promet (ZET info), gradski asistent (ZgInfo.AI), Skupština (Parlametar), Službeni glasnik (ZG Legalbot), zrak (ZG Air), hodljivost (Urban Score), proračun (ZagrebViz). Nijedan ne integrira područja, nijedan nije u stvarnom vremenu preko više područja, nijedan nema mehaniku fizičke prisutnosti ni javne zaslone i nijedan ne vraća Gradu uvid o korištenju. Vidikovac donosi pet novih stvari: (1) jedan pogled na grad preko sedam slojeva u stvarnom vremenu; (2) otključavanje prisutnošću, bez računa, aplikacije i kolačića, s rotirajućim jednokratnim kodovima i provjerom da telefon nije na mreži zaslona; (3) javne zaslone koji su korisni i bez skeniranja i koje osoba s telefonom može voditi; (4) anonimni skup o potražnji koji Grad dobiva pod licencom s pravom objave; (5) obrnutu hardversku logiku: umjesto da javni zaslon traži novu opremu, projekt je projektiran za odbačenu, s objavljenim mjerilima i matricom testiranih uređaja, pa se mreža zaslona može širiti onime što gradu već leži po ladicama; (6) proizvod koji ne traži vrijeme korisnika: sesija sama završava, ništa ne obavještava, ništa ne podsjeća i ništa se ne preporučuje da bi se čovjek vratio, pa mjerila projekta broje sesije i dostupnost izvora, nikad zadržavanje. Ograničenja su svrha, a ne cijena: da bi se pogled otključao, netko mora doći do zaslona u prostoru ili do druge osobe, što stvara susrete među ljudima, prostorima i ustanovama, a deset minuta poslije vraća čovjeka na ulicu. Presedani su poznati i navedeni pošteno: BeRealov dvominutni prozor (55 % korisnika objavljuje dnevno unutar njega) pokazuje da oskudica stvara ritual; Pokémon Go PokéStopovi pokazuju vrijednost prisutnosti za prostore; Nintendo StreetPass relejne točke pokazuju mrežu zaslona; Clubhouse pokazuje da vrata bez sadržaja propadaju kad se otvore, zato je naš sadržaj otvoren i bez vrata, a vrata ograničavaju samo vrijeme.

### 6.6 Konačni proizvod pod licencom otvorenog koda ili u javnom dobru (0–10 bodova)

Kod je pod AGPL-3.0-or-later, javan od prvog commita na https://github.com/matijarma/vidikovac, s zaglavljima prenesenih datoteka očuvanima. Gradu Zagrebu nudimo isti kod i pod EUPL-1.2, licencom Europske komisije prilagođenom javnim tijelima, kako bi ga mogao preuzeti i mijenjati pod uvjetima koje njegove službe već poznaju. Izvedeni podaci na `/open` su pod Otvorenom dozvolom s DCAT-AP katalogom i dnevnim snimkama, uz stalnu ponudu Gradu da ih objavi na data.zagreb.hr. Dokumentacija je na hrvatskom: arhitektura, protokol, vodič za zaslone, popis izvora, izjava o privatnosti, izjava o pristupačnosti. Skup o potražnji Grad dobiva pod posebnom neisključivom, trajnom, besplatnom licencom s pravom objave; mi ga ne objavljujemo, jer objava je odluka Grada.

### 6.7 Kvaliteta financijskog plana i obrazloženje troškova (0–10 bodova)

Financijski plan je u Obrascu 3 i u `obrazac-3-financijski-plan.md`: 20.000,00 EUR bez PDV-a u pet redaka. Troškovi zaposlenih (500 sati voditelja projekta i glavnog razvoja) računaju se po satnici izvedenoj iz stvarne bruto plaće formulom godišnji trošak rada / 1.720 produktivnih sati (12,60 EUR), s alternativom bruto / 155 (10,00 EUR) ako Grad tako propisuje, pri čemu se razlika premješta u sate drugog razvojnog inženjera, a ukupni iznos ostaje isti. Vanjski suradnici su navedeni po ulozi, satu i cijeni sata. Promidžba je 6 % ukupnog iznosa (iznad propisanih 5 %) i konkretna: video i titlovi, tiskani stalci i upute za prostore, prezentacija na ZGBitu, javno predstavljanje u pilot kafiću. Licence su stvarni godišnji trošak infrastrukture. Oprema su četiri zaslona za pilot lokacije po 245 EUR plus rezerva. Svaki euro ima isporuku i mjesec u planu provedbe.

## 7. Kako čitamo uvjet "rezultati nenaplatno dostupni javnosti"

Program i Javni poziv traže da rezultati budu nenaplatno dostupni javnosti; Program taj pojam definira kao dostupnost bez naknade. Vidikovac ni od koga ne traži novac ni protuvrijednost koja bi se mogla naplatiti. Sigurnosni sloj je otvoren svima bez ikakvog uvjeta; javni zaslon je čitljiv bez telefona; kod i izvedeni podaci su otvoreni; skeniranje ograničava trajanje pogleda, ne krug ljudi koji ga mogu vidjeti, a ponoviti ga može svatko odmah. Predlažemo ugovorni minimum zaslona na lokacijama koje Grad odabere kako bi pristup ne ovisio o komercijalnim prostorima.

## 8. Poveznice

- Prototip: https://zagreb.aningfilm.hr · otvoreni sloj: https://zagreb.aningfilm.hr/hitno · izvori: https://zagreb.aningfilm.hr/izvori
- Repozitorij: https://github.com/matijarma/vidikovac · arhitektura: `docs/arhitektura.md` · zasloni: `docs/kiosk.md`
- Video: [[POPUNITI: poveznica]]

## Polja za ispunu prije predaje

Sva mjesta označena `[[POPUNITI: ...]]` popunjavaju se iz službenih registara i dokumenata tvrtke (sudski registar, filmografija, poveznica na video). Skripta `npm run check:izvori -- --filing` odbija proći dok ijedno ostane.
