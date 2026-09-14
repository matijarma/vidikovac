# Prijedlog projekta: Kaj ima? Zagreb, pri ruci.

**Prijavitelj:** Aning Film d.o.o., [[POPUNITI: adresa sjedišta]], OIB [[POPUNITI: OIB]]. Zakonski zastupnik: Matija Radeljak, direktor.
**Javni poziv:** za dodjelu potpora male vrijednosti za financiranje projekata korištenja otvorenih podataka za 2026.
**Zatraženi iznos:** 20.000,00 EUR (bez PDV-a). **Trajanje:** 10 mjeseci od potpisa ugovora, unutar 31. 12. 2027.
**Prototip:** https://zagreb.aningfilm.hr (javno dostupan prototip) · **Izvorni kod:** https://github.com/matijarma/vidikovac (privatni repozitorij za evaluaciju, licenca AGPL-3.0-or-later) · **Video (90 s):** [[POPUNITI: poveznica na video nakon 15. 9.]]

## Sažetak

Kaj ima? pretvara otvorene podatke Zagreba u uslugu koju građanin može razumjeti i upotrijebiti: prepoznati svoj tramvaj na karti, pogledati vrijeme, pronaći događanje, razumjeti radove u gradu ili doći do sigurnosne informacije. Podaci Grada Zagreba, ZET-a, DHMZ-a, EMSC-a i drugih javnih izvora ne ostaju tablice i poveznice. Karta, grafički prikaz vremena, raspored događanja i jasno oblikovani detalji prilagođeni su informaciji i uređaju.

Pogled se na vlastitom uređaju otključava na deset minuta skeniranjem rotirajućeg koda sa zaslona u prostoru ili na pet minuta s telefona druge osobe. Ista Wi-Fi mreža nije prepreka. Pristup ne košta novac, oglase ni podatke o sebi. Traži jedino pažnju i prisutnost: čovjek dođe do zaslona u prostoru ili do druge osobe, a deset minuta poslije pogled se sam zatvori, bez obavijesti koje bi ga vraćale. Sigurnosni sloj ostaje dostupan bez sesije, uključujući inačicu bez JavaScripta, a zaslon je koristan i osobi bez telefona. Završetak sesije ne briše ono što je osoba upravo čitala: ostaje jasno označena snimka s izvorima i mogućnostima izvoza.

Ova prijava donosi radni prototip na kojem Povjerenstvo može provjeriti stvarne izvore, stvarno uparivanje, telefon, radnu površinu i javni zaslon. Prototip je javno dostupan na navedenoj adresi radi ocjenjivanja; nije zasebno javno lansiranje. Nastavak razvoja, pilot na zaslonima u prostorima i dostupnost građanima predlažu se kroz financiranje i partnerstvo s Gradom. Bez tog financiranja nema zasebnog nastavka projekta. Korištenje privremenih zaslona postavljenih tijekom ocjenjivanja vodi se odvojeno od budućih pokazatelja korištenja na pilot lokacijama.

Kod i izvedeni otvoreni skupovi dio su predaje Gradu. Lagani način rada i ponovna uporaba postojećih uređaja temelj su pilot-mreže, uz mjerljiva ispitivanja tijekom financiranog razdoblja. Mjesečni anonimni zbrojevi daju Gradu uvid u potražnju za gradskim informacijama, bez praćenja građana.

### Što Povjerenstvo provjerava u prototipu

Prototip koristi deset modula izvora kroz sedam područja: Sada, Promet, Vrijeme, Sigurnost, Grad, Događanja i Vijesti. Privremeni zaslon postavlja se u pregledniku na stranici `/kiosk/`, odabire se stvarno stajalište, a telefon ili druga kartica preglednika ulazi redovnim jednokratnim kodom. Ne postoji odvojena demonstracija s izmišljenim podacima ili zaobiđenom sesijom.

Položaji vozila su procjene iz očitanja i geometrije linije; kašnjenje linije nije procjena dolaska na stajalište. Prognoza sadrži dnevni raspon, ne izmišljenu satnu krivulju. Događanja imaju stvarne datume, a nedatirane kvartovske obavijesti ostaju bez datuma. Službeni glasnik prikazuje podatke o aktima i izvornike, ne izmišljeni pravni sažetak. Statusi izvora razlikuju prazne rezultate, djelomičnu dostupnost, zastarjelost i nedostupnost.

Poglavlje 1 opisuje cilj financiranog proizvoda. Sve što je u njemu označeno s **(plan: M#)** je isporuka financiranog razdoblja, vezana na mjesec plana provedbe, i nije predstavljeno kao dovršena funkcija prototipa. Sve neoznačeno Povjerenstvo može provjeriti u prototipu danas.

## 1. Popis funkcionalnosti

### 1.1 Otvoreni sloj, dostupan svima bez skeniranja

Stranica `/hitno` prikazuje se bez JavaScripta, na svakom uređaju i u svakom pregledniku, i može se ispisati: važeća upozorenja DHMZ-a za Zagrebačku regiju riječima i oblikom (nikad samo bojom), potresi u posljednja 72 sata u krugu od 1,5° oko Zagreba (EMSC, oko 165 km), zborna mjesta civilne zaštite, trenutno zatvorene prometnice, brojevi za hitne slučajeve provjereni prema službenoj stranici, popis dežurnih ljekarni prema stranici Grada s datumom provjere (Grad ne objavljuje strojno čitljiv izvor), vodostaj Save iz hidrološkog biltena **(plan: M2)**, javni zdenci i javni zahodi **(plan: M2)**, planirani prekidi struje, toplinske energije i vode označeni kao neslužbeni prikaz **(plan: M5)** i tekst HAK-a o stanju na cestama s izvornim vremenom **(plan: M5)**. Isti sloj identičan je unutar otključane sesije. Nedostupan izvor nikad se ne prikazuje kao potvrda da upozorenja nema.

### 1.2 Javni zaslon (Prozor), čitljiv bez telefona

Zaslon bez dodira prikazuje sigurnosnu traku uz donji rub (stanje upozorenja, zatvorene prometnice u blizini, dežurna ljekarna) i iznad nje lokalnu vektorsku kartu s linijama stajališta prostora i vozilima u blizini, opažanje vremena s postaje Zagreb-Maksimir, jednu priču iz grada s izvorom (događanje, naslov HRT-a ili potres) i pozivnu karticu "Skeniraj za 10 minuta grada. Manje ekrana, više Zagreba." Kartice se izmjenjuju svakih 20 sekundi. QR kod rotira svakih 30 sekundi, vidljiva traka pokazuje koliko je ostalo do sljedećeg koda, kod je ispisan u dvije skupine za čitanje naglas ili tipkanje, a podnožje navodi izvore podataka. Dolasci po stajalištu **(plan: M2)**, kvaliteta zraka na najbližoj postaji **(plan: M2)** i arhivska slika Zagreba s atribucijom **(plan: M2)** dodaju se kad izvori budu u produkciji.

Zaslon s dodirom nosi i gumb "Osnovno": jedan dodir otvara sigurnosni sloj, linije stajališta tog zaslona, vrijeme i zatvorene prometnice, bez skeniranja, bez sesije i bez odbrojavanja, a nakon devedeset sekundi bez dodira zaslon se vraća na poziv. Gradski zaslon ne smije uskratiti informaciju čovjeku koji nema telefon za skeniranje; skeniranje otključava grad na vlastitom uređaju, a ne oduzima ga zaslonu pred kojim čovjek stoji. Tema je tamna nakon zalaska i svijetla danju, prema izračunatim vremenima sunca, uz mogućnost da prostor odabere. Nakon skeniranja zaslon prikazuje sloj koji gleda osoba koja ga vodi, u rasporedu za velike zaslone (brojčani prikazi i kod 72 px, naslovi 40 px, tijelo najmanje 28 px na 1080p), i vraća se pozivu kad sesija istekne.

### 1.3 Otključani pogled (Ruka na telefonu, Stol na radnoj površini)

Sedam područja, svako s oznakom svježine (Živo ispod 5 minuta, Danas, Referenca) i atribucijom u podnožju svakog panela. Na telefonu su Sada, Promet i Događanja kartice, a Vrijeme, Sigurnost, Grad i Vijesti su u imeniku Još; na radnoj površini svih sedam je u bočnoj traci.

- **Sada:** sat, mjerenje s postaje Zagreb-Maksimir, prognoza i tekst za Zagreb, stanje CAP upozorenja, broj ZET vozila u pokretu, broj aktivnih zatvaranja; peludni semafor **(plan: M5)** i fotogram Trga bana Jelačića **(plan: M5)**.
- **Promet:** karta ZET vozila u stvarnom vremenu s imenima linija i kašnjenjem linije, pretraga linija i stajališta (tekst pretrage ostaje na telefonu), zatvorene prometnice kao linije na karti; dolasci po stajalištu **(plan: M2)**, polasci HŽPP-a prema voznom redu **(plan: M2)**, tekst HAK-a s atribucijom **(plan: M5)**, BAJS ako se otvoreni GBFS izvor potvrdi **(plan: M2)**.
- **Vrijeme:** opažanje, dnevna prognoza, vjetar, vlaga, upozorenja, potresi u krugu od 1,5° u sedam dana, izlazak i zalazak sunca izračunati na uređaju; indeks kvalitete zraka po postaji **(plan: M2)**, vodostaj Save **(plan: M2)**.
- **Sigurnost:** otvoreni sloj, identičan.
- **Grad:** najnoviji akti Službenog glasnika Grada Zagreba s popravljenim dijakriticima i ispisom u PDF, plan komunalnih aktivnosti s fazama radova i navedenim iznosima, sljedeća sjednica Gradske skupštine s poveznicom na prijenos; najnovija izdanja Narodnih novina (ELI) **(plan: M2)**, otvorena savjetovanja **(plan: M2)**.
- **Događanja:** datirani raspored iz šest izvora s kategorijama, detaljem, izvornikom i atribucijom; nedatirane kvartovske obavijesti odvojeno; baština Zagreba iz Europeane i Digitalnih zbirki NSK **(plan: M2)**, "na današnji dan" iz Wikidate **(plan: M2)**, program HRT-a i radija kao tekst s poveznicom na njihov vlastiti player, nikad ugrađeno **(plan: M5)**.
- **Vijesti:** HRT i Radio Sljeme kao tekst s izvorom, stvarnim datumom objave i poveznicom; ostali portali samo naslov i poveznica **(plan: M5)**; HINA se ne preuzima.

### 1.4 Uparivanje bez računa, bez aplikacije i bez kolačića

Telefon skenira QR kod vlastitom ili ugrađenom kamerom; otvara se kartica potvrde s nazivom zaslona i trajanjem te gumb Otključaj. Kod je jednokratan i rotira svakih 30 sekundi uz kratku toleranciju; ne nosi identifikator zaslona ni osobe. Telefon i zaslon smiju koristiti istu Wi-Fi mrežu. Prisutnost je mehanika pristupa kodu na zaslonu ili uz drugu osobu, a ne tvrdnja o kriptografskom dokazu lokacije: mehanizam otežava daljinsku i automatiziranu zlouporabu, ne dokazuje gdje čovjek stoji. Kod se može utipkati, uključujući u drugoj kartici preglednika za provjeru radne površine. Sesija nastaje redovnim iskorištavanjem koda, nikad samim otvaranjem zaslona. Osoba u sesiji može pritisnuti "Podijeli grad" i dati drugoj osobi pet svježih minuta u zasebnoj sesiji, bez daljnjeg lančanja.

### 1.5 Istek sesije koji ništa ne gubi

Šezdeset i dvadeset sekundi prije kraja prikazuje se upozorenje i čita se čitaču zaslona. Istekom se prikaz zamrzne kao statička, atribuirana snimka: navigacija i osvježavanje prestaju, a kopiranje, dijeljenje i izvoz i dalje rade. Novo skeniranje bilo kojeg zaslona odmah daje novih deset minuta i u istoj kartici preglednika otvara posljednji gledani sloj. Osvježavanje stranice unutar sesije nastavlja istu sesiju bez novog koda.

### 1.6 Izvoz i dijeljenje

Svaki panel: kopiraj s izvorom, podijeli poveznicu na prikaz ili izvornik, ICS (zatvaranja, sjednice, događanja), GeoJSON izvedenih zatvaranja (označeno kao prilagodba), PDF akta kroz stilove za ispis. Atribucija je na početku svakog izvoza. Statička stranica "pogled izvana" s kartom javnih zaslona, na koju podijeljena poveznica vodi osobu bez sesije, je **(plan: M4)**.

### 1.7 Otvoreni izvedeni podaci i sučelje

Ono što sustav izvede iz izvora otvorene razine (zatvorene prometnice kao GeoJSON, sažeci meteoroloških upozorenja, potresi, sigurnosne točke) objavljuje se na `/open/*.json` pod Otvorenom dozvolom, s katalogom DCAT-AP na `/open/catalog.json`; dnevne snimke u R2 su **(plan: M4)**. Izvori razine sesije (ZET položaji, DHMZ mjerenja i prognoza, HRT, Službeni glasnik, događanja) ne objavljuju se na `/open`, jer njihove licence to ne dopuštaju u cjelini ili nisu navedene; granicu provodi kod, ne dogovor. Stranica `/izvori` navodi svaki izvor, licencu i vrijeme posljednje promjene; `/privatnost` i `/pristupacnost` (izjava o pristupačnosti s deklariranim odstupanjem) dio su proizvoda.

### 1.8 Podaci za Grad Zagreb

Brojači bez identifikatora `(dan, sat, događaj, dimenzija 1, dimenzija 2) → broj` u zatvorenim rječnicima: početak i kraj sesije s vrstom prostora i četvrti, neuspjela skeniranja s razlogom, dostupnost svakog izvora podataka, otvaranja slojeva i izvozi, pogledi otvorenog sloja. Izvoz zaokružuje brojeve na 5 i ćelije ispod 10 sažima u "ostalo"; korištenje privremenih zaslona vodi se odvojeno od pilot lokacija. Mjesečni CSV i JSON te tromjesečni HTML izvještaj Gradskom uredu za digitalizaciju, nove tehnologije i tehničke poslove su **(plan: M4)**. Grad dobiva trajnu, besplatnu, neisključivu licencu za planiranje i unapređenje gradskih usluga, s pravom objave na data.zagreb.hr.

### 1.9 Upravljanje zaslonima

Zaslon se postavlja na javnoj stranici `/kiosk/`: prostor odabere gradsku četvrt i stvarno ZET-ovo stajalište, a sustav izda redovnu postavu na 24 sata s rotirajućim kodom; s jedne mreže može se u jednom satu postaviti najviše pet zaslona, a ukupno trideset, pri čemu se adresa mreže ne pohranjuje. Trajni zasloni pilot-lokacija dobivaju postavu bez roka kroz operatersko sučelje zaštićeno prijavom (vrsta prostora, četvrt, oznaka, stanica), s opozivom jednim klikom. Vodič za Raspberry Pi 5 i bilo koji preglednik je `docs/kiosk.md`.

Podjela odgovornosti na pilot lokacijama je određena unaprijed. Prijavitelj predlaže lokacije, a Grad odabire najmanje jednu. Prostor daje struju i mrežu, instalater iz proračuna montira i pušta zaslon u rad, a prostor ga svakodnevno drži upaljenim. Donirani uređaji ostaju u vlasništvu prostora; dvije nove postave ostaju u vlasništvu prijavitelja i u funkciji projekta najmanje do 31. 12. 2027. Prva pomoć je ponovno pokretanje uređaja u prostoru; opoziv i nova postava rade se na daljinu iz operaterskog sučelja. Pokvaren uređaj zamjenjuje se iz rezerve ili se zaslon ukida; projekt ne preuzima trajnu obvezu održavanja javne infrastrukture izvan ugovorenog razdoblja.

### 1.10 Lagani način: stari uređaj postaje gradski zaslon

Ništa se ne instalira. Zaslon je bilo koji uređaj koji zna otvoriti web-stranicu i ostati upaljen: stari prijenosnik, tablet koji više ne dobiva ažuriranja, televizor s Android kutijom, otpisano uredsko računalo ili Raspberry Pi. Uređaj ne treba trgovinu aplikacija, račun ni ažuriranje sustava; treba preglednik i struju.

Lagani način rada postoji u prototipu (`?lagano=1` i automatsko prepoznavanje uređaja s malo memorije ili bez WebGL-a): bez karte, bez WebGL-a, bez `canvas` animacija i bez web-fontova, a početno učitavanje zaslona danas je 104 kB komprimirano. Financirano razdoblje pretvara to u mjerljivu obvezu **(plan: M1b)**:

- inačica koda za starije preglednike bez podrške za module, uz postojeću modernu inačicu, tako da novi uređaji ne plaćaju cijenu starih;
- `/hitno` i danas radi bez JavaScripta i bez stilova, pa i najstariji preglednik prikaže sigurnosni sloj;
- kriteriji prihvaćanja koji se objavljuju i provjeravaju: manje od 200 kB prijenosa po učitavanju zaslona, manje od 300 MB radne memorije, rad na uređaju s 1 GB RAM-a, potrošnja izmjerena utičnim mjeračem i objavljena po uređaju;
- **matrica testiranih uređaja** u `docs/kiosk.md`: najmanje četiri stvarna stara ili donirana uređaja različitih klasa (prijenosnik, tablet, Android TV kutija, Raspberry Pi), svaki s nazivom preglednika, izmjerenim vremenom učitavanja i potrošnjom u vatima; uređaj koji padne na testu ostaje u matrici s oznakom zašto.

Prostori koji ugošćuju zaslon mogu donirati uređaj koji im leži neiskorišten; projekt ga priprema (napajanje, kabel, medij za pohranu, nosač), postavlja i ostavlja prostoru. Od šest pilot zaslona četiri su takvi uređaji, a dva su nova (Obrazac 3, redak 5.).

### Granica ove prijave

Arhitektura je namjerno građena tako da se nova gradska područja dodaju bez promjene načina uporabe: isti zaslon, isti kod, ista sesija. Isti temelj dopušta i ono što ova prijava ne financira: zaslone koje prostori sami ugošćuju u vlastitim izlozima, društvene mogućnosti otključane stvarnim susretom umjesto računom, i dvosmjerni kanal između građana i gradskih ustanova na istoj otvorenoj podlozi. To je smjer razvoja, a ne isporuka. Isporuke ovog projekta su navedene u 1.1 do 1.10 i u planu provedbe.

## 2. Potencijalni profil korisnika

- **Stanovnici u prostoru s javnim zaslonom** (gosti kafića, posjetitelji knjižnice, stranke u uredu gradske četvrti, članovi udruge): deset minuta pregleda grada bez instaliranja, prijave ili kolačića; sigurnosni sloj uvijek.
- **Posjetitelji i turisti** s inozemnim SIM karticama: skeniranje radi s mobilnim podacima bilo kojeg operatera i na Wi-Fiju prostora; engleski jezik jednim dodirom; nikakav račun.
- **Starije osobe i osobe koje ne koriste pametne telefone:** zaslon je čitljiv sam, s velikim tipom i riječima umjesto boja; osoblje može pročitati kod naglas; u knjižnicama i četvrtima zaslon je servis, ne reklama.
- **Osobe s invaliditetom:** utipkani kod umjesto kamere, čitač zaslona vodi kroz svaki korak, kontrast i zum 200 %, bez treptanja, ozbiljnost uvijek riječima i oblikom; otvoreni sloj bez vremenskog ograničenja za svaku sigurnosnu informaciju (WCAG 2.2, kriterij 2.2.1 s deklariranim odstupanjem i alternativama).
- **Prostori koji ugošćuju zaslon** (kafići, knjižnice, četvrti, udruge, ZET): sadržaj koji ljudima u prostoru nešto kaže, bez troška i bez održavanja; zaslon može biti uređaj koji prostor već ima i koji bi inače bacio.
- **Škole, udruge i uredi s otpisanom opremom:** stari prijenosnik ili tablet dobiva svrhu kao gradski zaslon, bez instalacije, licence i ažuriranja sustava; oprema ostaje u vlasništvu prostora.
- **Grad Zagreb:** prvi skup podataka o potražnji za gradskim informacijama po satu, četvrti i vrsti prostora, te izvještaj o pouzdanosti vlastitih otvorenih izvora.
- **Razvojna zajednica:** otvoreni kod, otvoreni izvedeni podaci, dokumentirani protokol uparivanja koji svatko može ponovno upotrijebiti.

## 3. Tip rješenja

Programska aplikacija i mrežna stranica (Obrazac 2.2, točka 2.2.1): web-aplikacija za telefon i radnu površinu, softver za javne zaslone (isti kod, kiosk raspored, radi u svakom pregledniku, preporučeno na Raspberry Pi 5) i otvoreno sučelje za izvedene podatke. Tehnički: jedan Cloudflare Worker sa statičkim datotekama, četiri Durable Object klase sa SQLite pohranom (zaslon, sesija, indeks kodova, brojači), KV za posljednju dobru kopiju svakog izvora, WebSocket s hibernacijom za zaslone i sesije, HMAC tokeni bez stanja za podatke, MapLibre GL karta s vlastito posluženim otvorenim vektorskim pločicama (Protomaps na podacima OpenStreetMapa). Bez baze korisnika, bez kolačića, bez identifikatora uređaja. Sve je opisano na jednoj stranici u `docs/arhitektura.md`.

## 4. Obrazloženje interesa projekta za Grad Zagreb

Grad Zagreb je usvojio Okvirnu strategiju pametnog Grada Zagreba s 27 mjera u šest područja (zagreb.hr, strategija Zagreb Smart City), u prosincu 2025. otvorio je Centar za upravljanje prometom na koji je pri otvaranju bilo spojeno 161 semaforizirano raskrižje, a do 2028. planira svih 487 (zagreb.hr, 9. 12. 2025.), ZET objavljuje položaje vozila u stvarnom vremenu (GTFS-Realtime), Grad razvija aplikaciju Pristupačni Zagreb i kulturni vodič Guru za kulturu, a kroz ovaj Program i ZGBit susrete gradi zajednicu koja koristi njegove otvorene podatke. Kaj ima? spaja te niti u jedan javni proizvod:

1. **Vidljivost otvorenih podataka na ulici.** Podaci s data.zagreb.hr, ZET-a i DHMZ-a danas žive u portalima i aplikacijama za one koji ih traže. Javni zaslon u kafiću, knjižnici ili uredu četvrti donosi ih ljudima koji ih ne traže, s izvorom i licencom ispisanima na zaslonu. Svaki zaslon je stalna, javna referenca na data.zagreb.hr.
2. **Sigurnosna informacija bez ikakve prepreke.** Otvoreni sloj s upozorenjima DHMZ-a, potresima, zatvaranjima i zbornim mjestima civilne zaštite radi bez JavaScripta i bez telefona, čitljiv na zaslonu, ispisiv na papir. To je javna usluga koju Grad može pokazati kao izravni rezultat svoje politike otvorenih podataka.
3. **Podatak koji Grad nema: potražnja.** Gradski uredi znaju što objavljuju, ali ne znaju kad i gdje građani traže gradske informacije. Anonimni zbrojevi po satu, četvrti i vrsti prostora, dostavljeni mjesečno pod licencom koja Gradu daje pravo objave, prvi su takav skup. Izvještaj o pouzdanosti izvora (koliko često koji gradski izvor kasni ili pada) izravna je povratna informacija timu za otvorene podatke.
4. **Inkluzivniji Zagreb.** Zasloni u knjižnicama, uredima gradskih četvrti i prostorima udruga, utipkani kod, čitač zaslona, veliki tip i riječi umjesto boja, engleski za posjetitelje. Projekt je izravno na temi 9. ZGBita, održanog 16. travnja 2026.: "Otvoreni podaci za inkluzivniji Zagreb".
5. **Trajno vlasništvo.** Kod je pod AGPL-3.0-or-later s ponudom Gradu pod EUPL-1.2; Grad može preuzeti, pokrenuti i mijenjati sustav bez ikakve ovisnosti o prijavitelju. Predlažemo ugovorno da najmanje jedan zaslon bude na lokaciji koju Grad odabere (gradska četvrt, knjižnica ili ZET stanica).
6. **Manje elektroničkog otpada, a ne više.** Digitalni projekti obično traže novu opremu. Ovaj traži najmanje moguće: zaslon je stari uređaj koji prostor već ima, jer se ništa ne instalira i jer lagani način rada (1.10) drži uređaje koje bi drugi softver otpisao. Plan gospodarenja otpadom Grada Zagreba do 2029., usvojen 26. ožujka 2026., predviđa centar za ponovnu uporabu u Heinzelovoj kao mjesto prikupljanja, pregleda, pripreme za ponovnu uporabu i redistribucije ispravnih predmeta, uključujući električne uređaje; Kaj ima? je svrha za takav uređaj nakon pripreme i spreman je da centar, škola ili ured četvrti ponudi uređaj koji projekt postavlja kao zaslon i ostavlja prostoru. Odluka Vlade o provedbi zelene javne nabave (NN 137/2024, na snazi od 1. siječnja 2025.) računala i monitore stavlja među skupine koje se nabavljaju u najvišim energetskim razredima; produljenje vijeka postojećeg uređaja ide korak dalje od nabave boljeg novog. U pilotu to nije načelo nego brojka: za isti novac šest zaslona umjesto četiri, od toga četiri na doniranim uređajima (Obrazac 3, redak 5.), s izmjerenom potrošnjom objavljenom po uređaju.

## 5. Popis otvorenih podataka koji bi se koristili

Potpuni popis s licencama, adresama, učestalošću i doslovnim atribucijama je u `docs/izvori.md` u repozitoriju i na stranici `/izvori`; ovdje sažeto. Stupac Stanje razlikuje što je u prototipu od onoga što donosi plan provedbe.

| Izvor | Skup | Licenca | Osvježavanje | Stanje |
|---|---|---|---|---|
| ZET | GTFS-Realtime (položaji vozila, kašnjenja) i statični GTFS | Otvorena dozvola; feed nosi oznaku "samo za potrebe testiranja", pismo ZET-u je M2 | 30 s; dnevno | u prototipu |
| Grad Zagreb, data.zagreb.hr | Zatvaranje prometnica | Otvorena dozvola | 3 min | u prototipu |
| Grad Zagreb, prostorni slojevi (ArcGIS, CKAN) | Gradske četvrti, zborna mjesta civilne zaštite | Otvorena dozvola | dnevno | u prototipu |
| Grad Zagreb, prostorni slojevi | Ljekarne, vatrogasci, policija, javni zdenci, javni WC, knjižnice, muzeji, parkovi, biciklističke staze | Otvorena dozvola | dnevno | plan M2 |
| DHMZ | Trenutna mjerenja, prognoza, upozorenja CAP | Otvorena dozvola | 10 min; 30 min; 5 min | u prototipu |
| DHMZ | Hidrološki bilten (vodostaj Save) | Otvorena dozvola | dnevno | plan M2 |
| EMSC | Potresi (FDSN event servis) | uz navođenje izvora, prema uvjetima EMSC-a | 1 min | u prototipu |
| Informacijski sustav zaštite zraka RH (iszz.azo.hr) | Indeks kvalitete zraka (INSPIRE WFS/WMS) | uz navođenje izvora | 1 h | plan M2 |
| HŽ Putnički prijevoz | Statični GTFS (data.gov.hr) | licenca nije navedena, upit je M2 | dnevno | plan M2 |
| Grad Zagreb | Službeni glasnik Grada Zagreba (JSON API) | službeni tekstovi akata; uvjeti API-ja nisu objavljeni, upit Gradskom uredu je M2 | 1 h | u prototipu |
| Narodne novine | API s ELI identifikatorima | službeni tekstovi | dnevno | plan M2 |
| HRT | RSS Vijesti i Radio Sljeme (naslov, sažetak, poveznica) | tekst uz navođenje HRT-a i poveznicu; audio i video se ne prikazuju | 5 min | u prototipu |
| Zagrebački događaji (šest izvora: Kulturpunkt, Skupština, kvartovske novosti, plan komunalnih aktivnosti, ZET, Etnografski muzej) | Najave, sjednice, mjesna samouprava, komunalni radovi, prometne obavijesti, izložbe | CC BY-SA 3.0 HR (Kulturpunkt) i Otvorena dozvola (Skupština, kvartovske novosti, plan komunalnih aktivnosti, ZET); Etnografski muzej ne navodi licencu | 15 min | u prototipu, samo unutar sesije |
| Europeana, NSK, Wikidata, Wikimedia Commons | Baština Zagreba, metapodaci | CC0 / javno vlasništvo / CC BY-SA | dnevno | plan M2 |
| Grad Zagreb, dežurne ljekarne | Ručno održavana stranica | neslužbeni prikaz | popis s datumom provjere | u prototipu kao provjereni popis; strojni dohvat plan M5 |
| HAK | Stanje na cestama (tekst) | uz izvor, poveznicu i izvorno vrijeme | 10 min | plan M5 |
| HEP ODS, HEP Toplinarstvo, VIO | Planirani prekidi (neslužbeni prikaz) | uvjeti u provjeri | dnevno | plan M5 |
| NZJZ "Dr. Andrija Štampar" | Peludna prognoza | neslužbeni prikaz | dnevno | plan M5 |

Izvori su ocijenjeni zeleno (otvorena licenca, strojno čitljivo, bez ključa), žuto (službeni HTML, uz oprez i oznaku "neslužbeni prikaz") i crveno (zatvoreno; prikazuje se samo poveznica dok pisano odobrenje ne stigne). U prototipu su zeleni izvori, s dvije označene iznimke: Službeni glasnik, čiji API nema objavljene uvjete ponovne uporabe (upit Gradskom uredu je M2), i Etnografski muzej, koji ne navodi licencu i zato se prikazuje samo unutar sesije. Granicu između otvorene razine i razine sesije provodi kod: samo moduli otvorene razine ulaze u `/open`. Za zborna mjesta civilne zaštite prototip čita CKAN API portala data.zagreb.hr, čiji robots.txt ne dopušta put `/api/`; u M2 tražimo potvrdu Gradskog ureda ili prelazimo na izravnu adresu GeoJSON resursa, koja je dopuštena. Pisma ZET-u, HRT-u (audio i video) i HAK-u (kamere) te upit HŽPP-u o licenci dio su plana provedbe.

Redak "Zagrebački događaji" sažima šest izvora čiji puni popis, s adresom i licencom svakog pojedinačno, čuva `docs/izvori.md` i stranica `/izvori`:

- **Kulturpunkt** (najave) -- `https://kulturpunkt.hr/wp-json/wp/v2/kp_22_announcement?_fields=id,link,title,excerpt,class_list,date&per_page=40&orderby=date&order=desc` -- CC BY-SA 3.0 HR
- **Skupština Grada Zagreba** (rokovnik sjednica) -- `https://skupstina.zagreb.hr/rokovnik-sjednica/76` -- Otvorena dozvola
- **Kvartovske novosti** (mjesna samouprava) -- `https://aktivnosti.zagreb.hr/kvartovske-novosti/134585` -- Otvorena dozvola
- **Plan komunalnih aktivnosti** -- `https://data.zagreb.hr/dataset/fddb4f87-c002-4e3c-b988-adf013997ecc/resource/f90738b6-8bfa-4dd9-9db7-b3c532d90c97/download/data.json` -- Otvorena dozvola
- **ZET, obavijesti** -- `https://www.zet.hr/rss_novosti.aspx` i `https://www.zet.hr/rss_promet.aspx` -- Otvorena dozvola
- **Etnografski muzej** (događanja i izložbe) -- `https://emz.hr/wp-json/wp/v2/dogadjanja?_fields=id,link,title,type,meta,class_list,date&per_page=20&orderby=date&order=desc` i `https://emz.hr/wp-json/wp/v2/izlozbe?_fields=id,link,title,type,meta,class_list,date&per_page=20&orderby=date&order=desc` -- Licenca nije navedena

## 6. Kriteriji iz Priloga 1. Programa

### 6.1 Prethodno iskustvo prijavitelja u provedbi razvojnih ili istraživačkih programa (0–10 bodova)

Aning Film d.o.o. provodi projekte financirane iz javnih programa za razvoj i proizvodnju audiovizualnih djela: [[POPUNITI: tablica s programom (npr. HAVC, potpora za razvoj ili proizvodnju), godinom, projektom, ulogom tvrtke i rezultatom, iz službene filmografije i ugovora]]. Svaki od tih projekata prošao je ciklus koji traži i ovaj Program: prijava s planom i proračunom, ugovor, provedba u roku, sadržajni i financijski izvještaj. Ista osoba koja je vodila te projekte vodi i ovaj; iskustvo s razvojem i vođenjem softverskih proizvoda u produkciji opisano je pod 6.2, jer dokazuje kapacitet, a ne programsko iskustvo.

### 6.2 Kapacitet prijavitelja da kvalitetno provede predloženi program (0–10 bodova)

Prototip je na https://zagreb.aningfilm.hr prije roka prijave i javno je dostupan: otvoreni sloj, javni zaslon s rotirajućim kodom koji svatko može postaviti, skeniranje, sesija s istekom i deset modula izvora u sedam područja. Primitivi koje projekt koristi rade u produkciji drugih proizvoda prijavitelja i preneseni su datoteka po datoteku: psh.lat (uparivanje uređaja QR kodom i WebSocket na Cloudflare Durable Objects, dvojezično sučelje bez okvira) i kompmajstor.eu (Cloudflare Workers s ograničivačima brzine i brojanjem posjeta bez kolačića). Oba su javno dostupna i mogu se provjeriti u trenutku ocjenjivanja. Infrastruktura je plaćeni Cloudflare Workers račun s Durable Objects u produkciji. Suradnici po ulozi i satu su u financijskom planu: drugi razvojni inženjer za integracije izvora i testove, revizor pristupačnosti koji testira s korisnicima s invaliditetom, UX i motion dizajner, pravni i privacy pregled, instalater zaslona. Otvorena licenca i dokumentirana predaja koda smanjuju ovisnost o jednoj osobi. Repozitorij je trenutačno privatan; objava konačnog koda dio je financiranog projekta.

### 6.3 Tehnička izvedivost predloženog programa (0–10 bodova)

Arhitektura je na jednoj stranici (`docs/arhitektura.md`): jedan Worker, četiri Durable Object klase, KV, tri ograničivača brzine, bez baze korisnika. Protokol uparivanja slijedi provjerene obrasce (OAuth device flow, rotacija kodova kao TOTP, jednokratni tokeni, 40 bita entropije, provjera posjedovanja karticom potvrde), opisan je u `docs/arhitektura.md` i tipiziran u `worker/protocol.ts`. Svaki izvor ima ocjenu, rok dohvata od 6 sekundi, predmemoriju s TTL-om, posljednju dobru kopiju i status koji razlikuje živo, zastarjelo i nedostupno; stranica nikad nije prazna. Testovi: jedinični za svaki parser prema spremljenim živim uzorcima, integracijski za Durable Objects u Workers runtimeu, Playwright u dva preglednička konteksta za uparivanje i istek te u mobilnom projektu za telefon, axe i Lighthouse za pristupačnost. Postavljanje je `git push`; povratak na prethodnu inačicu je `git revert`. Prototip je dokaz izvedivosti u trenutku ocjenjivanja, ne obećanje.

### 6.4 Društvena korist predloženog programa (0–30 bodova)

Prvo, sigurnost bez prepreka: upozorenja, potresi, zatvaranja, zborna mjesta i ljekarne na jednoj stranici koja radi bez JavaScripta, na zaslonu bez telefona i na papiru. Drugo, inkluzija: zasloni u knjižnicama, uredima gradskih četvrti i prostorima udruga (predlažemo da Grad ugovorno odabere najmanje jednu lokaciju), utipkani kod za osobe koje ne koriste kameru, čitač zaslona koji vodi kroz svaki korak, veliki tip i riječi umjesto boja, engleski za posjetitelje, izjava o pristupačnosti s revizijom uz korisnike s invaliditetom dvaput tijekom projekta. Treće, privatnost kao struktura: nema računa, trajnog identifikatora korisnika, kolačića za praćenje, otiska uređaja ni zahtjeva za geolokaciju. IP adresa se ne pohranjuje i ne koristi kao obilježje osobe; prolazi kroz ograničivače učestalosti na rubu Cloudflarea i, kao kriptografski sažetak, kroz satnu kvotu samoposlužnih zaslona. Brojači imaju samo dan, sat, događaj i dvije dimenzije iz zatvorenih rječnika, stranica `/privatnost` navodi svaki događaj, a izjava o privatnosti prolazi pravni pregled u prvom mjesecu projekta. Četvrto, podatak za Grad: skup o potražnji za gradskim informacijama i izvještaj o pouzdanosti gradskih izvora, mjesečno, s pravom objave. Peto, korist za prostore: kafić, knjižnica ili udruga dobivaju sadržaj koji njihovim ljudima nešto kaže, bez troška, s pripremljenim uputama za osoblje. Šesto, vidljivost otvorenih podataka: svaki zaslon ispisuje "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom" svakome tko ga pogleda. Sedmo, produljenje vijeka uređaja: lagani način rada (1.10) čini stari prijenosnik, tablet ili televizor s Android kutijom upotrebljivim gradskim zaslonom bez instalacije i ažuriranja sustava; četiri od šest pilot zaslona su donirani uređaji, a matrica testiranih uređaja s izmjerenom potrošnjom objavljuje se javno.

### 6.5 Inovativnost predloženog programa (0–20 bodova)

Dosad financirani projekti ovog Programa (liste odabranih za 2024. i 2025. na zagreb.hr) vrijedne su aplikacije za pojedina područja: ZET info v3 za promet, ZgInfo.AI kao gradski asistent, Parlametar Zagreb za Skupštinu, ZG Legalbot za Službeni glasnik, ZG Air za zrak, Urban Score Zagreb za hodljivost, ZagrebViz za proračun. Kaj ima? se od njih razlikuje po kombinaciji šest stvari: (1) jedan pogled na grad preko sedam područja u stvarnom vremenu; (2) otključavanje prisutnošću, bez računa, aplikacije i kolačića, s rotirajućim jednokratnim kodovima koji rade i na istoj Wi-Fi mreži; (3) javni zasloni koji su korisni i bez skeniranja i koje osoba s telefonom može voditi; (4) anonimni skup o potražnji koji Grad dobiva pod licencom s pravom objave; (5) obrnuta hardverska logika: umjesto da javni zaslon traži novu opremu, projekt je projektiran za odbačenu, s objavljenim mjerilima i matricom testiranih uređaja, pa se mreža zaslona može širiti onime što gradu već leži po ladicama; (6) proizvod koji ne traži vrijeme korisnika: sesija sama završava, ništa ne obavještava, ništa ne podsjeća i ništa se ne preporučuje da bi se čovjek vratio, pa mjerila projekta broje sesije i dostupnost izvora, nikad zadržavanje. Ograničenja su svrha, a ne cijena: pogled se otključava pažnjom i prisutnošću, ne novcem, oglasima ni računom. Da bi ga otvorio, netko mora doći do zaslona u prostoru ili do druge osobe, što stvara susrete među ljudima, prostorima i ustanovama, a deset minuta poslije vraća čovjeka na ulicu.

### 6.6 Konačni proizvod dostupan je pod licencom otvorenog koda ili u slobodnoj domeni (0–10 bodova)

Da (Obrazac 2.2, točka 2.2.10). Konačni proizvod predaje se i objavljuje pod AGPL-3.0-or-later, s očuvanim zaglavljima prenesenih datoteka. Evaluacijski repozitorij https://github.com/matijarma/vidikovac trenutačno je privatan; objava koda dio je provedbe financiranog projekta. Gradu Zagrebu nudimo isti kod i pod EUPL-1.2, licencom Europske komisije prilagođenom javnim tijelima, kako bi ga mogao preuzeti i mijenjati pod uvjetima koje njegove službe već poznaju. Izvedeni podaci na `/open` su pod Otvorenom dozvolom s DCAT-AP katalogom, uz stalnu ponudu Gradu da ih objavi na data.zagreb.hr. Dokumentacija je na hrvatskom: arhitektura, protokol, vodič za zaslone, popis izvora, izjava o privatnosti, izjava o pristupačnosti. Skup o potražnji Grad dobiva pod posebnom neisključivom, trajnom, besplatnom licencom s pravom objave; mi ga ne objavljujemo, jer objava je odluka Grada.

### 6.7 Kvaliteta financijskog plana i opravdanost troškova (0–10 bodova)

Financijski plan je u Obrascu 3 i u `obrazac-3-financijski-plan.md`: 20.000,00 EUR bez PDV-a u pet redaka. Troškovi zaposlenih (500 sati voditelja projekta i glavnog razvoja) računaju se po satnici izvedenoj iz stvarne bruto plaće metodom godišnji trošak rada / 1.720 produktivnih sati (12,60 EUR) i dokazuju obračunom plaće i evidencijom sati po projektu; izračun je u Obrascu 3. Vanjski suradnici su navedeni po ulozi, satu i cijeni sata, a svaki ima isporuku u planu provedbe. Promidžba je 6 % ukupnog iznosa (iznad propisanih 5 %) i konkretna: video i titlovi, tiskani stalci i upute za prostore, prezentacija na ZGBitu, javno predstavljanje u pilot kafiću. Licence su stvarni godišnji trošak infrastrukture. Oprema (1.090,00 EUR) su dvije nove postave na Raspberry Pi 5 po 245 EUR, oživljavanje četiri donirana uređaja po 95 EUR, rezervni Pi, dva utična mjerača potrošnje i sitni materijal: zajedno šest pilot zaslona. Svaki euro ima isporuku i mjesec u planu provedbe.

## 7. Kako čitamo uvjet "rezultati nenaplatno dostupni javnosti"

Program (točka 5.) i Javni poziv (točka 3.) traže da rezultati budu nenaplatno dostupni javnosti. Kaj ima? ni od koga ne traži novac, račun, pretplatu ni članstvo. Sigurnosni sloj `/hitno` otvoren je svima bez ikakvog uvjeta i bez ograničenja trajanja; javni zaslon je čitljiv bez telefona; kod i izvedeni podaci su otvoreni; stranice `/izvori`, `/open`, `/privatnost` i `/pristupacnost` su javne. Skeniranje ograničava trajanje pogleda na vlastitom uređaju, ne krug ljudi koji ga mogu vidjeti, i može se ponoviti odmah; to je mehanizam proizvoda i zaštite od zlouporabe, a javno dostupna informacija ostaje javno dostupna. Predlažemo ugovorni minimum zaslona na lokacijama koje Grad odabere kako pristup ne bi ovisio o komercijalnim prostorima.

## 8. Poveznice

- Prototip: https://zagreb.aningfilm.hr · otvoreni sloj: https://zagreb.aningfilm.hr/hitno · izvori: https://zagreb.aningfilm.hr/izvori · otvoreni podaci: https://zagreb.aningfilm.hr/open/ · privatnost: https://zagreb.aningfilm.hr/privatnost · pristupačnost: https://zagreb.aningfilm.hr/pristupacnost
- Repozitorij: https://github.com/matijarma/vidikovac · arhitektura: `docs/arhitektura.md` · zasloni: `docs/kiosk.md` · izvori: `docs/izvori.md`
- Video: [[POPUNITI: poveznica]]

## Polja za ispunu prije predaje

Sva mjesta označena `[[POPUNITI: ...]]` popunjavaju se iz službenih registara i dokumenata tvrtke (sudski registar, filmografija i ugovori o potporama, poveznica na video). Skripta `npm run check:izvori -- --filing` odbija proći dok ijedno ostane.
