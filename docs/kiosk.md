# Kaj ima? · zaslon, postavljanje i provjera

## Pasivni pregled, odobrena izmjena 20. rujna 2026.

Ovaj ugovor zamjenjuje ranije upute u nastavku o pretraživanju dodirom,
traci vijesti u zaglavlju i zasebnim karticama događanja i iznimaka:

- Karta ostaje na jednom mjestu. Nema automatskih obilazaka ni općih
  kontrola istraživanja na zidu. Osobno istraživanje dostupno je na telefonu.
- Uz kartu stoje trenutni uvjeti, jedan istaknuti sadržaj i trajno rezerviran
  QR. Mobilnost i gradski život izmjenjuju se svakih 20 sekundi, s gumbom za
  zaustavljanje. Sigurnosne informacije ostaju vidljive.
- Istaknuti sadržaj navodi što, gdje, kada, izvor i starost. Odgovarajuća
  geometrija označena je bez pomicanja kamere; obuhvat baštine nije ulaz.
- QR ostaje najmanje 240 CSS piksela na dokumentiranim veličinama zaslona.
  Telefon na `/kiosk/` dobiva upute za postavljanje, kod i mali pregled.
- Skeniranje nikad ne prekida javni prikaz. Izričita prezentacija pauzira
  ambijentalnu izmjenu; potvrda preuzimanja i potvrda iscrtavanja ostaju.
- Postavke su prekidači: svaki klik odmah mijenja stanje; jedan okvir prema poslužitelju najviše svakih pet sekundi.

Provedba i rezultati provjere: `docs/readable-city-2026-09-20.md`.
Snimka preglednika nije dokaz čitljivosti stvarnog zida ili skeniranja s
udaljenosti. Ti testovi te Safari/VoiceOver ostaju uvjet prije pilota.

Upute za redizajnirani prototip od 17. rujna 2026. Zamjenjuju prethodne
rasporede i automatsko preuzimanje prikaza pri skeniranju.
Tehničko ime `vidikovac`, domena i ključevi pohrane ostaju nepromijenjeni.
Adresa je javna od 14. rujna 2026.; Cloudflare Access štiti samo operaterske
rute `/api/admin/*` i `/stats`.

## Postavljanje stvarnog zaslona

1. Na računalu ili zaslonu otvoriti https://zagreb.aningfilm.hr i na početnoj
   stranici odabrati „Otvori gradski zaslon” (stranica `/kiosk/`).
2. U polje **Adresa ili stajalište** upisati ulicu ili ime stajališta, ili
   polje ostaviti prazno. Već nakon dva slova polje predlaže tramvajska i
   autobusna stajališta te ulice; duga ulica nudi se po dijelovima, uz
   stajališta na njoj. Upisani kućni broj ostaje zapisan kao tekst, jer
   izvanmrežni popis ulica (`/data/streets-geo.json`, podaci OpenStreetMap,
   licenca ODbL 1.0) nema kućnih brojeva. Odabrano stajalište postaje mjesto
   zaslona. Kad je odabrana ulica, mjesto postaje najbliže tramvajsko
   stajalište unutar 400 m, inače najbliže autobusno stajalište unutar
   300 m, inače sama adresa. Redak ispod polja kaže što će zaslon prikazati:
   za odabrano mjesto „Na zaslonu: Kvaternikov trg i 6 stajališta uokolo”,
   a za prazno polje „Na zaslonu: cijeli grad.” Upisani tekst koji nije
   odabran među prijedlozima vrijedi samo kad je točno ime stajališta ili
   jedne ulice; inače polje javlja da takvog stajališta ni ulice nema i
   zaslon se ne stvara. Zatim pritisnuti **Pokreni**.

   S praznim poljem zaslon šalje `POST /api/screens` s praznim tijelom, kao
   i dosad, i dobiva redovnu postavu zaslona koja vrijedi 24 sata: prozor
   cijeloga grada, bez stajališta, a za popis i polaske mjesto je
   Trg bana J. Jelačića. S odabranim mjestom šalje `{ place, frame }`
   (stajalište kao `stopId`, adresa kao točka unutar Zagreba, kadar 6). Ime
   i točku stajališta poslužitelj uzima iz vlastite tablice, a područje
   (`area`, za statistiku) izvodi iz mjesta, inače `zagreb`. Postava sama ne
   daje otključanu sesiju.
3. Sve ostalo mijenja se poslije, na samom zaslonu. Dugi pritisak (0,8 s) na
   natpis „Kaj ima?” u zaglavlju otvara **Postavke**; s tipkovnice isto čini
   Enter ili razmaknica na tom natpisu. Kratak dodir i prst koji se pomakne
   za više od 12 piksela ne otvaraju ništa, a zaglavlje nema ni zupčanika ni
   gumba teme. Ploča se zatvara tipkom Esc, gumbom ili nakon 90 sekundi bez
   dodira i ne otvara se dok traje otključana sesija.

   Redovi su *Mjesto* (**Promijeni** otvara isto polje
   „Adresa ili stajalište” i gumb **Cijeli grad** za povratak na prozor
   cijeloga grada), *Kadar* („Kadar: 6 stajališta odavde”, redom 4, 6 i 8),
   *Prikaz* („Prikaz: karta” ili „Prikaz: shema”), *Tema*, *Ritam*
   („Ritam: 20 s”, redom 20, 30 i 60 s) i *Zaslon* (do kada vrijedi i
   „Zaboravi zaslon” s potvrdom). Kadar, Prikaz, Tema i Ritam imaju po jedan
   gumb koji kaže trenutačno stanje i klikom prelazi na sljedeće; gumba za
   spremanje nema. Prikaz, Tema i Ritam primjenjuju se odmah i ostaju u
   pregledniku zaslona (`vidikovac-kiosk-view`, `vidikovac-kiosk-rhythm` i
   postavka teme); poslužitelju se ne šalju.

   Mjesto i Kadar pripadaju postavi. Nakon posljednjeg klika zaslon čeka
   0,8 s i šalje jednu poruku `screen-set` verzije 2 (`place`, `frame`)
   preko postojeće veze zaslona, pa tri brza klika postaju jedna poruka s
   posljednjim stanjem. Sljedeća poruka ide tek pet sekundi nakon
   posljednjeg odgovora poslužitelja, a stanje koje poslužitelj već drži ne
   šalje se. Durable Object provjerava mjesto i kadar, iz mjesta izvodi
   područje, pamti sve troje i odgovara redovnim okvirom s kodovima svim
   otvorenim vezama zaslona. Tek taj odgovor ponovno kadrira kartu i
   mijenja zaglavlje; ploča pritom ostaje otvorena. Dok je ploča otvorena,
   prekriva pozornicu, pa karta pod pločom nema svoje kutije; zato se
   kamera ne pomiče dok ploča ne bude zatvorena, a pri zatvaranju karta se
   najprije ponovno izmjeri pa tek onda pomakne kameru. Bez toga je novo
   stajalište sletjelo otprilike trećinu kadra gore lijevo umjesto u
   sredinu.

   Za odbijenicu (`bad-place`, `bad-frame`) ploča piše
   „Poslužitelj nije prihvatio mjesto. Odaberi ponovno.” Za prebrzu
   promjenu (`screen-set-rate`) piše
   „Pričekaj koji trenutak pa odaberi ponovno.” Kad odgovor ne stigne u
   osam sekundi, ploča kaže da promjena nije poslana. U sva tri slučaja
   prekidači se vraćaju na stanje koje drži poslužitelj i ništa se ne šalje
   ponovno samo od sebe; odgovor koji ipak stigne poslije svejedno ponovno
   kadrira zaslon. Poruku `screen-set` verzije 1 (`stopId`, `area`) Durable
   Object i dalje prima, za zaslone na kojima je otvorena starija inačica
   aplikacije; uz takvu poruku kadar ostaje kakav je bio, a mjesto se izvodi
   iz stajališta.

   Mjesto kadrira i kartu pozivnice. Odabrano mjesto sjeda u sredinu, a
   polumjer kadra je zračna udaljenost do četvrtog, šestog ili osmog
   najbližeg tramvajskog stajališta oko mjesta (prema Kadru; peroni istog
   imena broje se jednom, a stajalište koje je samo mjesto ne broji se),
   izmjerena za svako mjesto posebno i uvijek između 500 m i 3 km. Gdje u
   krugu od 3 km nema tramvajskog stajališta, broje se autobusna. Zaslon
   bez odabranog mjesta (prazno polje ili **Cijeli grad**) drži prozor
   cijeloga grada. Zaglavlje čita isti odgovor i uvijek imenuje mjesto:
   stajalište ili ulicu, a za zaslon bez odabranog mjesta
   Trg bana J. Jelačića.
4. Telefonom skenirati aktualni QR ili utipkati kod na `/s/`. Uspješna
   provjera izravno otvara desetominutni pogled, bez drugog gumba „Otključaj”.
5. Zaslon nastavlja prikazivati pregled grada. Telefon pregledava privatno.
   Za prikazivanje otvoriti **Zaslon**, provjeriti cilj i odabrati
   **Prikaži ovaj pogled**. Za provjeru radne površine isti postupak radi
   u drugoj kartici preglednika.

Isti Wi-Fi je dopušten. Ne treba isključivati Wi-Fi ili trošiti mobilne podatke.
Kod je jednokratan, prikazuje se kao dvije skupine po četiri znaka i mijenja
svakih 30 sekundi. Istekli ili iskorišteni kod zamijeniti aktualnim sa zaslona.

Stvaranje je ograničeno na pet postava u kliznom satu po mreži s koje zahtjev
dolazi (ključ je HMAC prefiksa adrese, adresa se ne pohranjuje) i trideset ukupno. Osvježavanje već postavljenog zaslona koristi postojeće
vjerodajnice; ne stvara novu postavu. Nakon isteka ili opoziva nova se postava
pokreće izričitom radnjom, ne automatskom petljom.

## Što zaslon prikazuje

Normalan zaslon prikazuje koristan pregled grada i prije i nakon
skeniranja. Karta zauzima cijeli lijevi stupac i otvara se na prozoru
cijeloga grada, od Črnomerca do Maksimira i od Save do Mirogoja, a ne na
jednom stajalištu. Na njoj su tramvajska mreža u neutralnom sivom, ispod
svega ostaloga, pločice tramvaja u brendiranoj plavoj, sve BAJS stanice
kao tirkizni diskovi s brojem raspoloživih bicikala, zatvorene prometnice,
prsten dežurne ljekarne i aktivna kulturna mjesta. Imena se ne ispisuju:
ni nazivi gradskih četvrti s podloge, ni nazivi BAJS stanica i kulturnih
mjesta. Ispod zuma 13,5 (`THIN_NAMES_ZOOM`) prozor ispušta i promovirana
imena glavnih ulica s podloge i naslove zbornih mjesta -- kvadrati ostaju,
jer u izvanrednom stanju oznaka je ta koja govori, a ne ime -- a od
stajališta imenuje samo tramvajska čvorišta: ona na kojima staje tramvaj i
na kojima neka vožnja počinje ili završava (`terminal` iz mrežnog
artefakta), njih 29 u gradu i dvanaest na zadnjoj snimci. Broj linija nije
mjerilo: 111 od 114 tramvajskih stajališta vidi dvije ili više tramvajskih
linija, pa bi "dva tramvaja" imenovalo gotovo sve. Od 13,5 naviše sva se
imena vraćaju onakva kakva su izvedena za kadar od 2,8 km. Stanica bez
bicikala ili sa zastarjelim očitanjem stoji blijeđa.
Autobusi -- kapsule i njihove linije -- pridružuju se tramvajima tek kad je
kamera na zumu 14 ili bliže; tristo kapsula nad cijelim gradom zakrilo bi
tramvaje o kojima slika govori. Brojevi vozila prorjeđuju se pri
preklapanju, a položaji ostaju označeni točkama.

Odabrano mjesto nadjačava prozor kadrom od 4, 6 ili 8 stajališta (Kadar);
gradska četvrt više se ne bira. Stajališta ostaju
dodirljivi prstenovi i na gradskom kadru, uz toleranciju dodira od 28 CSS
piksela, jer prst na zidu nije miš na stolu. Dodir na stajalište otvara
istraživanje grada, s imenima, i prvo kaže koji tramvaji i autobusi dolaze
i za koliko minuta; 90 sekundi bez dodira vraća prozor.

Desni stupac nosi tri ploče i pozivnicu. **Vrijeme**: opažanje (ikona,
temperatura, riječ stanja) te današnji i sutrašnji raspon; pripovjedni
tekst DHMZ-a preselio se u traku zaglavlja. **Promet**: samo iznimke,
linije čiji je medijan izvan pojasa točnosti za najmanje tri minute, jer
je manje od toga vozni red koji diše, a ne vijest, uz broj zatvaranja i
broj ZET-ovih obavijesti. Kad je stajalište postavljeno, prve
idu njegove vlastite linije -- zaslon pod zaglavljem koje imenuje Trg bana
J. Jelačića ispisivao je dva autobusa koji ondje uopće ne staju -- a unutar
svake skupine vrijedi gradski redoslijed: linije koje kasne prije onih koje
voze ranije, tramvaji prije autobusa. Ploča nosi do tri linije na širokom i
okomitom zaslonu, do dvije na zbijenom, a ostatak sažima u „+N linija
kasni”, i taj broj ostaje gradski: zakašnjela linija dvije četvrti dalje i
dalje je vijest na zidu. Kad nema iznimke, kaže „Linije voze po redu”.
Kad je stajalište postavljeno, ta ploča prestaje biti popis iznimaka i
postaje ploča dolazaka tog stajališta (`kiosk/arrivals.ts`): procjena iz
ZET-ovih podataka o vozilima gdje je vozilo praćeno, inače vozni red, i
svaki red kaže koje je od toga. Iznimke se tada čitaju u traci zaglavlja.
**Događanja** popunjavaju preostalu visinu: prvo aktivna mjesta s brojem
događaja, zatim datirani događaji, a kad ni toga nema, jedna mirna
rečenica. Ploča nikad ne ostaje prazna: nosi barem jedan cijeli redak, a
ploča Promet ustupa svoje retke dok Događanja ne dođu do dva.
**Pozivnica** je visoka koliko i QR kod: QR uz tekst, kod ispod teksta u
istom stupcu i na stalnoj veličini, s trakom napretka ispod njega.

Zaglavlje nosi mjesto, datum i vrijeme, a između njih traku gradskih
vijesti: po jedna stavka odjednom, obojena natuknica (VRIJEME, PROMET,
RADOVI, VEČERAS, GRAD) i jedna rečenica, izmjena svakih 8 sekundi uz
prijelaz od 220 milisekundi, a bez prijelaza kad je uključen smanjeni
pokret. Nema pomične trake ni teksta koji klizi. Pločica sesije i
obavijest o uparivanju imaju prednost nad trakom. Rečenice dolaze iz istih
modula iz kojih i ploče; duge izvorne tekstove poslužitelj jednom strojno
sažme u jednu rečenicu, a kad sažetka nema, stoji izvorni naslov.

Sigurnosna traka uvijek ostaje vidljiva i imenuje stanje izvora,
upozorenje kada postoji i dežurnu ljekarnu. Izvori, datum događanja i
vrijeme opažanja nisu zamjenjivi.

Broj stavki bira se prema korisnosti i raspoloživom prostoru. Popunjena
ploča ne smije postati prazna samo da bi se uklonilo prelijevanje teksta.
Rasporedi za 1920 × 1080, 1366 × 768 i okomiti totem namjerno su
različiti; QR na tim zaslonima ostaje najmanje 240 CSS piksela.
Dežurna ljekarna na karti nosi prsten; adresa se uz njega ispisuje tek kad
je kamera u kvartu, a na prozoru cijeloga grada puni naziv nosi sigurnosna
traka.

Radovi u tijeku broje se za cijeli grad i ploča to kaže izričito
(„Radovi u gradu”); ni odabrano mjesto ne sužava taj broj, nego kadrira
samo kartu.
Adresa `/kiosk/` više ne prima dodatak `?prizor=`: nema više odabira
prizora jer postoji samo jedan. Aplikacija i dalje poštuje sustavnu
postavku smanjenog pokreta preglednika, ali sada zaustavlja samo glatki
prijelaz pri pomicanju vozila na karti; podaci se i dalje osvježavaju kao
i inače.

Izričit prikaz na zaslon šalje samo javni izbor: područje, liniju,
stajalište ili stavku te vremenski raspon tog pogleda.
Šest područja imaju raspored za gledanje s udaljenosti.
Tekst pretrage, spremljeni popisi i koordinate uređaja ne prenose se.

Nova osoba koja skenira ne prekida postojeći prikaz. Ako želi prikazati
svoj pogled, mora potvrditi **Preuzmi i prikaži**. Prethodna osoba
nastavlja vlastitu sesiju, a oba uređaja vide promjenu upravljanja.
Poruka **Prikazano na zaslonu** pojavljuje se tek nakon potvrde iscrtavanja
sa zaslona. Ako potvrda ne stigne u osam sekundi, telefon kaže da prikaz
nije potvrđen i nudi ponovni pokušaj.

**Vrati pregled grada** završava prikazivanje, ne osobnu sesiju. Kratak
prekid veze telefona ne briše sadržaj javnog zaslona. Ponovno povezivanje
zaslona vraća važeći prikaz uz novu potvrdu. Istek sesije izlagača vraća
pregled grada. „Podijeli grad” daje drugoj osobi vlastitih pet minuta u
zasebnoj sesiji, bez daljnjeg dijeljenja i bez upravljanja javnim zaslonom.

Nakon isteka povezane sesije zaslon se vraća pozivu sa svježim kodom. Telefon
zadržava označeni zamrznuti prikaz i dostupne izvoze; osvježavanje prestaje.
Istek 24-satne postave zaustavlja nove kodove, ali ne skraćuje već otvorene
sesije.

### Osnovno, bez telefona

„Osnovno”, koje se otvara riječju stanja na sigurnosnoj traci (mirno,
upozorenje ili nepotvrđeno), prikazuje dostupna upozorenja, zatvaranja, linije u blizini,
vrijeme i podatke o dežurnoj ljekarni, bez otvaranja sesije. Nedostupni
podaci nisu potvrda da je sve u redu. „Natrag”, Escape ili 90 sekundi bez
aktivnosti vraćaju poziv za skeniranje. Taj se vremenski povratak primjenjuje
samo izvan aktivne povezane sesije.

Sigurnosni `/hitno` također radi bez sesije i bez JavaScripta, javno.

### Granice podataka

- Položaj vozila je modelirana procjena iz ZET-ovih očitanja, ne dolazak na
  stajalište. Medijan na ploči Promet je očitanje linije, ne kašnjenje
  izabranog vozila.
- Vrijeme dolaska je procjena, i tako je označeno. Polazak kojemu je pronađeno
  praćeno vozilo računa se iz voznog reda i kašnjenja koje ZET sam objavljuje
  za to vozilo, a kad se blizanac i ZET slože oko sljedećeg stajališta,
  prevladava blizančeva procjena dolaska na to stajalište; takav redak kaže
  „za N min”. Ostali polasci zadržavaju svoje vrijeme po voznom redu i
  prikazuju se kao sat. Popis to kaže u jednoj rečenici ispod redaka:
  „Procjena iz ZET-ovih podataka o vozilima; ostalo po voznom redu.” Ništa se
  ne izmišlja: bez praćenog vozila nema odbrojavanja.
- Nedostajući ili neupotrebljivo velik medijan ne prikazuje se kao „na vrijeme”
  niti se skraćuje na izmišljenu vrijednost. Sirovi izvor ostaje neizmijenjen.
- Prekid izvora zaustavlja procijenjeno kretanje. Posljednji podaci mogu ostati
  vidljivi uz oznaku zastarjelosti.
- Prognoza prikazuje stvarne dnevne vrijednosti, ne izmišljeni satni niz.
- Nedatirane obavijesti nisu današnja događanja; trajanje izložbe nije novo
  otvorenje svakog dana.
- Podaci o ljekarni ne znače jamstvo da je ona trenutačno najbliža korisniku.
  Aplikacija ne traži korisnikovu geolokaciju.
- Kvaliteta zraka i arhivska građa nisu implementirane integracije ovog
  prototipa. HŽ-ove ploče prikazuju samo vrijeme po voznom redu: za vlakove
  nema praćenih vozila, pa nema ni procjene dolaska.
- „Zadnji polazak” je posljednji polazak po voznom redu ZET-a, ne procjena
  dolaska.
- Rečenice u traci zaglavlja strojno su sažete. Dugačak izvorni tekst (naziv
  akta iz glasnika, pripovjedna prognoza DHMZ-a, obavijest ZET-a, opis radova,
  kvartovska vijest) poslužitelj jednom sažme modelom Workers AI u jednu
  rečenicu i zapamti je; to je prilagodba, a ne izvorni tekst. Sažimaju se samo
  izvori s otvorenom licencom, sažetak se nikad ne objavljuje na `/open`, a kad
  ga nema, traka prikazuje izvorni naslov. Na telefonu ostaje izvorni naslov.

## Lagani prikaz

`/kiosk/?lagano=1` uključuje lagani prikaz. `?lagano=0` bira puni prikaz.
Postavka se pamti lokalno. Bez izričitog izbora aplikacija može odabrati
lagani prikaz prema dostupnoj memoriji, štednji podataka ili nedostupnom WebGL-u.

Lagani prikaz ne učitava MapLibre, mrežni geometrijski artefakt ni web-fontove,
i ne stvara canvas. Umjesto karte ostaje uporabiv popis linija i tekstualni
sadržaj. Redovno uparivanje, QR, kod, sigurnost i „Osnovno” nastavljaju raditi.

`test/app/budget.test.ts` gradi produkcijske datoteke i provjerava početni
lagani graf ispod 200 kB komprimiranog HTML-a, CSS-a i JavaScripta. Zasebno
mjeri puni mapni JavaScript, uključujući zasebni MapLibre worker, prema cilju
600 kB. Odgovori izvora i kartografske pločice mjere se odvojeno.
`e2e/lagano.spec.ts` provjerava stvarne mrežne zahtjeve i vidljivost koda.

Lagani način nije obećanje podrške svakom starom pregledniku. Trenutačni
paket koristi moderne ES module. ES2017 inačica, mjerenje memorije i snage
te fizička matrica doniranih uređaja ostaju zadaci financiranog pilota.
Prije postave održavati operacijski sustav i preglednik ažurnima.

## Mreža, pohrana i administracija

Kartografske pločice, glifovi, simboli, fontovi, skripte, API i WebSocket
poslužuju se s iste domene. Preglednik radi prikaza karte ne poziva
`tile.openstreetmap.org`. Privatni R2 spremnik `vidikovac-maps` drži regionalni
arhiv; podrijetlo i licence su u `app/public/maps/README.md`.

Vjerodajnice postavljenog zaslona čuvaju se u njegovu pregledniku. One nisu kod
za goste i ne šalju se e-poštom, ne stavljaju u snimke zaslona ni repozitorij.
Brisanje podataka preglednika uklanja lokalnu postavu. Za trajni zaslon koristiti
običan profil: privatni prozor pri zatvaranju briše postavu.

Administrativni API `/api/admin/beacons` služi postavama i opozivu uz
provjerenu Access autorizaciju. Samoposluga `/api/screens` koristi isti
BeaconDO/RoomDO protokol. Nema zasebne demonstracijske sesije.

Za prikaz preko cijelog zaslona upotrijebiti mogućnost preglednika. U postavkama
uređaja osigurati da se zaslon ne gasi tijekom rada. Automatsko pokretanje
na ciljnom Raspberry Pi ili doniranom uređaju provjerava se u pilotu; ova
verzija ne tvrdi da su fizičke postave već testirane.

## Shema tramvajskih linija

`/kiosk/?prikaz=shema` umjesto geografske karte prikazuje ponovno iscrtanu ZET-ovu
tramvajsku shemu. `?prikaz=karta` izričito bira gradsku kartu; bez parametra vrijedi
lokalna postavka `kajima:map-mode:v1`, zadano gradska karta. Parametar ostaje u URL-u
nakon uklanjanja jednokratnih podataka za postavljanje. Prozor zadržava jedno
polje i ploče naslovnice: `prikaz` bira samo renderer, a umirovljeni `prizor`
ne vraća rotaciju poglavlja.

Zaslon sa stajalištem koje postoji na shemi pokazuje čitljiv kadar oko njega,
s nazivima od najmanje 24 CSS px. Bez prepoznatog stajališta, a tako je na
zaslonu pokrenutom s praznim poljem ili s adresom kao mjestom, pokazuje
cijelu mrežu bez sitnih naziva. Shema nije interaktivna na zaslonu i zanemaruje
geografsku kameru. Ploče ne prekrivaju polje pa nema donje tračnice ni
dodatnog odmaka kadra.
Prikazuje samo tramvaje čija se postojeća staza može smjestiti na nacrt.
Autobusi, gradske točke i obrisi četvrti nisu dio tog prikaza.
`?lagano=1` je nepromijenjen i ne učitava shemu.

Krug F ne mijenja ponašanje zaslona osim na dva mjesta. Prvo: oznake vozila i
njihove skupine (pločica za tramvaj, kapsula za autobus) **nikad se ne ispuštaju** --
sudarni prolaz karte ne odbacuje nijednu oznaku, a gužvu drži čitljivom spajanje
preklopljenih oznaka u jednu skupinu s natpisom tipa „6·11·12·14”, računato na
zaslonovoj skali oznaka, pa se oznake ne spajaju na pola stvarne udaljenosti.
Drugo: shema na zaslonu vozi **isti sudarni prolaz naziva kao svaka druga
površina**, samo sa svojim stajalištem prvim u rangu -- zaslon koji pokaže baš
svaki naziv pokaže ih jedne preko drugih. Donja granica naziva od 24 CSS px i
kadar oko vlastitog stajališta ostaju nepromijenjeni. Prekidača „samo ova linija”
na zaslonu nema.

## Razvoj i automatska provjera

Lokalni Worker mora imati `APP_ENV=test` i izričite tajne iz `.dev.vars`.
`E2E_ADMIN_BYPASS` vrijedi samo u tom okruženju, ne ovisi o umirovljenoj
postavci `NETWORK_CHECK`. Ne postavljati razvojni način na produkcijskom Workeru.

```sh
npm run typecheck
npm test
npm run e2e
node scripts/review-experience.mjs
node scripts/review-redesign.mjs
```

Playwright ima zaseban lokalni poslužitelj za 12-sekundni test isteka.
Za provjeru javne adrese dovoljan je postojeći testni zaslon (`E2E_KIOSK_URL`),
bez slanja vjerodajnica u izvještaje.

Snimke i automatizirani rezultati nisu dokaz da je QR fizički skeniran s nekoliko
metara ili da je aplikacija provjerena na iPhoneu i Androidu. Takva mjerenja
bilježe se zasebno, s uređajem, preglednikom, datumom i opaženim rezultatom.

## Rješavanje problema

| Simptom | Provjera i postupak |
|---|---|
| Pojavljuje se početni zaslon | Nema valjane lokalne postave; upisati adresu ili stajalište, ili polje ostaviti prazno za cijeli grad, pa pritisnuti **Pokreni**. |
| Stvaranje je odbijeno | Kod 429 znači dosegnuto ograničenje po mreži ili ukupno; slijediti navedeno vrijeme ponovnog pokušaja. Kod 403 znači zahtjev s druge domene. |
| Treba promijeniti mjesto ili kadar | Dugi pritisak (0,8 s) na „Kaj ima?” u zaglavlju otvara **Postavke**. Postavke se ne otvaraju dok traje otključana sesija; pričekati da sesija istekne ili zaustaviti sesiju. |
| Promjena u Postavkama ne uspijeva | Ploča ostaje otvorena, kaže razlog i vraća prekidače na stanje koje drži poslužitelj. Odbijenica (`bad-place`, `bad-frame`) znači da Durable Object nije prihvatio mjesto ili kadar. Poruka o prebrzoj promjeni (`screen-set-rate`) znači da je od prethodne prihvaćene promjene prošlo manje od pet sekundi, pa pričekati i odabrati ponovno. Ako odgovor ne stigne u osam sekundi, ploča kaže da promjena nije poslana; odgovor koji ipak stigne poslije svejedno ponovno kadrira zaslon. |
| Postava je istekla ili opozvana | Pokrenuti novu postavu izričito. Ne ponavljati automatski stvaranje. |
| Kod je istekao ili iskorišten | Upisati novi aktualni kod; provjeriti automatsko podešavanje sata uređaja. |
| Telefon ne završava povezivanje | Nakon kratkih ponovnih pokušaja sučelje nudi novi ulazak; upotrijebiti svježi kod. |
| Prikaz nije potvrđen | Provjeriti vezu zaslona, zatim ponoviti zahtjev u ploči Zaslon. „Poslano” nije dokaz prikaza. |
| Zaslon treba osvježiti | Učitana je starija inačica zaslona bez protokola prikazivanja; osvježiti `/kiosk/`. |
| Druga osoba vodi zaslon | Pregledavanje ostaje dostupno; preuzimanje traži izričitu potvrdu. |
| Zaslon je otvoren u drugoj kartici | Jedna postava ima jednu aktivnu vezu. Zatvoriti staru karticu ili osvježiti željenu. |
| Izvor je zastario ili nedostupan | Zadnja dobra kopija nije trenutačna potvrda; provjeriti izvor i mogućnost ponovnog dohvata. |
| Karta ne radi | Koristiti pretragu i popis ili `?lagano=1`; provjeriti lokalni R2 arhiv pri razvoju. |

Isporuka ide isključivo kroz provjereni `git push` i postojeći Cloudflare Build.
Ne koristi se `wrangler deploy`; Access na operaterskim rutama i privatnost repozitorija ostaju očuvani.

Pri isporuci redizajna osvježiti dugotrajno otvorene zaslone. Dodana
SQLite pohrana i poruke protokola ne brišu postave, kodove ni osobne
sesije. Starija osobna sesija može se nastaviti do svog roka; za novi
prikaz koristi se osvježena aplikacija. Dokumenti poslane prijave
ostaju neizmijenjeni.
