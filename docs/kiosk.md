# Kaj ima? · zaslon, postavljanje i provjera

## Javni zaslon, odobreno 22. rujna 2026.

Vlasnik je 22. rujna 2026. odobrio javni zaslon opisan u nastavku. Taj ugovor
zamjenjuje pasivni pregled od 20. rujna 2026. (trenutni uvjeti i istaknuti
sadržaj u izmjeni svakih 20 sekundi, uz gumb za pauzu), traku vijesti u
zaglavlju, zasebne kartice vremena, prometa, događanja i iznimaka te ranije
upute o pretraživanju dodirom. Ukratko:

- U zaglavlju su natpis „Kaj ima?”, mjesto (stajalište ili ulica, a za zaslon
  bez odabranog mjesta Trg bana J. Jelačića), jedna rečenica s obojenom
  natuknicom, datum i sat. Rečenica ima najviše 80 znakova, nikad se ne reže
  trotočjem i mijenja se u ritmu zaslona, zadano svakih 20 sekundi.
- Karta prikazuje mjesto i 6 stajališta uokolo (postavka Kadar: 4, 6 ili 8
  stajališta odavde); polumjer kadra mjeri se za svako mjesto posebno. Zaslon
  postavljen na cijeli grad drži prozor cijeloga grada. Karta ističe ono o
  čemu govori rečenica u zaglavlju, bez pomicanja kamere; obuhvat baštine nije
  ulaz. Nema automatskih obilazaka ni kontrola istraživanja na zaslonu;
  osobno istraživanje dostupno je na telefonu.
- Uz kartu stoji popis „U blizini · 2 km · ~15 min” (naslov ispisuje
  izmjereni polumjer kruga i vrijeme hoda; primjer vrijedi za krug od 2 km):
  najviše tri polaska, plavo „za N min” za praćeno vozilo i sivi sat za vozni
  red, zatim redovi s vremenom i na kraju jedan redak „uvijek”.
- Ispod popisa trajno je rezerviran QR s uvodom
  „Skeniraj za 10 minuta grada.”, kodom i adresom za upis koda. Sam QR kod
  ima najmanje 240 CSS piksela na dokumentiranim veličinama zaslona, na
  podlozi od 264 piksela. Telefon na `/kiosk/` dobiva upute za postavljanje,
  kod i mali pregled.
- Na pregledu grada nema vremena dohvata, napomena o izvoru, svježini ili
  pouzdanosti ni brojeva bez imena. Nema ni gumba za posjetitelja: ni za
  pauzu, ni za kopiranje koda, ni za temu ili postavke. Pozivnica nudi samo
  jednu radnju: skeniranje.
- Sigurnosna traka uvijek je vidljiva i nosi stanje, izvore bez vremena i
  dežurnu ljekarnu kao zeleni križ, „24/7” i adresu.
- Zadana tema zaslona prati sunce, pa zaslon noću prelazi na tamnu paletu.
  Kad ZET ne šalje položaje vozila, karta ostaje karta bez vozila, s jednom
  tihom napomenom, a svaki je polazak siv sat po voznom redu.
- Dodir, gdje ga zaslon ima, služi samo za čitanje: dodir na prsten
  stajališta 60 sekundi pokazuje polaske s tog stajališta, a zatim se zaslon
  sam vraća. Sadržaj se može ponijeti samo skeniranjem.
- Skeniranje nikad ne prekida javni prikaz. Izričita prezentacija zaustavlja
  rečenicu i popis; potvrda preuzimanja i potvrda iscrtavanja ostaju.
- Za postavljanje postoje samo polje „Adresa ili stajalište” i **Pokreni**.
  Dugi pritisak na natpis „Kaj ima?” otvara Postavke s prekidačima Mjesto,
  Kadar, Prikaz, Tema i Ritam.
- Postavke su prekidači: svaki klik odmah mijenja stanje; jedan okvir prema poslužitelju najviše svakih pet sekundi.
- Na telefonu se nakon deset minuta sadržaj briše: ostaju poziv na novo
  skeniranje i poveznica na `/hitno`.

Plan i razlozi izmjene: `docs/companion-2026-09-22.md` (§11 do §13); provjera
od 20. rujna ostaje u `docs/readable-city-2026-09-20.md`. Snimka preglednika
nije dokaz čitljivosti stvarnog zaslona ili skeniranja s udaljenosti. Ti
testovi te Safari/VoiceOver ostaju uvjet prije pilota.

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
   jedne ulice; inače se ispod polja pojavljuje rečenica da takvog
   stajališta ni ulice nema, a zaslon se ne stvara. Zatim pritisnuti
   **Pokreni**.

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
   za više od 12 piksela ne otvaraju ništa, a u zaglavlju nema gumba ni za
   postavke ni za temu. Ploča se zatvara tipkom Esc, gumbom ili nakon 90
   sekundi bez dodira i ne otvara se dok traje otključana sesija.

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
   polumjer kadra mjeri se do četvrtog, šestog ili osmog stajališta niz
   tramvajske linije koje ondje staju (prema Kadru; peroni istog
   imena broje se jednom). Mjeri se za svako mjesto posebno i uvijek je
   između 500 m i 3 km. Gdje u
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
skeniranja. Karta zauzima cijeli lijevi stupac. Zaslon postavljen na cijeli
grad (polje „Adresa ili stajalište” ostavljeno prazno) otvara kartu na
prozoru cijeloga grada, od Črnomerca do Maksimira i od Save do Mirogoja;
zaslon s izabranim mjestom otvara kadar oko tog mjesta, opisan u sljedećem
odlomku. Na prozoru cijeloga grada su tramvajska mreža u neutralnom sivom,
ispod svega ostaloga, pločice tramvaja u brendiranoj plavoj, sve BAJS
stanice kao male tirkizne točke bez broja, zatvorene prometnice, prsten
dežurne ljekarne i kulturna mjesta s programom večeras. Imena se ne ispisuju:
ni nazivi gradskih četvrti s podloge, ni nazivi BAJS stanica i kulturnih
mjesta. Ispod zuma 13,5 (`THIN_NAMES_ZOOM`) prozor ispušta i promovirana
imena glavnih ulica s podloge i naslove zbornih mjesta -- kvadrati ostaju,
jer u izvanrednom stanju oznaka je ta koja govori, a ne ime -- a od
stajališta imenuje samo tramvajska čvorišta: ona na kojima staje tramvaj i
na kojima neka vožnja počinje ili završava (`terminal` iz mrežnog
artefakta), njih 29 u gradu i dvanaest na zadnjoj snimci. Broj linija nije
mjerilo: 111 od 114 tramvajskih stajališta vidi dvije ili više tramvajskih
linija, pa bi "dva tramvaja" imenovalo gotovo sve. Od 13,5 naviše sva se
imena vraćaju onakva kakva su izvedena za kadar od 2,8 km.
Autobusi -- kapsule i njihove linije -- pridružuju se tramvajima tek kad je
kamera na zumu 14 ili bliže; tristo kapsula nad cijelim gradom zakrilo bi
tramvaje o kojima slika govori. Brojevi vozila prorjeđuju se pri
preklapanju, a položaji ostaju označeni točkama.

Zaslon s izabranim mjestom, stajalištem ili adresom, otvara kartu na kadru
oko tog mjesta: kadar obuhvaća onoliko stajališta koliko kaže postavka
Kadar, 4, 6 ili 8, zadano 6. Polumjer kadra mjeri se za svako mjesto
posebno, kao udaljenost do N-tog stajališta niz linije tramvaja koji ondje
staju (autobusna stajališta broje se samo kad u krugu od 3 km nema nijednog
tramvajskog stajališta), i uvijek je između 500 m i 3 km; tablica
1,3 / 2 / 2,7 km vrijedi samo dok stajališta nisu učitana. Kamera, krug
popisa „U blizini” i naslov tog popisa čitaju isti izmjereni broj, pa naslov
ispisuje izmjerenu udaljenost i vrijeme hoda, na primjer
„U blizini · 2 km · ~15 min”.
Kadar je susjedstvo: autobusi i autobusne linije na kadru su u svako doba
dana; svaka BAJS stanica je disk s brojem raspoloživih bicikala, siv s nulom
kad bicikala nema, a siv i bez broja kad broj nije poznat ili stanica ne
iznajmljuje, nikad s upitnikom; kulturna mjesta pojavljuju se samo s
programom večeras, i to s imenom; imenuju se važnija stajališta (po rangu iz
mrežnog artefakta), sva tramvajska čvorišta i glavne ulice. Imena slijede
kadar, a ne zum, pa Kadar 4, 6 ili 8 ne mijenja što se imenuje. Na karti
nema oznake „+N”: nema geografskih skupina mjesta, a spojena oznaka vozila
ispisuje svaku liniju. Legenda uz kartu ima tri stavke bez upitnika
(„Tramvajska linija”, „BAJS: broj bicikala”, „Kultura večeras”), a pod
`?lagano=1`, gdje karte nema, nema ni legende.

Gradska četvrt više se ne bira. Dodir na karti služi samo za čitanje.
Stajališta su dodirljivi prstenovi i na gradskom kadru, uz toleranciju dodira
od 28 CSS piksela, jer prst na zaslonu nije miš na stolu. Dodir na prsten
60 sekundi pokazuje sljedeće polaske s tog stajališta, dodir na redak popisa
pokazuje pojedinosti retka (mjesto održavanja, adresu i tramvaj do
odredišta), a dodir na dežurnu ljekarnu adresu i telefon ljekarne. Zatim se
zaslon sam vraća. Karta se pritom ne pomiče, pretrage i izbornika nema, a
sadržaj se može ponijeti samo skeniranjem.

Desni stupac nosi popis „U blizini”, a ispod popisa pozivnicu. Naslov popisa
ispisuje polumjer kruga i vrijeme hoda, na primjer
„U blizini · 2,2 km · ~16 min”. Popis je jedna vremenska os oko mjesta. Prvo
idu polasci, najviše tri: plavo „za N min” za praćeno vozilo u idućih deset
minuta, a sivi sat za vozni red i za svaki kasniji polazak. Zatim slijede
redovi s vremenom: kraj zatvaranja prometnice, događanje s mjestom
održavanja i tramvajem do mjesta događanja, sljedeći zalazak ili izlazak
sunca (nikad oba), večerašnji zadnji polasci kao jedan redak, četiri sata
unaprijed, prvi jutarnji tramvaj od 22 sata dok ne krene i, kad se večer
isprazni, sutrašnja otvaranja tržnica i muzeja iz kataloga. Na kraju stoji
jedan redak „uvijek”: priča o imenu mjesta ili zaštićena građevina u
blizini, naizmjence svakih 20 minuta, a od 22 do 6 sati dežurna ljekarna
24/7. Nijedan redak ne nosi napomenu o izvoru, svježini ili pouzdanosti:
boja razlikuje praćeno vozilo od voznog reda, a izvori su na telefonu i na
`/izvori`. Na popisu su samo cijeli redovi, onoliko koliko ih stane;
najmanja visina retka, od 64 do 92 piksela, ovisi o broju stavki, pa manje
stavki znači veće retke, a redak s duljim tekstom viši je. Ništa se ne reže
trotočjem: predug redak ispisuje kraći cjeloviti naziv iz izvora ili se
prelama u cijelosti; kad redovi ne stanu, s popisa izlaze cijeli redovi,
najprije najkasniji, a prvi redak iza polazaka tek nakon kasnijih polazaka.
Redak se ne iscrtava ponovno dok ostaje na popisu: novi redak ulazi na dnu,
postupno se pojavi i zatim zauzme svoje mjesto u vremenu; prošli izlazi na
vrhu, a bez promjene ništa se ne pomiče. Zatvaranje prometnice ostaje na
popisu i kad posljednji dohvat nije uspio: neuspjeli dohvat ne otvara ulicu.
**Pozivnica** je visoka koliko i QR kod: uz QR stoje uvod
„Skeniraj za 10 minuta grada.”, kod ispod teksta u istom stupcu i na stalnoj
veličini, s trakom napretka ispod koda, i adresa za upis koda. Nema retka o
koristi ni gumba za kopiranje.

Zaglavlje nosi naziv, mjesto, datum i vrijeme, a između mjesta i datuma
jednu rečenicu: obojenu natuknicu (Promet, Kultura, Vrijeme, Bicikli, Noćas,
Radovi) i najviše 80 znakova, a na zbijenom i okomitom rasporedu te na
telefonu najviše 64. Rečenica se mijenja u ritmu zaslona, zadano svakih 20
sekundi, uz prijelaz od 220 milisekundi, a bez prijelaza kad je uključen
smanjeni pokret ili lagani prikaz. Nema pomične trake, teksta koji klizi ni
trotočja: preduga rečenica preskače se, a ne reže. Pločica sesije i
obavijest o uparivanju imaju prednost pred rečenicom, a izričita
prezentacija zaustavlja i rečenicu i popis. Rečenica nastaje iz istih
činjenica kao popis, uz vremenske prilike, zatvaranja i BAJS stanice u
krugu. Dok su na raspolaganju barem tri podatka, isti se podatak u zaglavlju
ne pojavljuje više od jednom u deset minuta, ni drugim riječima; s manje
podataka samo se ista rečenica ne ponavlja doslovno unutar deset minuta.

Sigurnosna traka uvijek ostaje vidljiva i imenuje stanje izvora te
upozorenje kada postoji; kad upozorenja nema, imenuje izvore („DHMZ · EMSC”)
bez vremena dohvata. Dežurnu ljekarnu traka pokazuje kao zeleni križ, „24/7”
i kratku adresu. Izvori, datum događanja i vrijeme opažanja nisu zamjenjivi.

Broj stavki bira se prema korisnosti i raspoloživom prostoru. Popunjena
ploča ne smije postati prazna samo da bi se uklonilo prelijevanje teksta.
Rasporedi za 1920 × 1080, 1366 × 768 i okomiti totem namjerno su
različiti; sam QR kod na tim zaslonima ima najmanje 240 CSS piksela.
Dežurna ljekarna na karti nosi prsten; adresa uz prsten ispisuje se tek kad
je kamera u kvartu, a zeleni križ i kratku adresu uvijek nosi sigurnosna
traka.

Na pregledu grada radovi se ne broje: zatvaranje prometnice u krugu mjesta
redak je popisa „U blizini” s vremenom završetka, a zatvaranja su ucrtana i
na karti.
Adresa `/kiosk/` više ne prima dodatak `?prizor=`: nema više odabira
prizora jer postoji samo jedan. Aplikacija i dalje poštuje sustavnu
postavku smanjenog pokreta preglednika, ali sada zaustavlja samo glatki
prijelaz pri pomicanju vozila na karti; podaci se i dalje osvježavaju kao
i inače.

Izričit prikaz na zaslon šalje samo javni izbor: područje, liniju,
stajalište ili stavku te vremenski raspon tog pogleda.
Svako od šest područja ima raspored za gledanje s udaljenosti.
Tekst pretrage, spremljeni popisi i koordinate uređaja ne prenose se.

Tekst se ne reže trotočjem ni u šest rasporeda za gledanje s udaljenosti:
s popisa izlaze cijeli redovi, najprije posljednji, a opis prognoze ili
upozorenja gubi cijele rečenice od kraja ili izostaje u cijelosti.

Nova osoba koja skenira ne prekida postojeći prikaz. Ako želi prikazati
svoj pogled, mora potvrditi **Preuzmi i prikaži**. Prethodna osoba
nastavlja vlastitu sesiju, a oba uređaja vide promjenu upravljanja.
Poruka **Prikazano na zaslonu** pojavljuje se tek nakon potvrde iscrtavanja
sa zaslona. Ako potvrda ne stigne u osam sekundi, telefon kaže da prikaz
nije potvrđen i nudi ponovni pokušaj.

**Vrati pregled grada** završava prikazivanje, ne osobnu sesiju.
Na zaslonu nema gumba za prekid: prikaz završava izlagačev telefon, istek ili potvrđeno preuzimanje.
Kratak prekid veze telefona ne briše sadržaj javnog zaslona. Ponovno povezivanje
zaslona vraća važeći prikaz uz novu potvrdu. Istek sesije izlagača vraća
pregled grada. „Podijeli grad” daje drugoj osobi vlastitih pet minuta u
zasebnoj sesiji, bez daljnjeg dijeljenja i bez upravljanja javnim zaslonom.

Nakon isteka povezane sesije zaslon se vraća pozivu sa svježim kodom. Na
telefonu se tada sadržaj briše: ostaju poziv na novo skeniranje koda sa
zaslona i poveznica na `/hitno`, a podaci se više ne dohvaćaju. Zamrznutog
prikaza i izvoza nema. Istek 24-satne postave zaustavlja nove kodove, ali ne
skraćuje već otvorene sesije.

### Osnovno, bez telefona

„Osnovno” se otvara riječju stanja na sigurnosnoj traci (mirno, upozorenje
ili nepotvrđeno) i služi samo za čitanje: prikazuje dostupna upozorenja,
zatvaranja, linije u blizini, vrijeme i podatke o dežurnoj ljekarni, bez
otvaranja sesije. Kartice se ne
režu: što ne stane u cijelosti, izostaje, počevši od posljednje kartice, pa
na manjem zaslonu prva izostaje dežurna ljekarna, a zeleni križ i adresu
ljekarne i tada nosi sigurnosna traka. Nedostupni podaci nisu potvrda da je
sve u redu. „Natrag”, Escape ili 90 sekundi bez
aktivnosti vraćaju poziv za skeniranje. Taj se vremenski povratak primjenjuje
samo izvan aktivne povezane sesije.

Sigurnosni `/hitno` također radi bez sesije i bez JavaScripta, javno.

### Granice podataka

- Položaj vozila je modelirana procjena iz ZET-ovih očitanja, ne dolazak na
  stajalište. Medijan na ploči Promet je očitanje linije, ne kašnjenje
  izabranog vozila.
- Vrijeme dolaska procjenjuje se samo za polazak s pronađenim praćenim
  vozilom: računa se iz voznog reda i kašnjenja koje ZET sam objavljuje za to
  vozilo, a kad se blizanac i ZET slože oko sljedećeg stajališta, prevladava
  blizančeva procjena dolaska na to stajalište. Takav redak u idućih deset
  minuta kaže „za N min” i plav je. Svaki drugi polazak zadržava vrijeme po
  voznom redu i ispisuje se kao siv sat. Razliku nose boja i oblik vremena, a
  ne natpis: na popisu „U blizini” nema riječi „procjena” ni rečenice ispod
  redaka. Na telefonu čitač zaslona praćeni redak najavljuje riječju
  „uživo”, a jedna rečenica o tome odakle procjena dolazi prikazuje se samo
  u pojedinostima stajališta. Ništa se ne izmišlja: bez praćenog vozila nema
  odbrojavanja.
- Nedostajući ili neupotrebljivo velik medijan ne prikazuje se kao „na vrijeme”
  niti se skraćuje na izmišljenu vrijednost. Sirovi izvor ostaje neizmijenjen.
- Prekid izvora zaustavlja procijenjeno kretanje. Na telefonu posljednji
  podaci mogu ostati vidljivi uz oznaku zastarjelosti; pregled grada na
  zaslonu ne ispisuje ni oznake svježine ni vrijeme dohvata.
- Kad ZET ne šalje položaje vozila, karta na pregledu grada ostaje karta
  (mreža, stajališta, BAJS stanice, zatvaranja i mjesta), ali bez vozila i s
  jednom tihom napomenom na karti. Svaki je polazak na popisu tada ispisan
  kao vrijeme po voznom redu, a rečenica u zaglavlju kaže ono što se zna.
  Nijedan naslov ne kaže „nedostupno”.
- Prognoza prikazuje stvarne dnevne vrijednosti, ne izmišljeni satni niz.
- Nedatirane obavijesti nisu današnja događanja; trajanje izložbe nije novo
  otvorenje svakog dana.
- Podaci o ljekarni ne jamče da je riječ o najbližoj ljekarni.
  Aplikacija ne traži korisnikovu geolokaciju.
- Kvaliteta zraka i arhivska građa nisu implementirane integracije ovog
  prototipa. HŽ-ove ploče prikazuju samo vrijeme po voznom redu: za vlakove
  nema praćenih vozila, pa nema ni procjene dolaska.
- „Zadnji polazak” je posljednji polazak po voznom redu ZET-a, ne procjena
  dolaska.
- Svaka rečenica u zaglavlju odobreni je predložak ispunjen jednom
  činjenicom samog zaslona (polasci, zatvaranja, događanja, sunce, vremenske
  prilike, BAJS stanice, ljekarna), ne izvornim tekstom. Poslužitelj
  (`POST /api/kiosk/sentences`) modelu Workers AI nudi samo provjerene
  predloške s vrijednostima; model smije samo birati među ponuđenima i ne
  piše vlastite riječi. Poslužitelj prihvaća rečenicu samo ako ima najviše 80
  znakova, nema trotočja i ako točno odgovara jednoj od poslanih činjenica;
  prihvaćene rečenice pamti dvadeset minuta, a zaslon ih prije prikaza
  ponovno provjerava prema trenutačnim činjenicama. Rečenice iz stalnih
  predložaka nad istim činjenicama uvijek su u izmjeni, pa zaglavlje nikad ne
  čeka model; bez modela, pod `APP_ENV=test` ili kad model ne odgovori u šest
  sekundi, zaglavlje nosi samo predloške. Rečenica vrijedi dok vrijedi
  činjenica: rečenica o zadnjem tramvaju nestaje kad tramvaj ode, a rečenica
  o zalasku sunca nakon zalaska. To je izvedeno čitanje, a ne izvorni tekst;
  izvorni naslovi ostaju na telefonu.
- Tekst iz vanjskih registara i izvora (nazivi, naslovi, adrese, opisi)
  provjerava se prije prikaza na zaslonu (`shared/kiosk/external-text.ts`).
  Ako vrijednost ne prođe provjeru, izostaje zajedno sa svojim retkom ili
  rečenicom; nikad se ne popravlja ni ne skraćuje. Zaglavlje, kao glas grada,
  provjerava se strože od redaka popisa.

## Lagani prikaz

`/kiosk/?lagano=1` uključuje lagani prikaz. `?lagano=0` bira puni prikaz.
Postavka se pamti lokalno. Bez izričitog izbora aplikacija može odabrati
lagani prikaz prema dostupnoj memoriji, štednji podataka ili nedostupnom WebGL-u.

Lagani prikaz ne učitava MapLibre, mrežni geometrijski artefakt ni web-fontove,
i ne stvara canvas. Umjesto karte ostaje uporabiv popis linija i tekstualni
sadržaj. Redovno uparivanje, QR, kod, sigurnost i „Osnovno” nastavljaju raditi.
Na telefonu lagani prikaz Karte zadržava cijelu ploču, s pretragom,
pojedinostima stajališta i popisom „U blizini”, samo bez karte i bez
prekidača između karte i sheme.

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
lokalna postavka `kajima:map-mode:v1`, zadano gradska karta. Na pregledu grada
prekidač **Prikaz** čita i postavku `vidikovac-kiosk-view`: izbor sheme
uključuje shemu, a izričiti `?prikaz=shema` ima prednost pred izborom karte.
Parametar ostaje u URL-u
nakon uklanjanja jednokratnih podataka za postavljanje. Prozor zadržava jedno
polje i ploče naslovnice: `prikaz` bira samo renderer, a umirovljeni `prizor`
ne vraća rotaciju poglavlja.

Shema na pregledu grada pokazuje cijelu mrežu bez zumiranja, neovisno o
odabranom mjestu i Kadru. Shema nije interaktivna na zaslonu i zanemaruje
geografsku kameru. Ploče ne prekrivaju polje pa nema donje tračnice ni
dodatnog odmaka kadra.
Prikazuje samo tramvaje čija se postojeća staza može smjestiti na nacrt.
Autobusi, gradske točke i obrisi četvrti nisu dio tog prikaza.
`?lagano=1` je nepromijenjen i ne učitava shemu.

Krug F ne mijenja ponašanje zaslona osim na dva mjesta. Prvo: oznake vozila i
njihove skupine (pločica za tramvaj, kapsula za autobus) **nikad se ne ispuštaju**:
sudarni prolaz karte ne odbacuje nijednu oznaku, a gužvu drži čitljivom spajanje
preklopljenih oznaka u jednu skupinu s natpisom tipa „6·11·12·14”, računato na
zaslonovoj skali oznaka, pa se oznake ne spajaju na pola stvarne udaljenosti.
Spojena oznaka ispisuje svaku liniju, nikad „+N”, i širi se s natpisom: svih
petnaest tramvajskih linija stane u jedan redak, natpis dulji od četrdeset
znakova (veliko autobusno čvorište) prelama se u drugi redak i, po potrebi, u
treći; tek natpis koji ne stane ni u tri retka od po četrdeset znakova zadržava
samo cijele linije koje stanu.
Drugo: shema na zaslonu primjenjuje **isti sudarni prolaz naziva kao svaka
druga površina**. Pregled grada pritom pokazuje cijelu mrežu, bez zasebnog
kadra oko mjesta. Prekidača „samo ova linija”
na zaslonu nema.

## Razvoj i automatska provjera

Lokalni Worker mora imati `APP_ENV=test` i izričite tajne iz `.dev.vars`.
`E2E_ADMIN_BYPASS` vrijedi samo u tom okruženju, ne ovisi o umirovljenoj
postavci `NETWORK_CHECK`. Ne postavljati razvojni način na produkcijskom Workeru.

```sh
npm run typecheck
npm run typecheck:tests
npm test
npm run e2e
npm run accept
npm run accept:e2e
npm run replay:grade -- <direktorij-okvira> --out <prefiks> --targets stage1
npm run review:visual
node scripts/review-redesign.mjs
```

`npm run accept` i `npm run accept:e2e` pokreću razinu prihvaćanja, namjerno crvenu do isporuke
odgovarajućeg paketa; `npm test` i `npm run e2e` ne pokreću tu razinu.
`npm run replay:grade` ocjenjuje staze tramvaja nad snimljenim okvirima i uz `--targets stage1`
završava izlaznim kodom 1 čim ijedan redak ne dosegne prag. Pragovi, izmjerene vrijednosti i
ručne provjere nalaze se u `docs/kaj-verification.md`, u odjeljku „Prihvaćanje, companion 2026-09”.

Playwright ima zaseban lokalni poslužitelj za 12-sekundni test isteka.
Za provjeru javne adrese dovoljan je postojeći testni zaslon (`E2E_KIOSK_URL`),
bez slanja vjerodajnica u izvještaje.

Nakon svake isporuke stanje u produkciji provjerava se samo čitanjem, na zaslonu
postavljenom toga dana:
`E2E_KIOSK_URL=<adresa postave zaslona> npm run observe:production -- --minutes 10`.
Skripta nikad ne stvara zaslon, ne prikazuje pogled na zaslonu, ne otvara
postavke i na zaslonu ništa ne pritišće; bez `E2E_KIOSK_URL` završava s izlaznim
kodom 2 prije ijednog zahtjeva. Deset minuta čita zaslon na 1920 × 1080, zatim
uspravno na 1080 × 1920, i snima umanjenu sliku za provjeru s tri metra
(DPR 0,25). U međuvremenu telefon (Pixel 7) i stolno računalo (1440 × 900)
iskoriste po jedan kod sa zaslona, s najmanje 12 sekundi razmaka. Nalazi se
zapisuju u `review.local/observe-<vrijeme>/` (`inventory.json`, `rotation.jsonl`,
`legibility.json`, `report.md`), a tajna iz adrese i kodovi u tim su datotekama
prikriveni. Izlazni kod je 1 čim ne prođe bilo koji prag iz odjeljaka 16.3 i 16.4
dokumenta `docs/companion-2026-09-22.md`. Pragovi su jedna tablica u skripti i
svaki redak nosi oznaku isporuke: `--stage d1` provjerava samo oznake vozila, na
kojima ne smije biti „+N”, i greške u pregledniku i na mreži, a bez te zastavice
primjenjuju se svi pragovi.

Snimke i automatizirani rezultati nisu dokaz da je QR fizički skeniran s nekoliko
metara ili da je aplikacija provjerena na iPhoneu i Androidu. Takva mjerenja
bilježe se zasebno, u tablici „Ručne provjere na uređaju” dokumenta
`docs/kaj-verification.md`, s uređajem, preglednikom, datumom i opaženim rezultatom.

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
