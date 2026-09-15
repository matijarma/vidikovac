# Kaj ima? · provjera prototipa

Datum provjere: 13. rujna 2026., dopunjen 14. i 15. rujna 2026. Dokument prati integrirani prototip,
ne obećava provjere na fizičkim uređajima koje nisu provedene.

## Integrirani rezultati

| Provjera | Integrirani rezultat |
|---|---|
| TypeScript aplikacije i Workera, produkcijska gradnja | prolazi |
| Cijeli Vitest skup | 135 datoteka, 1.625 testova prolazi |
| Playwright | 52 testa prolaze |
| Vizualna matrica aplikacije | 56 prikaza, bez horizontalnog prelijevanja i ozbiljnih/kritičnih axe nalaza |
| Lagani početni paket, gzip | zaslon približno 104 kB, telefon 114 kB; granica 200 kB |
| Puni mapni JavaScript, uključujući zasebni worker | približno 484–490 kB gzip; cilj 600 kB |
| Početne kartografske pločice, 390 i 1440 px | 295.118 primljenih bajtova; granica 1.500.000 |
| Vanjski zahtjevi preglednika pri otvaranju karte | nijedan |

Test ograničenja broja sesija jednom je prešao pet sekundi pri istodobnoj
gradnji, velikoj vizualnoj matrici i drugim preglednicima. Izolirana provjera
te zatim ponovna provjera cijelog skupa prolaze, bez promjene njegovih tvrdnji
ili vremenskog limita.

## Scenariji u pravom pregledniku

- Odabir četvrti i stvarnog stajališta, stvaranje privremenog zaslona, kod,
  potvrda na drugom pregledniku i redovna sesija.
- Ista mreža radi; token otvara podatke, izostavljen ili izmijenjen token
  ne otvara ih, a iskorišteni kod ne radi ponovno.
- Jednokratno dijeljenje daje zasebnu petominutnu sesiju, bez promjene roka
  izvornog telefona i zaslona, bez daljnjeg dijeljenja.
- U posebnom lokalnom okruženju sesija od 12 sekundi zamrzava telefon,
  vraća poziv na zaslon i prestaje otvarati podatke svojim tokenom.
- Sedam područja, jedna aktivna radna površina; dostupna navigacija tijekom
  nedostupnosti izvora; zastarjeli podaci ne postaju potvrđeno „sve u redu”.
- Proširenje karte stvarno povećava njezinu visinu, zadržava canvas i
  kontrolu sesije; oporavak nakon isteka ostaje vidljiv; Escape izlazi.
- Broj frameova i vidljivo kretanje na karti, smanjeno kretanje, tipkovnički
  put do linije i vozila te nazivi kontrola.
- Bez WebGL-a radi pretraga stajališta i popis linija. `/hitno` radi bez
  JavaScripta, u svijetloj i tamnoj temi.
- Zaslon na 1366 × 768 i 1920 × 1080: QR najmanje 240 CSS piksela,
  kod i „Osnovno” bez prelijevanja, karta ostaje glavni dio poziva.
- Lagani prikaz ne traži fontove ni geometrijski artefakt i nema canvas.
- Stvarno neuspjeli dohvat označava zadnju kopiju zastarjelom, zaustavlja
  mapu i oporavlja se nakon sljedećeg uspješnog odgovora.
- Ispis odabranog akta zadržava atribuciju i poveznice, čak i ako su izvori
  bili sklopljeni. Tamna tema i isključene pozadinske grafike ne skrivaju 112.
- Sigurnosni prečac nakon isteka otvara `/hitno`, bez ponovnog otvaranja sesije.
- Dok prvi dohvat još traje, zaslon pokazuje učitavanje, ne nula vozila ili
  tvrdnju da nema novih obavijesti.

## Vizualna matrica i ograničenja dokaza

Skripta `scripts/review-experience.mjs` pokriva svih sedam područja na
390, 768 i 1440 piksela; svijetlu i tamnu temu; engleski uz smanjeno kretanje;
200% veličinu teksta na telefonu i radnoj površini. Provjerava i očuvanje
polja pretrage, kursora i canvasa nakon osvježavanja. Koristi stvarne parser
uzorke kroz testne mrežne odgovore; proizvod nema demonstracijsku zaobilaznicu.

Rezultati i snimke pohranjuju se lokalno u `review.local/final/`. Fable i
Codex pregledavaju stvarno renderirane snimke, ne zaključuju vizualnu kvalitetu
samo iz zelenih testova. Kiosk je pregledan i nakon popravka stanja mreže,
vremenskih granica i primarnih naslova, na obje ciljane veličine u obje teme.
Primarni naslovi više nisu skraćeni trotočkom; kraći popisi navode broj
prikazanih stavki, a krediti navode stvarne izvore i njihove licence.

Nisu provedeni fizičko skeniranje s udaljenosti, test stvarnog iPhonea/Androida,
mjerenje potrošnje električne energije ili istraživanje s korisnicima pomoćnih
tehnologija. To ostaje odvojena provjera pilota.

## Metoda

Od preinake za telefon (13. rujna 2026.) Playwright ima dva projekta: `chromium`
za stolno računalo i `mobile`, emulirani Pixel 7 s dodirom, koji izvodi
`e2e/mobile.spec.ts` i `e2e/a11y-session.spec.ts`. Geometrijske provjere iz
`e2e/geometry.ts` traže ljepljivo zaglavlje iznad sadržaja, obavijesti u toku
stranice umjesto preko sadržaja, traku kartica uz donji rub i stranicu bez
vodoravnog prelijevanja, na 390 × 844, 320 × 568 i 844 × 390. Detenti plahte na
Prometu, klizanje nasuprot pomicanju karte, granične visine Grada i Sigurnosti
te stanje pri 200 % teksta imaju vlastite testove. Donja granica veličine teksta
na telefonu je 13 px, osim redaka s atribucijom; svaka poveznica u izvorima ima
cilj od 44 px. Pragovi i pravila zapisani su na jednom mjestu, u
`e2e/geometry.ts`, koje čitaju i `e2e/mobile.spec.ts` i
`scripts/audit-production.mjs`, pa se svaka promjena praga odražava u oba
nalaza. Sesija na `/d/` prolazi axe s oznakama WCAG 2.2 AA na 390 i 1920 px, u
obje teme, uz obilazak tipkom Tab koji provjerava da fokus nikad ne završi pod
zaglavljem ili trakom. `npm run review:visual` snima proširenu matricu
(320, pejzaž, tamna tema uz 200 % teksta, tablet, javne stranice na 390 px i
lagani Promet), a `scripts/audit-production.mjs` obilazi stvarnu instalaciju s
pristupnim tokenom iz okoline i vraća izlazni kod 1 kad zakaže bilo koje pravilo
geometrije, veličine teksta, cilja ili prelijevanja. Ovaj odlomak opisuje metodu;
rezultati se bilježe tek nakon pokretanja na spojenoj grani.

## Preinaka za telefon, 13. i 14. rujna 2026.

Preinaka je isporučena u tri koraka, svaki nakon zelenog prolaza cijelog
lanca (TypeScript oba projekta, Vitest, gradnja, Playwright u oba projekta,
vizualna matrica, Lighthouse) na spojenoj grani `main`. Brojke su iz zapisa tih
prolaza; nijedan korak nije objavljen s crvenim testom.

| Korak | Isporučeno | Vitest | Playwright | Matrica | Lighthouse |
|---|---|---|---|---|---|
| `d839978`, 13. 9. 21:17 UTC | ljuska s ljepljivim zaglavljem, obavijesti u toku, Promet kao karta s plahtom, ciljevi 44 px, donja granica 13 px, ograničeni popisi, mobilni Playwright projekt | 1.615 + 136 (Worker) | 69 | 89 prikaza, 0 nalaza | 100 na svih pet stranica |
| `6eb07a9`, 14. 9. 03:28 UTC | sustav oznaka linije, komponirana Sada, stolna traka, imenik Još, gibanje, svih šest područja | 1.838 | 69 | 89 / 0 | 100 × 5 |
| `f9dcaef`, 14. 9. 11:39 UTC | trenuci sesije (kartica završetka, datirani zamrznuti prikaz), plahta sesije s dijeljenjem naglas, stranica za skeniranje s poljem na prvom mjestu, `/hitno` kao Sigurnost i `/open/` u generiranoj paleti | 1.956 | 69 | 89 / 0 | 100 × 5 |
| `82a9655`, 14. 9. 12:34 UTC | naslovnica za telefon (skeniranje prvo), čarobnjak zaslona na telefonu, `/d/` bez sobe, prozne stranice, samoposluga zaslona s quotom po mreži (javna adresa) | 1.976 | 69 | 89 / 0 | 100 × 5 |
| `b21b9a8`, 14. 9. 16:16 UTC | kiosk na zajedničkim tokenima s četiri razine teksta, ikone i oznaka linije, imenovani upareni prikazi, gumb teme sa solarnim zadanim, portret 1080 × 1920 | 2.113 | 76 | 89 / 0 | 100 × 5 |
| `eb9aae5`, 14. 9. 18:42 UTC | jedan katalog nizova s tankim adapterima za Promet i kiosk, mrtvi ključevi uklonjeni u oba jezika, kanonske rečenice (`Nema zatvorenih prometnica.` i na `/hitno`), DCAT naslov, čuvari kopije, stranica privatnosti za javnu adresu | 2.012 + 139 (Worker) | 76 | 89 / 0 | 100 × 5 |

Nakon svakog koraka provjereno je da paket `/d/` koji poslužuje evaluacijska
adresa ima isti otisak kao paket koji je prošao lanac.

Isporuka od 14. 9. navečer (prijavni paket nakon tri neprijateljska čitanja,
teaser bez HRT-ovih uvoda, vrsta prostora u brojačima sesija, zborna mjesta
izravno s adrese resursa umjesto CKAN `/api/`): TypeScript oba projekta,
Vitest 147 datoteka / 2.141 testova i gradnja prolaze; Playwright je proveden
ciljano (kiosk raspored i oporavak, uparivanje, samoposluga zaslona, axe:
33 prolaze, 1 preskočen po dizajnu) jer promjene ne diraju raspored telefona;
vizualna matrica i Lighthouse nisu ponovno pokrenuti za ovu isporuku.

Dvije provjere iz plana još nisu provedene i ovaj ih dokument ne tvrdi:

- provjera na fizičkom iPhoneu i Androidu (težina Manropea, povlačenje plahte,
  istek sesije, čitanje tramvaja i autobusa na karti); u emuliranom WebKitu s
  opisom iPhonea `document.fonts` javlja učitane Manrope 400, 500 i 700;
- obilazak stvarne instalacije skriptom `scripts/audit-production.mjs` na
  fizičkim uređajima; emulirani obilazak je proveden, vidi dolje.

Obilazak stvarne instalacije (`scripts/audit-production.mjs`, WebKit s opisom
iPhonea 13, Chromium kao Pixel 7 i stolno računalo 1440 px, kiosk 1366 i 1920):
13. 9. skripta je dosegla adresu, ali samoposluga zaslona odgovarala je 403
`evaluation-access-required` jer je Access prestao davati identitet servisnom
tokenu; 14. 9. adresa je javna i quota zaslona vezana je za mrežu, pa obilazak
radi bez tokena (skripta prima i `AUDIT_KIOSK_URL`, adresu postojećeg zaslona,
i tada ne stvara novi). Tri obilaska istog dana, svaki nad ispravkama prethodnog:

| Obilazak | Isporuka | Snimke | Kršenja pravila | Što je ostalo |
|---|---|---|---|---|
| 12:35 UTC | `82a9655` | 54 | 91 (cilj 78, veličina teksta 10, zaglavlje 3) | poveznica za preskakanje 40 px na svakoj stranici, poveznice kartografske atribucije mjerene kao gumbi, retci atribucije na `/hitno` mjereni kao sadržaj, dva pravila kriva (strop zaglavlja pri 200 %, preklapanje čitano u koordinatama prozora) |
| 12:57 UTC | `41689d4` | 52 | 2 (cilj) | "Izvori" u podnožju `/hitno` 40 px široko, "City" na engleskom pregledu 42 px |
| 13:30 UTC | `94c87e0` | 58 | 1 (cilj) | "Izvori" u podnožju `/hitno` 40 px široko (ispravak u sljedećoj isporuci) |

Isti dan u 13:55 UTC dva Playwrightova scenarija iz `e2e/pairing.spec.ts`
provedena su nad stvarnom instalacijom s postojećim zaslonom: skeniranje koje
otključava oba uređaja, token koji čuva `/api/data`, kod iskoristiv jednom
(prolazi u 5,9 s) i dijeljenje u jednom skoku, vlastitih pet minuta drugog
telefona bez produljenja izvorne sesije (prolazi u 9,2 s).

Mjerena vremena u trećem obilasku: otključavanje 3,2 s na iPhoneu, 3,0 s na
Androidu, 2,4 s na stolnom računalu; pri 4× usporenju procesora i 1,6 Mbit/s
karta je spremna nakon 10,8 s (plan bilježi 14 s prije preinake). Manrope 400,
500 i 700 učitani su u sva tri stroja. Do 14. 9. 15:17 UTC rub je u svaku
HTML stranicu ubacivao Cloudflare Web Analytics skriptu (postavka cijele zone
`aningfilm.hr`), koju CSP odbija; od te isporuke svaki HTML odgovor nosi
`Cache-Control: no-transform`, pa rub stranicu poslužuje kako je napisana i
skripte više nema ni na jednoj stranici (provjereno s korisničkim agentom
preglednika na `/`, `/d/`, `/s/`, `/kiosk/`, `/izvori/`, `/hitno` i `/open/`).

Dva testa u mobilnom projektu bila su do 14. 9. namjerno označena kao očekivano
crvena dok zadatak koji ih rješava ne stigne: granična visina Sigurnosti
(2.500 px pri 390 px, rješena s područjem Sigurnost) i redoslijed radnji na
naslovnici (skeniranje prije poveznice na zaslon, traka uživo iznad preloma,
rješeno s naslovnicom). Od isporuke `82a9655` oba se provjeravaju bez iznimke.

## Sustav „Dan grada”, 15. rujna 2026.

Sustav „Dan grada” (`newdesignsystem.md`: jedna vremenska os, jedna gramatika
pločica, jedna zagrebačka plava, papir i ultramarin) isporučen je u tri vala,
svaki nakon zelenog prolaza cijelog lanca (TypeScript oba projekta, Vitest,
gradnja, Playwright u oba projekta, vizualna matrica, Lighthouse) na spojenoj
grani `main`. Brojke su iz zapisa tih prolaza
(`.superpowers/sdd/2026-09-15-dan-grada/gate-logs/`); nijedan val nije
objavljen s crvenim testom.

| Val | Isporučeno | Vitest | Playwright | Matrica | Lighthouse |
|---|---|---|---|---|---|
| `03ee3e3`, 15. 9. 00:40 UTC | paleta „papir i ultramarin” s OKLCH parovima u `tokens.css`, tipografski tokeni pločica, karta u papirnoj i noćnoj paleti, gramatika pločica `.tl` (vrijednost · vrijeme · traka · redak · tinta), sedam glifova, oznaka linije `xs`, statične zastavice, zajednički status vremena | 2.215 (150 datoteka) | 75 | 89 prikaza, 0 nalaza | 100 na svih pet stranica |
| `770648b`, 15. 9. 09:45 UTC | vremenska traka sada · poslijepodne · večeras · sutra · tjedan s proizvođačima pločica po području, statusna linija od 52 px na telefonu i 56 px na stolu, Kvart kao kartica ljuske s izborom četvrti, izričito slanje na zaslon (gumb i FAB umjesto zrcaljenja), spremljene linije i stanice, obavijesti kao istaknuća, četvrti u Workeru (`data.district`, `ScreenStop.district`), kiosk s okvirom 96/96, vremenom u zaglavlju i rotirajućim prizorima Promet · Večeras · Grad, glifovi u šest radnih površina | 2.532 (161 datoteka) | 83 | 89 / 0 | 100 × 5 |
| `43bc478`, 15. 9. 11:18 UTC | zadnji polazak po liniji sa stanice iz statičkog ZET GTFS-a (2.529 datoteka po stanici, `FEED_LASTRUN`), proizvođači pločica za bicikle, garaže i odvoz iza zastavica (isključeni dok izvori ne postoje), istaknuća s obavijesti na traci, kiosk drži okvir uz živo upozorenje DHMZ-a (stupac Sada bez bloka vremena, osnovno u tri stupca), skripta obilaska instalacije hoda novom ljuskom | 2.603 (165 datoteka); vidi napomenu | 83 | 89 / 0 | 100 × 5 |
| `bf6ed6c`, 15. 9. 12:11 UTC | upareni stupac Sada slijedi presudu sigurnosti (samo zatvaranja dok je mirno; upozorenja uz njih na 1920, sama na 1366 kad je hitno), zaglavlje kioska u jednom retku u svakoj veličini i stanju (pločica sesije zadržava širinu, čip popušta, u portretu i upareno na 1366 odlaze datum i podnaslov), portretno polje prizora slaže kartu iznad jednog retka pločica linija a Večeras i Grad odozgo, stražar preklapanja zaglavlja u Playwrightu; pin na uklonjeni blok vremena prepisan; test ograničenja sesija dobio granicu po svom obliku (31 kruga kroz Durable Object) | 2.606 (165 datoteka) | 83 (lanac preglednika na `7074b6f`, jedan test-only zapis ispod) | 89 / 0 | 100 × 5 |

Napomena o poštenju brojki: isporuka `43bc478` otišla je s jednim crvenim
zastarjelim pinom u `test/app/kiosk-local.test.ts` (pin na blok vremena koji je
upravo ta isporuka uklonila iz uparenog stupca Sada); cijeli Vitest skup nije
bio ponovno pokrenut nakon tog ispravka, nego samo kiosk datoteke. Pin je
prepisan u `99bc62a` prije sljedeće isporuke i od tada jedinični lanac
(TypeScript, Vitest, gradnja) ide prije svakog `git push`.

Nakon svakog vala provjereno je da paketi `/d/` i `/kiosk/` koje poslužuje
javna adresa sadrže iste oznake kao paketi koji su prošli lanac (usporedba sadržaja,
ne naziva datoteka: Cloudflareova gradnja i gradnja na Windowsu daju različite
sažetke u nazivima, pa se uspoređuju pravila u CSS-u i razredi u skriptama).

Snimke: vizualna matrica u `review.local/final/` (90 datoteka: telefon, tablet
i stolno računalo u svijetloj i tamnoj temi za svih sedam područja, 320 px,
pejzaž 844 × 390, 200 % teksta), kiosk u `test-results/` kao
`kiosk-<1920|1366|1080>-<light|dark>.png` za prizor Promet i
`-veceras.png` odnosno `-grad.png` za druga dva prizora na 1920 i 1080, te
`-paired-<područje>.png` za uparene prikaze. Snimke prvog vala na javnoj adresi
su u `.superpowers/sdd/2026-09-15-dan-grada/prod1-screens/`.

Provjere iz plana koje ovaj dokument ne tvrdi: stvarni iPhone i Android na
dnevnom svjetlu (čitanje trake „sada” bez listanja, povlačenje traka, dodir
pločice u Promet, slanje na zaslon iz kartice Kvart, promjena prizora na
kiosku) čekaju vlasnika i upisuju se ovdje s uređajem, sustavom i nazivima
snimaka. 

Obilazak stvarne instalacije skriptom `scripts/audit-production.mjs` proveden je
15. 9. u 12:16 UTC nad isporukom `bf6ed6c` (WebKit s opisom iPhonea 13, Chromium kao
Pixel 7 i stolno računalo 1440 px, kiosk 1366 i 1920, jedan privremeni zaslon kroz
čarobnjak): 62 skupa mjerenja, 0 kršenja pravila (geometrija zaglavlja, donja granica
teksta, ciljevi, prelijevanje), engleski pregled uključen. Sedam zabilježenih
upozorenja nisu kršenja: četiri WebGL poruke o performansama karte na kiosku, dva
zahtjeva za pločice karte prekinuta navigacijom i jedan klik skripte koji je nakon
promjene jezika pogodio gumb za slanje na zaslon umjesto zatvorenog segmenta jezika
(rezervni izbornik `has-text("EN")` iz starije ljuske; uklonjen). Snimke i
`result.json` u `review.local/audit-dg-wave3/`.

## Isporuka i prijava

Repozitorij je javan od 15. rujna 2026. (https://github.com/matijarma/vidikovac);
povijest ne sadrži tajne: pregled svih ikad dodanih datoteka i sadržaja svih
revizija našao je samo imena varijabli okoline, nikad vrijednosti. Evaluacijsko
okruženje bilo je do 14. rujna 2026.
zaštićeno Cloudflare Accessom; od tada je javno, a samoposluga zaslona
(`POST /api/screens`) drži quotu po mreži umjesto po Access identitetu. Operaterske
rute `/api/admin/*` i `/stats` i dalje traže valjan Access JWT i bez njega
odgovaraju 404.
Isporuka ide kroz `git push` i postojeći Cloudflare Build, uz naknadnu
autentificiranu provjeru stranica, karte i stvaranja zaslona.

Implementacija `33cd11a` isporučena je kroz GitHub i uspješan Cloudflare Build
13. rujna 2026. u 12:57 po zagrebačkom vremenu. Postavljena Worker verzija:
`eb5728ae-4413-445b-8e42-73360a23c7fe`.

Od 12:59:47 do 12:59:59 provedena je provjera na stvarnoj evaluacijskoj adresi:

- anonimni zahtjev dobiva 302 prema Access prijavi;
- novi Worker javlja `networkCheck: off`;
- samoposluga stvara stvarni privremeni zaslon odgovorom 201;
- kod povezuje drugi preglednik i zaslon prelazi u povezano stanje;
- svih sedam područja otvara se bez horizontalnog prelijevanja i pogrešaka;
- vektorska karta, stajališta i vlastite kartografske pločice učitavaju se;
- Access pristup bez podatkovnog tokena sesije i dalje dobiva 401 na
  `/api/data/zet-rt`.

Snimke i strojni zapis te provjere bili su lokalni i uklonjeni su 15. rujna pri
čišćenju radnog stabla; provjera stoji zapisana ovdje. Kasnija izmjena ovog
dokumenta ne mijenja provjerenu implementaciju.

Osobni i financijski podaci prijavitelja, video-poveznica i predaja kroz
e-Pisarnicu nisu mijenjani niti izvršeni ovom implementacijom.
