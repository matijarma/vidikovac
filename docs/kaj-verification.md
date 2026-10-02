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

### Shema linija, lokalna grana `zet-schema` (16. rujna 2026.)

Implementacija je u izdvojenom radnom stablu
`D:/scratch/kajima-wt/zet-schema`. Posljednja uputa vlasnika zamjenjuje korak
objave iz izvornog plana: završiti i provjeriti lokalno, bez spajanja,
commita, pusha ili deploya. Ova tablica nije tvrdnja da je shema objavljena.

| Provjera | Lokalni rezultat |
|---|---|
| TypeScript aplikacije i Workera | prolazi |
| Cijeli Vitest unit | 162 datoteke, 2.426 testova prolazi |
| Cijeli Vitest workers | 21 datoteka, 149 testova prolazi |
| Produkcijska gradnja | prolazi; schema renderer je zaseban dinamički paket |
| Playwright Chromium i mobile | svih 94 scenarija prolazi, uključujući šest novih provjera sheme |
| Ponovna gradnja sheme | isti bajtovi; 57.639 B izvorno, 10.582 B gzip; `feedVersion=000395` |
| Identitet nacrta i pokrivenost | 19 linija, 114 od 122 GTFS naziva, osam imenovanih iznimaka, pet naziva samo iz nacrta, nula nerazriješenih skupina kružića |
| Smještaj po stazama | 139 od 145 staza smjestivo, svaka dionica strogo monotona; šest staza bez dva podudarna stajališta imenovano u overrides dokumentu |
| Svježi Opus pregled, samo čitanje | završen; uklonjeno ponovno osvježavanje cijelog pristupačnog popisa pri svakom pomaku, spremljena tablica naziva stajališta, razdvojeni testni identifikatori, provjereno uništavanje renderer-a |
| Vizualna matrica | 84 prikaza, nula nalaza; uključeni phone, phone-dark, desktop, uvećani prikazi sheme i kiosk sa stajalištem |
| Lighthouse pristupačnost | 100 na svih šest stranica: `/`, `/hitno`, `/kiosk/`, `/s/`, `/d/`, `/prijava/`; nema palih audita |

Browser provjera koristi stvarnu ugrađenu tramvajsku stazu s determinističkim
planom na ulazu testnog preglednika. Dokazuje pomak oznake između dvije slike
bez drugog očitanja, povratak na geografsku kartu, odabir kroz postojeći list,
izostanak dodatnog dijaloga, stvarni touch-pinch, pojavu naziva pri uvećanju,
vraćanje na fit, trajnost postavke i izostanak schema paketa/artefakta u laganom
načinu. Kiosk sa stajalištem `106_1` čuva `prikaz=shema` kroz čišćenje adrese i
prikazuje kadar s čitljivim nazivima.

Rani pokušaji pune provjere zabilježili su prekid lokalnog dev procesa i jedan
istek petosekundnog Worker testa pri paralelnoj gradnji. Nisu prihvaćeni kao
prolaz: cijeli Worker skup ponovljen je sekvencijalno, a cijela 94-scenarijska
browser kapija s vlastitim procesima i odvojenim imenima lokalnih Workera
(`vidikovac-schema-gate`, `vidikovac-schema-short`), bez promjene postojećih
tvrdnji ili vremenskih limita. Lokalni runner čuva sve potomke do kraja
provjere i zaustavlja samo procese koje je sam pokrenuo.
Lighthouse je završio sa svim rezultatima 100; Windows je pri čišćenju već
zatvorenog privremenog Chrome profila prijavio poznati `EPERM`, koji nije
utjecao na rezultate audita. Pregledane su i stvarne snimke sheme: uklonjena
je praznina starog zaglavlja/legende iz početnog kadra, istaknuto stajalište
ima jedan prsten, a objašnjenje položaja ostaje vidljivo iznad lista na telefonu.

Za završnu vlasničku provjeru na fizičkom uređaju ostaju: deset minuta Ilice,
linija 17 kroz Borongaj, noćna linija poslije ponoći, obilazna spojnica,
pinch na stvarnom telefonu i čitljivost javnog zaslona iz prostora. Automatizirani
testovi i snimke ne proglašavaju te fizičke provjere obavljenima.

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

Skripta `scripts/review-experience.mjs` pokriva svih šest područja na
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

Promatranje produkcije nakon svake isporuke, samo čitanjem i na postojećem zaslonu:
`E2E_KIOSK_URL=<adresa postave zaslona> npm run observe:production -- --minutes 10`
(prije isporuke D2 s `--stage d1`). Skripta ne stvara zaslon; pragovi, izlazni
kodovi i datoteke opisani su u `docs/kiosk.md`, u odjeljku „Razvoj i automatska
provjera”.

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
i stolno računalo u svijetloj i tamnoj temi za svih šest područja, 320 px,
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

## Završni prolaz „kajimafix”, 15. rujna 2026.

Usporedba isporučenog sustava „Dan grada” s četiri konceptna zaslona
(`kajimafix/README.md` i `concept-0*.html`: stolno 1440 svijetlo, telefon 390
tamno, kiosk 1920 Promet i Večeras) dala je popis od dvadesetak dovršnih stavki,
uz dvije vlasnikove: pločice linija na kiosku bile su prevelike kutije s malo
sadržaja, a naglasak `#1428d8` čitao se kao boja poveznice u pregledniku.
Isporučeno na `main` kao `09a1554` (paleta), `60b0c0d` i `ab5ef5b` (pločice
Sada), `064b42b` (ljuska), `90fec50` (kiosk), `6a390a1` (e2e), `53bf21f` i
`a26759d` (ispravci iz snimaka), gurnuto 15. 9. oko 15:45 i 16:20 UTC.

Što se promijenilo, po zaslonu:

- Paleta: svijetli naglasak je duboka kraljevska plava `#03409c`
  (oklch 40,07 % 0,1605 260,1), hover `#00327e`; tramvajske linije i pin stanice
  na karti slijede ga, parkovi su u papirnoj i noćnoj obitelji; tamna tema je
  nepromijenjena (naglasak je papir). Svi parovi kontrasta ostaju iznad AA
  (naglasak na platnu 8,46 : 1, bijelo na naglasku 9,47 : 1).
- Sada, stol i telefon: pločica linije kaže oba kraja linije uz oznaku
  („Črnomerec – Sopot”, bez strelice jer podatak ne zna smjer sa stanice), riječ
  stanja s malom jedinicom („kasni 5 **min**”), glif vozila s brojem i imenom
  stanice; traka zatvaranja je komunalna, boje jantara, imenuje najbližu zatvorenu
  ulicu u kvartu i njezin kraj, s brojem u kvartu u natpisu, a bez kvarta broj za
  grad; Glasnik datira „7. 9. · 118 akata”; događanja imenuju mjesto prije izvora;
  prazna traka je iscrtkana pločica; poruka „Otključano do …” više ne stoji nad
  trakom (pločica sesije i tihi živi okvir već je govore); u statusnoj liniji
  tanke crte razdvajaju sat, vrijeme i zalazak; sličica kvarta nema ime grada ni
  mjerilo, a brojevi pod njom su glifovi s cijelom rečenicom za čitač; naslovi
  događanja večeras smiju na tri retka na stolu.
- Telefon: kicker, sat i vrijeme u jednom bloku; segmenti u traci `surface-2`
  kao pet jednakih gumba (na 200 % teksta traka se lomi u drugi red, riječ se
  nikad ne reže); ime četvrti u zaglavlju do crtice („Gornji grad”); traka Sada
  završava kickerom „Zatim” i dvjema sažetim pločicama iz sljedećih traka
  (koncept 02), pa prvi zaslon odgovara na sada i na sljedeće bez povlačenja.
- Kiosk: zaglavlje bez „javni zaslon” i bez riječi „Tema”; čip stanice nosi samo
  ime stanice, tinta na papiru i papir na noći; tema je glif od 44 px s
  rečenicom u imenu i opisu; datum bez godine; polje Promet slaže šest pločica
  na 1920 (3 × 2) i četiri na 1366 (2 × 2), svaka veličine svog sadržaja (oznaka
  na visini kontrole, krajevi linije u dva retka, riječ stanja u boji uloge, glif
  s brojem vozila), složene od vrha stupca uz kartu; traka radova s nulom nestaje
  i kad je kopija zastarjela; Večeras su retci s tankim crtama, sljedeći s
  ljubičastom crtom; točke prizora 10 px; kod na kartici s prigušenom srednjom
  točkom („ABCD·EFG0”) i trakom vremena papir na naglasku; sigurnosna traka u
  jednom redu: štit i „Sigurnost”, presuda s glifom kao gumb koji otvara
  „Osnovno” dok poziv stoji (obična riječ dok sesija ili čarobnjak drže zaslon),
  „DHMZ · EMSC · vrijeme” ili aktivno upozorenje, dežurna ljekarna, odbrojavanje,
  /hitno; zatvaranja više nisu na traci (pločica desnog stupca ih već kaže);
  riječ presude za upozorenje je „upozorenje”, ne „hitno”.

Odluke zabilježene u planu (`in-the-recent-pass-foamy-wand.md`, 1 do 9), među
njima i što nije rađeno: rezervirano mjesto pretrage „Linija, stanica, ulica,
događanje…” čeka pretragu događanja; zvjezdica za spremanje na pločici linije je
faza 3; red pješačenja u kvartu čeka udaljenosti; oznake linija `xs` na kiosku
imaju svoje pravilo od 28 px, ali se ne iscrtavaju dok katalog stanica ne stigne
na kiosk.

Prolaz: TypeScript oba projekta; Vitest 165 datoteka, 2.619 testova (jedan
vremenski osjetljiv test BeaconDO-a pao je na „inbox timeout” dok je Playwright
opterećivao stroj i sam prolazi, 17 od 17); gradnja; Playwright oba projekta
84 zelena (71 + 13 ponovljenih nakon dva ispravka u testnom sloju: uvoz
regularnog izraza prikazanog koda i traka oporavka koja sad čita ćeliju izvora),
zatim 38 i 27 ponovljenih uz ispravke; vizualna matrica 89 površina, 0 nalaza;
Lighthouse pristupačnost 100 na `/`, `/hitno`, `/kiosk/`, `/s/` i `/d/` nad
javnom adresom. Isporuka provjerena sadržajem paketa na javnoj adresi (novi
naglasak i pravila `tb-seg-track`, `tb-next`, `ki-weather`, `tl-label-title`,
`tl-unit`, `k-tl-name`, `k-scene-col`; stari naglasak nigdje). Snimke isporuke
uz koncepte u `review.local/kajimafix/` (stol 1440 svijetlo, telefon 390
svijetlo i tamno s krajem trake, kiosk 1920 svijetlo i tamno za Promet i
Večeras, kiosk 1366 svijetlo); snimke su ispravile tri stavke prije drugog
guranja (veličina riječi stanja, kontekst Glasnika, prelamanje imena linije).
Obilazak `scripts/audit-production.mjs` nad isporukom `a26759d`, 15. 9. oko
16:40 UTC (WebKit kao iPhone 13, Chromium kao Pixel 7 i stol 1440, kiosk 1366 i
1920, jedan privremeni zaslon kroz čarobnjak): 62 skupa mjerenja, 0 kršenja
pravila; četiri zabilježena upozorenja su WebGL poruke o performansama karte na
kiosku („GPU stall due to ReadPixels”), iste vrste kao u prethodnom obilasku.
Prvi pokušaj stao je na čitaču koda skripte, koji je očekivao crticu gdje zaslon
sad pokazuje srednju točku; čitač je ispravljen u `a26759d`. Snimke i
`result.json` u `review.local/audit-kajimafix/`.

## Isporuka i prijava

Repozitorij je javan od 15. rujna 2026. (https://github.com/matijarma/vidikovac);
povijest ne sadrži tajne: pregled svih ikad dodanih datoteka i sadržaja svih
revizija našao je samo imena varijabli okoline, nikad vrijednosti. Evaluacijsko
okruženje bilo je do 14. rujna 2026.
zaštićeno Cloudflare Accessom; od tada je javno, a samoposluga zaslona
(`POST /api/screens`) drži quotu po mreži umjesto po Access identitetu. Operaterske
rute `/api/admin/*` i `/stats` i dalje traže valjan Access JWT i bez njega
odgovaraju 404. Javni izvještaj `/statistika/` i njegov JSON `/api/statistika`
otvoreni su svima (test/open/statistika.workers.test.ts).
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
- svih šest područja otvara se bez horizontalnog prelijevanja i pogrešaka;
- vektorska karta, stajališta i vlastite kartografske pločice učitavaju se;
- Access pristup bez podatkovnog tokena sesije i dalje dobiva 401 na
  `/api/data/zet-rt`.

Snimke i strojni zapis te provjere bili su lokalni i uklonjeni su 15. rujna pri
čišćenju radnog stabla; provjera stoji zapisana ovdje. Kasnija izmjena ovog
dokumenta ne mijenja provjerenu implementaciju.

Osobni i financijski podaci prijavitelja, video-poveznica i predaja kroz
e-Pisarnicu nisu mijenjani niti izvršeni ovom implementacijom.

## Pisani prijedlog projekta kao HTML, 15. rujna 2026.

Prijedlog projekta za Javni poziv sastavlja `scripts/build-prijava.mjs` iz tekstualnih
matica (`docs/prijava/prijedlog-projekta.md`, `plan-provedbe.md`,
`obrazac-3-financijski-plan.md`, `rizici-i-odgovori.md`), slika pod
`docs/prijava/figures/` (SVG dijagrami, HTML tablice i pločice, statične replike
telefona i javnog zaslona sa stvarnim QR kodom i shemom tramvajske mreže iz ZET-ova
GTFS-a) i okvira dokumenta pod `docs/prijava/src/`, na tokenima i gramatici pločica
same aplikacije. Dvije inačice iz istog izvora: samostalna datoteka
`docs/prijava/prijedlog-projekta.html` (fontovi kao data URI, skripta u dokumentu,
484 kB) i `app/prijava/index.html` za adresu `/prijava/` pod CSP-om aplikacije (vanjska
skripta, fontovi s iste domene, 313 kB). Tekst polja Obrasca 2.2 je
`docs/prijava/obrazac-2-2.md`. Ponovna izgradnja: `npm run build:prijava`.

Provjere samostalne datoteke (Chromium kroz Playwright, 15. 9. 2026.): bez pogrešaka u
konzoli i bez ijednog mrežnog zahtjeva izvan datoteke; bez vodoravnog prelijevanja na
390, 768 i 1440 px u svijetloj i tamnoj temi; radi bez JavaScripta; axe (wcag2a, wcag2aa,
wcag22aa, best-practice) bez nalaza na 1440 px u obje teme i na 390 px; ispis u A4
kroz Chromiumov ispis daje 39 stranica sa svakom slikom cijelom (replike se u ispisu
skaliraju kroz `zoom`, ne kroz `transform`, jer Chromium izostavlja transformirani
sadržaj preko prijeloma). Provjera parnosti teksta: 224 odlomaka, stavki i ćelija matica
nalazi se u HTML-u doslovno; dvije ćelije tablice izvora slika prikazuje kao pilulu i
napomenu. Testovi dokumenata (`test/docs`) i čuvari kopije (`test/app/copy-guards.test.ts`)
prolaze nad novim tekstom i nad `app/prijava/index.html`; `e2e/a11y.spec.ts` obuhvaća
`/prijava/` na 390 i 1920 px u obje teme (jedan h1: replike zaslona spuštaju svoj h1 u
odlomak pri izgradnji). Vrijednosti u traci "Sada u Zagrebu" i u replikama su snimka
otvorenih izvora od 15. 9. 2026. u 19:51 (275 vozila, 39 zatvaranja, 21,4 °C, tri potresa u
72 sata, DHMZ mirno); stanja linija, broj vozila po liniji, najbliže zatvaranje
i radovi u replikama ilustrativni su i tako potpisani. Na adresi `/prijava/` traka se pri
otvaranju osvježava s `/api/teaser`.

Prije sastavljanja tekst su pročitali pet neovisnih čitača (član Povjerenstva prema
Prilogu 1, tehnički provjeravatelj nad repozitorijem, čitač privatnosti i licenci, urednik
hrvatskoga jezika, čitač dosljednosti među dokumentima) i vratili 96 nalaza; primijenjeni
su svi osim odluka vlasnika (naziv projekta, opaska autora, rečenica o šest stupnjeva,
popis prethodnih projekata). Ispravci koji su promijenili tvrdnje: prizor Grad javnog
zaslona ne prikazuje akte Službenog glasnika (razina sesije); list Obavijesti ima tri
prekidača; zadnji polazak je pločica trake Sada, ne Prometa; istodobno vrijede najviše tri
koda; Firefox 110 umjesto 104 zbog upita spremnika; izvještaj o pouzdanosti izvora dolazi
u fazi M5 i M7; Grad odabire lokaciju, prijavitelj predlaže; šest neotvorenih iznimaka
među izvorima; OpenStreetMap u tablici izvora; `/privatnost` više ne kaže da je repozitorij
privatan i navodi sve što ostaje u localStorageu.

Dopuna 16. 9. 2026.: prijedlog dobiva poglavlje "Vizija: manje zaslona, više grada" odmah
iza sažetka, sa slikom `f-vizija` (ekonomija pažnje nasuprot ekonomiji prisutnosti, krug
mjesto, prisutnost, deset minuta, natrag u grad), otvoreni format za izdavače kao isporuku
faze M4 (§1.7, plan, Obrazac 2.2), primjer knjižnice koja posuđuje prisutnošću i rečenicu o
pametnim televizorima koje prostori već imaju; usporedba s ranije financiranim projektima i
slika `f-krajolik` uklonjene su iz svih dokumenata. Provjere ponovljene s istim ishodom:
bez pogrešaka u konzoli, bez mrežnih zahtjeva, bez prelijevanja, axe bez nalaza, jedan h1,
`e2e/a11y.spec.ts` nad `/prijava/`, parnost teksta (dvije ćelije tablice kao pilula i napomena).

## Blizanac: motor kretanja na poslužitelju, 16. rujna 2026.

Grana `twin-engine` (radno stablo `D:/scratch/kajima-wt/twin-engine`, glavno stablo netaknuto dok vlasnik ne spoji), plan `C:/Users/MatijaRadeljak/.claude/plans/i-want-us-to-tingly-rain.md`, odluke R-TE1 do R-TE38 u `.superpowers/sdd/2026-09-16-twin-engine/rulings.md`. Što je izgrađeno opisuje `docs/arhitektura.md` §"Model kretanja vozila".

Provjere na grani (obje kapije prošle u cijelosti; ništa nije preskočeno ni skraćeno):

| Kapija | Glava | typecheck | vitest unit | vitest workers | build | Playwright chromium | Playwright mobile | review:visual | Lighthouse (a11y) |
|---|---|---|---|---|---|---|---|---|---|
| A (faza A: blizanac, indeks vožnji, klijent s poviješću) | `bb8539c` → `0edb503` | čisto | 153 datoteke / 2502 | 20 / 149 | čisto | 69/70, jedini crveni (`motion.spec` klizanje u slobodnoj ravnini) popravljen u `0edb503` i četiri motion specifikacije ponovno zelene | 18/18 | 89 površina / 0 nalaza | 100 × 6 stranica |
| B (faza B: graf pruge, motor, planovi na žici, integrator) | `8e19313` | čisto | 157 / 2430 | 20 / 148 | čisto | 70/70 (motion.spec prepisan za planove, prvi prolaz) | 18/18 | 89 / 0 | 100 × 6 |
| Spojeno stablo (`twin-engine` u `main`, prije objave) | `6f73559` | čisto | 158 / 2412 | 21 / 149 | čisto | 70/70 | 18/18 | 77 / 0 | 100 × 6 |
| Spojeno stablo (`twin-hindsight` u `main`, krug E, prije objave) | `d3bf2e6` | čisto | 158 / 2415 | 21 / 149 | čisto | 70/70 | 18/18 | 77 / 0 | 100 × 6 |

Motorova vlastita kapija (R-TE30, `test/motion/engine-envelope.test.ts`): šest tramvaja na dijeljenom koridoru kroz 20 simuliranih minuta, šum GPS-a 8 m, 2 od 3 osvježenja po otkucaju, kašnjenje 2 do 25 s: 0 pretjecanja, 0 vožnji unatrag, smjer poznat nakon prvog očitanja, svaki prvi plan u pokretu, ocjena unatrag na 30 s p95 32,2 m (41,0 m poslije kruga E, odjeljak niže). Na živom feedu (probom kroz `wrangler dev` 16. rujna oko 05:10): 38 vozila u kvadratu zaslona, sva s planom na stvarnoj stazi grafa, hladno dekodiranje artefakata 46 ms (mreža) + 195 ms (indeks).

Kako se kapija vozi u radnom stablu: vlastita dva `wrangler dev` poslužitelja na 8797 i 8798 (8787 i 8788 pripadaju drugim sesijama), pokrenuta jedan za drugim (oba pri startu vrte `npm run build` i sudaraju se ako krenu istodobno), nikad `npm run build` dok rade (poslužitelj čuva staru kartu imovine i sve pada); zatim `E2E_NO_WEBSERVER=1 E2E_APP_URL=http://localhost:8797 E2E_SHORT_URL=http://localhost:8798 npx playwright test --project=chromium` pa `--project=mobile`, `REVIEW_APP_URL=http://127.0.0.1:8797 npm run review:visual`, `E2E_APP_URL=http://127.0.0.1:8797 node scripts/lighthouse-a11y.mjs`. Radno stablo treba kopiju `.wrangler/state` glavnog stabla (arhiva pločica) i `.dev.vars`.

Spojeno u `main` 16. rujna 2026. u 04:27 UTC (`6f73559`, spojno stablo `merge-twin` iz `origin/main`, glava grane `a19b49c`); Workers Builds je objavio inačicu `225e2715` u 04:28 UTC. Prije spajanja je na spremnik `vidikovac-feed` postavljeno pravilo isteka `expire-zet-rt-7d` (prefiks `zet-rt/`, sedam dana), jer objava pada na nepoznatom spremniku. Od poznatog preklapanja s uklanjanjem HRT-a, Sljemena i vijesti na `main` u sukob su doista otišla samo dva mjesta: `app/src/map/city-map.ts` (`MapPoint` zadržava `place`/`props` s `main` povrh grananog `extends Omit<Fix, 'at'>`) i `docs/izvori.md` (tekst s `main`, predmemorija teasera 5 s s grane); `worker/feed/schema.ts`, `registry.ts`, `test/docs/docs.test.ts` i `test/feed/cache.workers.test.ts` spojili su se sami i pročitani su redom da to potvrde.

Nakon objave, provjera u proizvodnji. Prvi stupac rezultata upisan je 16. rujna oko 04:40 UTC,
dvanaest minuta nakon objave; to je prvi pogled, a ne mjerenje od 24 h koje retci traže.

| Provjera | Kako | Rezultat |
|---|---|---|
| Objava | Workers Builds na `git push` u `main` | uspješno: gradnja `9b37f978`, inačica `225e2715`, objavljena 04:28 UTC; `/api/health` odgovara `{"ok":true}` |
| Blizanac otkucava | `/stats`: `twin_tick` po ishodu (`ok`, `unchanged`, `error`, `stale_index`; od listopada 2026. i `regressed`, zaglavlje starije od prethodnog, te `future`, zaglavlje više od 30 s ispred sata: to nisu novi okviri, a javna statistika broji ih samo u zbroju otkucaja) i startu (`cold`/`warm`) nakon 24 h; udio hladnih startova govori koliko se objekt izbacuje između alarma | prvih 12 min: 117 otkucaja, 65 `ok` i 52 `unchanged`, 0 `error`, 0 `stale_index`; 1 hladan i 116 toplih, dakle objekt ostaje u memoriji i lanac alarma ne prekida se. **Mjerenje od 24 h još predstoji.** |
| Ocjena unatrag | `/stats`: `twin_hindsight` p50/p95 po horizontu 10/30/60 s nakon 24 h; prag iz koridora je p95 < 60 m na 30 s | prvih 12 min, 52.708 ocjena: na 10 s 45,6 % ispod 50 m i 10,2 % na 200 m ili više; na 30 s 34,3 % ispod 50 m i 20,0 % na 200 m ili više; na 60 s 25,2 % ispod 50 m i 34,6 % na 200 m ili više. **Znatno lošije od koridora (p95 32 m na 30 s) i prag p95 < 60 m nije postignut.** Uzroci su nađeni istog dana ponavljanjem snimljenog feeda i popravljeni u krugu E (odjeljak niže); nakon objave kruga E mjerenje od 24 h na `/stats` ponovno je mjera. |
| Snimanje u R2 | okviri pod `zet-rt/GGGG/MM/DD/` u spremniku `vidikovac-feed`, pravilo isteka od 7 dana | tri okvira dohvaćena po točnom ključu kroz cijeli prozor: `042840-1789532920.pb` (101.664 B), `042913-1789532953.pb` (101.827 B), `044014-1789533614.pb` (104.206 B). `wrangler r2 bucket info` u istom trenutku još pokazuje `object_count: 0`: ta brojka kasni, objekti postoje. |
| Planovi na žici | `/api/teaser`: stavke `zet-rt` nose `motion.plan`, `motion.path` i `data.headsign` | 66 vozila u kvadratu, svih 66 s planom, stazom i odredištem; 54 tramvaja i 12 autobusa; `status` modula `live`, `sources.zet` `live` |
| Statični GTFS | `/stats`: `static_watch` `newer` = 0, inače `npm run build:network && npm run build:trips`, commit, push | 0 od 1 provjere zatekle noviji statični GTFS |
| Ilica, Črnomerec do Trga, 10 min u vršnom satu | pogledom: nema pretjecanja na istom kolosijeku, nema vožnje unatrag, tramvaji staju na stajalištima, kartice pišu odredište i sljedeće stajalište | nije provedeno: pogledom, vlasnik |
| Hladno učitavanje kioska | vozila se gibaju u prvoj sekundi, smjer poznat | nije provedeno: pogledom, vlasnik |
| Hladno učitavanje telefona (sesija) | isto, puna karta | nije provedeno: pogledom, vlasnik |
| Linija 1 | tramvaj na pruzi (sintetička staza), ne u slobodnoj ravnini | oba tramvaja linije 1 u kvadratu voze po sintetičkim stazama grafa (`path:1:0:...`, `path:1:1:...`), ne u slobodnoj ravnini |
| Autobus na obilasku | glatko u slobodnoj ravnini, bez skoka | nije provedeno: pogledom, vlasnik |
| Ponavljanje snimljenog dana | `scripts/replay-twin.mjs` nad okvirima iz R2, pragovi upisani ispod | još nema cijelog snimljenog dana; snimanje radi (redak gore) |

### Krug E: dijagnoza ocjene unatrag i popravci motora (16. rujna 2026, grana `twin-hindsight`)

Dva snimka živog feeda po 25 minuta (134 okvira svaki, 07:00 i 09:35 po zagrebačkom vremenu, oko 330 vozila, 38 do 40 tisuća ocijenjenih svježih očitanja po snimku) ponovljena su kroz pravi `runTick` s ocjenjivačem koji greške dijeli po vrsti vozila, ostvarenom kretanju u posljednjem razmaku (stoji, sporo, brzo, luk unatrag), situaciji (na peronu, izvan perona, vožnja nije počela, uz kraj staze, hladno) i predznaku (plan ispred ili iza vozila). Nađeno, redom po masi greške:

1. **Preklopi staze.** Većina tramvajskih vožnji vozi po sintetičkim stazama, a ZET linije 9 i 17 (i dio 6) piše kao krugove: izlazni i povratni kolosijek leže metrima jedan od drugoga, pa je najbliža točka staze dvosmislena na svakom metru; kružni autobusi (141, 207, 211, 228…) isto. Projekcija bez pamćenja preskakivala je luk za kilometre (p95 tramvaja na 10 s bio je 644 m). Popravak R-TE45: smještanje među lokalnim minimumima udaljenosti u dosegu posljednjeg luka, prvo smještanje po smjeru i idućem stajalištu.
2. **Zastarjeli odnos u zakonu redoslijeda.** Kad vođa pod istim brojem vozila počne iduću vožnju na početku kruga, sljedbenik šest kilometara dalje bio je zadržavan na luku nula minutama, jer ustupanje traži vođu uz stajalište. Popravak R-TE52: odnos koji sama očitanja proturječe za više od 300 m odbacuje se i uspostavlja iznova; zadržavanje nikad iza vlastitog očitanja. Sam ovaj popravak spustio je p95 tramvaja na 10 s s 325 na 193 m.
3. **Planer slijep za stanje vozila.** Vozilo u pokretu planirano je prosjekom voznog reda (4,2 m/s naspram ostvarenih 11,3 m/s), vozilo koje stoji planirano je u pokretu 59 % vremena, vozilo na okretištu odlazilo je odmah krstarećom brzinom (hladni autobus na 30 s: p50 476 m, 93 % ispred). Popravci R-TE46 do R-TE49 (vlastita brzina 15 s, stajanje izvan perona, produženo stajanje na peronu, čekanje reda polaska iz indeksa jer ZET-ov `TripUpdate` na okretištu ne nosi buduće vrijeme).
4. **Procjena brzine.** Terećenje stajanja od 20 s na razmaku od 11 s čitalo je autobuse na 22 m/s; gustoća stajališta u središtu ostavljala je tramvaje na "0,0 m/s" minutama u vožnji. Popravci R-TE50, R-TE51.

Izmjereno stajanje na peronu iz istih snimaka (raspon između prvog i posljednjeg očitanja na peronu, stvarno stajanje do jednog razmaka dulje): tramvaj p50 15 s, p75 23 s, p90 37 s; autobus p50 11 s, p75 15 s; od 11.631 tramvajskog stajanja samo 9 prolazaka pokraj stajališta bez očitanja u zoni. Zadanih 20 s stajanja ostaje.

Ocjena unatrag prije i poslije, isti snimci, isti ocjenjivač (bez ocjena preko promjene vožnje, kao u proizvodnji):

| Snimak | Horizont | Prije: p50 / p95 / udio ≥ 200 m | Poslije: p50 / p95 / udio ≥ 200 m |
|---|---|---|---|
| 07:00 | 10 s | 56 m / 380 m / 11 % | 45 m / 211 m / 6 % |
| 07:00 | 30 s | 84 m / 515 m / 21 % | 70 m / 326 m / 15 % |
| 07:00 | 60 s | 128 m / 703 m / 34 % | 108 m / 486 m / 29 % |
| 09:35 | 10 s | 57 m / 340 m / 10 % | 45 m / 211 m / 6 % |
| 09:35 | 30 s | 85 m / 488 m / 20 % | 71 m / 324 m / 15 % |
| 09:35 | 60 s | 122 m / 672 m / 33 % | 105 m / 479 m / 27 % |

Tramvaji sami, snimak 07:00, 10 s: p50 52 → 41 m, p95 644 → 195 m, udio ≥ 200 m 11 → 5 %. Autobusi koji stoje, 10 s: p50 76 → 12 m. Što ostaje: vozila u pokretu (p50 oko 50 m, plan iza brzog tramvaja u tri četvrtine slučajeva) i autobusi bez voznog reda na svojim polilinijama (dionice iza vlastite brzine voze zadanih 8 m/s); sljedeći krug je vozni red za autobusne oblike. Koridor (R-TE30) poslije kruga E: p95 41 m na 30 s (32 m prije), jer simulator vozi točno po redu.

#### Krug E u proizvodnji

Objavljeno 16. rujna 2026. u 06:39 UTC: spojno stablo `merge-hindsight` iz `origin/main`
(`b954148`), spoj grane `twin-hindsight` (`d3e21b8`) bez ijednog sukoba, spojni commit
`d3bf2e6` gurnut u `main`; Workers Builds je gradnjom `70b0b6f1` objavio inačicu `62761abe`
u 06:39:55 UTC. Cijela kapija prošla je na spojenom stablu prije guranja (redak u tablici gore).

Brojila na `/stats` su zbrojna, pa je svako očitanje ispod razlika dvaju pogleda. Prozor je
06:47 do 07:18 UTC (08:47 do 09:18 po zagrebačkom, jutarnji vrh), dakle topao objekt nakon
objave:

| Provjera | Rezultat u prozoru 06:47 do 07:18 UTC |
|---|---|
| Otkucaji | 306 otkucaja: 164 `ok`, 142 `unchanged`, 0 `error`, 0 `stale_index`; nijedan novi hladan start (zbrojno i dalje 3), objekt ostaje u memoriji |
| Ocjena unatrag, 10 s | 44.401 očitanje: 31,8 % ispod 25 m, 48,6 % ispod 50 m, 70,7 % ispod 100 m, 89,9 % ispod 200 m, 10,1 % na 200 m ili više |
| Ocjena unatrag, 30 s | 44.076 očitanja: 23,1 % ispod 25 m, 36,8 % ispod 50 m, 56,2 % ispod 100 m, 77,8 % ispod 200 m, 22,2 % na 200 m ili više |
| Ocjena unatrag, 60 s | 43.627 očitanja: 18,4 % ispod 25 m, 28,8 % ispod 50 m, 44,5 % ispod 100 m, 65,0 % ispod 200 m, 35,0 % na 200 m ili više |
| Zdravlje | `/api/health` odgovara `{"ok":true}` u 06:40 i u 07:18 UTC |
| Planovi na žici | `/api/teaser` u 06:40:34 UTC: 65 vozila u kvadratu, svih 65 s planom, stazom i odredištem, 51 tramvaj i 14 autobusa; u 07:18:46 UTC: 60 vozila, svih 60 s planom, stazom i odredištem, tramvaj linije 1 na sintetičkoj stazi `path:1:0:...` |
| Snimanje u R2 | okviri `064023-1789540823.pb` (98.949 B) i `071832-1789543112.pb` (91.641 B) dohvaćeni po točnom ključu; spremnik u 07:19 UTC drži 704 objekta i 73 MB |
| Statični GTFS | `static_watch`: 0 od 2 provjere zatekle noviji statični GTFS |

Usporedba sa starim motorom mora pasti na isto doba dana. Očitanje od dvanaest minuta iz
tablice gore (10,2 % / 20,0 % / 34,6 % na 200 m ili više) snimljeno je između 06:28 i 06:40 po
zagrebačkom, prije vrha, pa nije mjera za jutarnji vrh. Mjera je isti izvor u prozoru 04:40 do
06:41 UTC (06:40 do 08:41 po zagrebačkom, stari motor, 189.380 očitanja na 10 s), dobiven kao
razlika zbrojnih brojila:

| Horizont | Stari motor, 04:40 do 06:41 UTC | Krug E, 06:47 do 07:18 UTC |
|---|---|---|
| 10 s | 41,8 % ispod 50 m, 16,5 % na 200 m ili više | 48,6 % ispod 50 m, 10,1 % na 200 m ili više |
| 30 s | 31,2 % ispod 50 m, 27,9 % na 200 m ili više | 36,8 % ispod 50 m, 22,2 % na 200 m ili više |
| 60 s | 23,4 % ispod 50 m, 41,1 % na 200 m ili više | 28,8 % ispod 50 m, 35,0 % na 200 m ili više |

Cijeli život starog motora (04:28 do 06:41 UTC, 207.643 očitanja na 10 s) daje 16,0 % / 27,2 % /
40,6 % na 200 m ili više, dakle isto. Smjer i veličina pomaka slažu se s ponavljanjem snimaka:
udio na 200 m ili više pada za oko šest postotnih bodova na svakom horizontu. Prag iz koridora
(p95 ispod 60 m na 30 s) živi feed i dalje ne doseže: na 30 s je 77,8 % očitanja ispod 200 m,
pa p95 leži iznad 200 m. Mjerenje od 24 h ostaje ono koje odlučuje, a sljedeći krug (vozni red
za autobusne oblike) ima gdje pomoći.

Za runbook: `npx wrangler r2 object get` bez zastavice `--remote` čita lokalnu pohranu radnog
stabla i javlja da ključ ne postoji; provjera snimljenog okvira ide s `--remote`.

## Ponavljanje snimljenih okvira (B8)

Blizanac svaki novi ZET okvir sprema u R2, u `vidikovac-feed` pod `zet-rt/GGGG/MM/DD/`
(`worker/twin/record.ts`), sedam dana. `scripts/replay-twin.mjs` provodi te snimljene okvire
kroz isti čisti otkucaj kroz koji prolazi svaki pravi otkucaj blizanca (`worker/twin/tick.ts`),
učitan nad dvije objavljene datoteke pod `app/public/data/` (mrežu i indeks putovanja), i
ispisuje jednu tablicu: hindsight p50/p95 po horizontu (10, 30 i 60 s, po razredima iz
`shared/motion/hindsight.ts`), broj preticanja i vožnji unatrag (oboje mora biti 0), broj
ustupaka, udio vozila s poznatim smjerom, vrijeme do prvog planiranog kretanja po vozilu
(p50/p95), udio putovanja koje indeks ne prepoznaje, broj obrađenih okvira i vozila, i vrijeme
obrade po otkucaju. Okviri se čitaju iz direktorija i slažu po vlastitom vremenu zaglavlja, ne
po imenu datoteke, tako da propušteno objavljivanje jednostavno znači da je sljedeći okvir na
redu.

Pokretanje: `node scripts/replay-twin.mjs <direktorij-okvira> [--limit N]`. Direktorij dolazi iz
R2-a alatom wrangler, objekt po objekt (naredba je zapisana u zaglavlju skripte, `npx wrangler r2
object get vidikovac-feed/zet-rt/GGGG/MM/DD/...`), i drži se izvan gita (`recordings/`). Uz
snimljeni dan stoji i scenarijski test `test/scripts/replay-twin.test.ts` nad kratkim
sintetičkim hodnikom (isti simulator kao `test/motion/engine-envelope.test.ts`), koji dokazuje da
jezgra (`scripts/replay-core.ts`) čita okvire ispravno, drži red na dijeljenom kolosijeku, ne
vraća plan unatrag i pogađa 30 s unaprijed unutar 60 m pri p95.

### Retci ocjenjivača i simulacija klijenta (F7)

Krug F dodaje istoj tablici pet mjera. Sve se mjere nad istim snimljenim danom prije ijedne
promjene pogona i mjere ponovno nakon svake, pa je napredak broj, a ne dojam. Definicije:

**Ocjena unatrag s predznakom.** Uz postojeće razrede apsolutne greške, svako ocijenjeno
očitanje nosi i predznak: položaj plana minus položaj očitanja duž iste putanje, pozitivno kad
je plan bio *ispred* tramvaja. Razredi su `ahead_ge50` (plan 50 m ili više ispred), `within50`
i `behind_ge50`. Pravilo kruga je „radije iza nego ispred”: oznaka iza pravog tramvaja čita se
kao kašnjenje GPS-a, a oznaka ispred, koja se poslije mora vraćati, čita se kao pokvarena
aplikacija. Isti brojevi idu i na `/stats` (`twin_hindsight_sign`, dim1 horizont, dim2 razred),
upisani u istom skupnom upisu kao i razredi bez predznaka.

**Regresija između planova (> 25 m).** Za tramvaj koji ima plan u dva uzastopna otkucaja, oba
se plana čitaju u trenutku zaglavlja kasnijeg otkucaja. Broji se kad je noviji plan stavio
tramvaj više od 25 m *iza* mjesta gdje ga je imao stariji. 25 m je gornja granica prvog razreda
ocjene unatrag -- najmanji korak koji gledatelj čita kao ispravak, a ne kao podrhtavanje.
Promjena vožnje (okretanje na okretištu) nije regresija i preskače se.

**Prekršaj redoslijeda prema očitanjima (≤ 5 s, > 35 m).** Dva tramvaja na dijeljenom kolosijeku
(brid pod jednim leži na putanji drugoga) čija su svježa očitanja unutar 5 s jedno od drugoga --
pola otkucaja, pa razlika u trenutku javljanja dvaju vozila iz istog okvira ne može lažirati
prekršaj. Oba se očitanja i oba objavljena plana preslikaju na jednu putanju; broji se kad
objavljeni redoslijed proturječi redoslijedu očitanja, a očitanja su razmaknuta više od jedne
duljine tramvaja (35 m, `HEADWAY_M` iz `shared/motion/order.ts`; bliži par nema redoslijed koji
bi se mogao prekršiti).

**Fantomska stajališta.** Po putanji: koliko stajališta geometrijski leži na njezinim bridovima
(`stopsOnPath`) naspram onih na kojima neki njezin uzorak zaista staje -- za putanju s oblikom
unija svih uzoraka indeksa putovanja koji voze taj oblik (pa su i skraćene varijante pokrivene),
za sintetsku putanju `path:` njezin vlastiti niz stajališta. Geometrijski zapis koji nije ni u
jednom od njih je fantom: peron druge linije na istim tračnicama, na kojem planer danas svejedno
stoji. To je broj koji odjeljak E0 uklanja. Tablica ispisuje ukupne iznose i medijan po putanji,
odvojeno za putanje s oblikom i za sintetske; iznosi po pojedinoj putanji stoje u
`report.phantoms.paths`.

**Simulacija klijenta.** Pravi integrator (`app/src/motion/integrator.ts`) vođen upravo onim
teretima koje je ponovljeni blizanac objavio, dekodiranima točno kako ih dekodira stranica
(`app/src/motion/fixes.ts` razrješava vremena čvorova prema `sourceUpdatedAt`). Anketa stiže
3,5 s nakon zaglavlja (vlastiti jastuk otkucaja, rubna predmemorija i mreža), a slike se crtaju
12 puta u sekundi između anketa. Broji se ono što bi gledatelj vidio:

- *slike unatrag*: nacrtani `s` tramvaja smanjio se za više od jednog centimetra između dviju
  slika na istoj geometriji (mora biti 0);
- *vidljiva križanja*: dva tramvaja na dijeljenom kolosijeku čiji nacrtani redoslijed, preslikan
  na jednu putanju, proturječi redoslijedu njihovih planova razmaknutih više od 35 m (mora biti
  0); broji se jednom po paru koji uđe u to stanje, ne po svakoj slici;
- *udio držanja*: udio tramvajskih slika u kojima nacrtani `s` nije napredovao dok je meta plana
  napredovala više od 0,5 m, i prosječna duljina takvog držanja u sekundama.

### Polazna tablica, snimljeni dan 17. 9. 2026.

Mjereno 18. 9. 2026. nad `recordings/2026/09/17/`, prije ijedne promjene pogona u krugu F:
`node scripts/replay-twin.mjs recordings/2026/09/17`. Prisutno je bilo **2216 okvira**, prozor
**2026-09-17T00:00:04Z do 2026-09-17T06:41:16Z** (UTC), s jutarnjim vrhom od 05 do 06 h;
ostatak dana još se povlačio iz R2-a, pa se sljedeća mjerenja rade nad istim direktorijem i
uspoređuju samo nad istim prozorom.

```
twin replay report
-------------------
frames processed:        2216 (dropped, no header: 0)
vehicles seen:           435

hindsight, bucket p50 / p95 (n graded fixes):
  10s:  p50 <50m    p95 ge200m  (n=374587)
  30s:  p50 <100m   p95 ge200m  (n=371570)
  60s:  p50 <200m   p95 ge200m  (n=363142)

signed hindsight, share of graded fixes (plan >=50 m ahead of the tram / within 50 m / >=50 m behind):
  10s:  ahead 22.2%  within 53.7%  behind 24.2%  (n=374587)
  30s:  ahead 25.7%  within 39.0%  behind 35.2%  (n=371570)
  60s:  ahead 26.3%  within 30.1%  behind 43.6%  (n=363142)

between-plan regressions (>25 m):     48983  (of 190842 consecutive plan pairs)
fix-order violations (<=5 s, >35 m):  2228  (of 1203162 fresh pairs on shared rails)
phantom stops:           6410 of 10599 geometric entries on 145 paths (4189 served)
  shape paths:           100 paths, 7657 geometric / 3032 served / 4625 phantom, median per path 76.5 / 29.0 / 43.5
  synthetic paths:       45 paths, 2942 geometric / 1157 served / 1785 phantom, median per path 58.0 / 25.0 / 34.0
  paths without pattern: 0 (left out)

client simulation (polls land at header + 3.5 s, 12 Hz; 288926 frames, 26316757 tram-frames):
  backward frames (must be 0):        9606292
  visible crossings (must be 0):      9550
  hold-time share:                    7.9%  mean hold length: 5.1 s  (34426 holds)

overtakes (must be 0):   2864
reversals (must be 0):   0
concessions:             1535
direction known share:   100.0%
unknown-trip share:      0.0%
first moving plan (s):   p50 836  p95 1794  (never moved: 5)
per-tick wall time (ms): p50 48.36  p95 355.21
```

Što se iz nje čita, prije ijedne promjene u krugu F:

- **Cilj kruga na 30 s nije ni blizu.** Plan je 50 m ili više *ispred* tramvaja u 25,7 % od
  371.570 ocijenjenih očitanja; cilj je 10 % ili manje. Udio unutar 50 m pada s horizontom
  (53,7 % na 10 s, 39,0 % na 30 s, 30,1 % na 60 s), a p95 je na svim horizontima preko 200 m.
- **Planovi se međusobno proturječe.** Svaki četvrti uzastopni par planova (48.983 od 190.842)
  vraća tramvaj više od 25 m unatrag u odnosu na ono što je prethodni plan tvrdio za isti
  trenutak. To je izvor i oznaka koje se na zaslonu vraćaju i ocjene ispred.
- **Klijent danas crta unatrag.** 9.606.292 od 26.316.757 tramvajskih slika (36,5 %) nacrtane
  su iza prethodne slike, i 9.550 puta par tramvaja na dijeljenom kolosijeku nacrtan je u
  krivom redoslijedu. Integrator to danas dopušta namjerno (`BACKWARD_MAX_MS` 1 m/s do 30 m po
  planu), pa je "mora biti 0" cilj kruga, a ne današnje svojstvo. Držanje je 7,9 % slika,
  prosječno 5,1 s.
- **Fantomska stajališta su većina.** 6.410 od 10.599 geometrijskih zapisa nije ni na jednom
  uzorku svoje putanje; na putanjama s oblikom medijan je 76,5 geometrijskih naspram 29,0
  posluženih po putanji. To je mjera koju odjeljak E0 uklanja.
- Prekršaja redoslijeda prema očitanjima ima 2.228 od 1.203.162 provjerenih parova (0,19 %), a
  vožnji unatrag u samom planu nijedna; preticanja koja zakon nije sankcionirao ustupkom ima
  2.864 uz 1.535 ustupaka. Prvo planirano kretanje po vozilu čeka p50 836 s -- vozilo se pojavi
  u feedu davno prije nego što ga plan pokrene.

Cijeli prolaz traje oko osam i pol minuta na osam jezgri (21:51 do 21:59), gotovo sve u
simulaciji klijenta, koja integrator korača 12 puta u sekundi kroz cijeli snimljeni raspon.

### Nakon F8 (posluženi popis stajališta), isti snimljeni dan

Mjereno 18. 9. 2026. nad istim direktorijem, `node scripts/replay-twin.mjs recordings/2026/09/17
--limit 2216`. **Prozor se pomaknuo**: direktorij je u međuvremenu narastao na 2904 okvira, a
688 novih ne leže samo iza polazne tablice -- 37 ih pada unutar njezinog prozora, pa prva 2216
okvira po zaglavlju sada završavaju u 06:34:27Z umjesto u 06:41:16Z. Da usporedba ne bi mjerila
prozor umjesto promjene, polazni je kod (`cd7495c`) ponovno pokrenut nad **istim** okvirima; on
je stupac „prije" u tablici ispod, a brojke iz polazne tablice stoje uz njega samo kao
orijentir.

```
twin replay report
-------------------
frames processed:        2216 (dropped, no header: 0)
vehicles seen:           433

hindsight, bucket p50 / p95 (n graded fixes):
  10s:  p50 <50m    p95 ge200m  (n=373886)
  30s:  p50 <100m   p95 ge200m  (n=370862)
  60s:  p50 <200m   p95 ge200m  (n=362424)

signed hindsight, share of graded fixes (plan >=50 m ahead of the tram / within 50 m / >=50 m behind):
  10s:  ahead 23.9%  within 51.6%  behind 24.5%  (n=373886)
  30s:  ahead 28.4%  within 37.6%  behind 34.1%  (n=370862)
  60s:  ahead 29.8%  within 29.5%  behind 40.6%  (n=362424)

between-plan regressions (>25 m):     58919  (of 190806 consecutive plan pairs)
fix-order violations (<=5 s, >35 m):  2793  (of 1132483 fresh pairs on shared rails)
phantom stops:           0 of 10599 geometric entries on 145 paths (3091 served)
  shape paths:           100 paths, 7657 geometric / 2219 served / 0 phantom, median per path 76.5 / 22.0 / 0.0
  synthetic paths:       45 paths, 2942 geometric / 872 served / 0 phantom, median per path 58.0 / 19.0 / 0.0
  paths without pattern: 0 (left out)

client simulation (polls land at header + 3.5 s, 12 Hz; 284077 frames, 25531087 tram-frames):
  backward frames (must be 0):        10543874
  visible crossings (must be 0):      10324
  hold-time share:                    8.2%  mean hold length: 5.4 s  (32237 holds)

overtakes (must be 0):   3324
reversals (must be 0):   0
concessions:             650
direction known share:   100.0%
unknown-trip share:      0.0%
first moving plan (s):   p50 833  p95 1794  (never moved: 5)
per-tick wall time (ms): p50 29.45  p95 180.72
```

Isti okviri, prije (`cd7495c`) i poslije (F8):

| Mjera | prije | poslije | promjena |
|---|---|---|---|
| fantomska stajališta | 6410 od 10599 | **0** od 10599 | uklonjena po konstrukciji |
| posluženih zapisa po putanji (medijan, s oblikom) | 29,0 | 22,0 | popis je sada ono na čemu linija staje |
| 30 s: plan ≥ 50 m ispred | 25,7 % | 28,4 % | +2,7 p. b. |
| 30 s: unutar 50 m | 39,1 % | 37,6 % | −1,5 p. b. |
| 30 s: plan ≥ 50 m iza | 35,2 % | 34,1 % | −1,1 p. b. |
| regresije među planovima (> 25 m) | 48.749 | 58.919 | +20,9 % |
| prekršaji redoslijeda prema očitanjima | 2.221 | 2.793 | +25,8 % |
| slike unatrag (klijent) | 9.432.429 | 10.543.874 | +11,8 % |
| vidljiva križanja | 9.327 | 10.324 | +10,7 % |
| preticanja | 2.693 | 3.324 | +23,4 % |
| ustupci | 1.553 | 650 | −58,2 % |
| otkucaj p50 / p95 | 47,33 / 303,52 ms | 29,45 / 180,72 ms | −38 % / −40 % |

Tablica je zapis prolaza od 18. 9. 2026., **prije kontrolorovih odluka A i B** (poslužni radijus
`SERVED_STOP_MAX_METRES` 60 m i razrješenje putanje u SQLite spoju): artefakt od tada nosi
**3100** posluženih zapisa umjesto 3091, jer je Olipska 251_2 ušla u poslužne popise devet
putanja. Brojke iznad nisu ponovno mjerene i stoje kao zapis onoga što je taj prolaz dao;
fantomskih stajališta i dalje je 0 po konstrukciji.

Što se iz nje čita:

- **Fantomi su otišli, i to je cijela svrha ovog koraka.** Nijedan zapis na putanji nije više
  peron koji ta linija ne poslužuje: 6410 od 10599 geometrijskih zapisa izašlo je iz svega što
  pogon čita (planer, zakon, učilo, procjena brzine, objavljeni `held`). Medijan po putanji s
  oblikom pao je sa 76,5 geometrijskih na 22 poslužena.
- **Plan je zato postao brži, a ne točniji na 30 s.** Fantomska stajališta bila su kočnica:
  planer je na svakom od njih knjižio zadržavanje od 20 s, pa je plan sustavno kasnio za
  tramvajem. Bez njih plan trči, i udio "≥ 50 m ispred" raste s 25,7 % na 28,4 %. To je oblik
  koji je krug i predvidio: prvo se plan čini **ispravnim** (E0), pa se tek onda namjerno
  nagne prema kašnjenju (vlasnikovo pravilo "radije iza nego ispred"). Bez sljedećeg koraka ova
  je brojka lošija nego prije, i tako je i treba čitati.
- **Regresije i križanja rastu iz istog razloga.** Brži plan svaki put kad stigne novo očitanje
  mora natrag, pa parova koji se razlikuju više od 25 m ima petinu više, a klijent ih crta.
- **Preticanja rastu samo na papiru.** Ustupaka je 650 umjesto 1553, jer vrata ustupka
  (`nearStopOrEnd`) sada gledaju samo stajališta na kojima linija staje. Preticanje se broji kao
  *zamjene redoslijeda minus ustupci*, pa je stvarni broj zamjena pao (2693 + 1553 = 4246 prije,
  3324 + 650 = 3974 poslije) iako je brojka u tablici narasla.
- **Otkucaj je gotovo dvostruko jeftiniji.** p50 pada s 47,3 na 29,5 ms, p95 s 303,5 na 180,7:
  planer, zakon i učilo prolaze kroz tri puta kraće popise stajališta.
- Uz to: sve 145 tramvajskih putanja sada ima segmente voznog reda (prije 107), jer se svaki
  uzorak preslikava na vlastitu putanju; 42 točnim nizom stajališta, 3 skraćenim, 1 starom
  pretpostavkom, 6 uzoraka nema nijednu putanju do koje bi došlo. Crtač sheme i dalje dosiže
  139 od 145 putanja -- on čita geometrijski popis, jer postavlja oznake na tiskani crtež, a ne
  planira.

Prolaz traje 5 minuta i 32 sekunde (22:46:35 do 22:52:07), uglavnom u simulaciji klijenta.

### Nakon F8b (putanja za svaki uzorak bez oblika), isti snimljeni dan

Mjereno 19. 9. 2026., ista naredba: `node scripts/replay-twin.mjs recordings/2026/09/17 --limit
2216`. **Prozor se ovaj put nije pomaknuo.** Direktorij je narastao s 2904 na 4733 okvira sa
zaglavljem, ali svi novi leže *iza* prozora: prva 2216 okvira po zaglavlju i dalje idu od
00:00:04Z do **06:34:27Z**, točno kao u tablici F8. To potvrđuju i same brojke -- `frames
processed` 2216, `vehicles seen` 433, sva tri broja ocijenjenih očitanja (373886 / 370862 /
362424) i simulacija klijenta (284077 slika, 25531087 tramvajskih slika) identični su F8. Zato
je tablica F8 valjan stupac „prije" nad **istim** okvirima i polazni kod nije ponovno pokretan.

Feed je provjeren prije i poslije: `feed_version` **000395**, `Last-Modified` Tue, 01 Sep 2026
08:50:29 GMT, 14.720.190 B -- isti kao u F8.

```
twin replay report
-------------------
frames processed:        2216 (dropped, no header: 0)
vehicles seen:           433

hindsight, bucket p50 / p95 (n graded fixes):
  10s:  p50 <50m    p95 ge200m  (n=373886)
  30s:  p50 <100m   p95 ge200m  (n=370862)
  60s:  p50 <200m   p95 ge200m  (n=362424)

signed hindsight, share of graded fixes (plan >=50 m ahead of the tram / within 50 m / >=50 m behind):
  10s:  ahead 24.4%  within 51.3%  behind 24.3%  (n=373886)
  30s:  ahead 28.9%  within 37.3%  behind 33.8%  (n=370862)
  60s:  ahead 30.4%  within 29.4%  behind 40.3%  (n=362424)

between-plan regressions (>25 m):     60119  (of 190788 consecutive plan pairs)
fix-order violations (<=5 s, >35 m):  2804  (of 1118044 fresh pairs on shared rails)
phantom stops:           0 of 11161 geometric entries on 152 paths (3302 served)
  shape paths:           100 paths, 7657 geometric / 2228 served / 0 phantom, median per path 76.5 / 22.0 / 0.0
  synthetic paths:       52 paths, 3504 geometric / 1074 served / 0 phantom, median per path 61.5 / 19.5 / 0.0
  paths without pattern: 0 (left out)

client simulation (polls land at header + 3.5 s, 12 Hz; 284077 frames, 25531087 tram-frames):
  backward frames (must be 0):        10707174
  visible crossings (must be 0):      10974
  hold-time share:                    8.4%  mean hold length: 5.5 s  (32733 holds)

overtakes (must be 0):   3336
reversals (must be 0):   0
concessions:             661
direction known share:   100.0%
unknown-trip share:      0.0%
first moving plan (s):   p50 833  p95 1794  (never moved: 5)
per-tick wall time (ms): p50 30.17  p95 194.71
```

Isti okviri, prije (F8) i poslije (F8b):

| Mjera | prije (F8) | poslije (F8b) | promjena |
|---|---|---|---|
| sintetičke putanje | 45 | **52** | sedam uzoraka koje 40-metarski usmjerivač nije mogao spojiti |
| tramvajske putanje sa segmentima voznog reda | 145 od 145 | **152 od 152** | svaka i dalje ima vozni red |
| uzorci bez oblika bez vlastite putanje | 6 nepreslikanih + 1 pogođen | **0 + 0** | 49 točnim nizom, 3 skraćena (linija 1) |
| posluženih zapisa | 3.100 | 3.302 | +202 (sedam novih putanja) |
| fantomska stajališta | 0 od 10.599 | 0 od 11.161 | i dalje 0 po konstrukciji |
| 30 s: plan ≥ 50 m ispred | 28,4 % | 28,9 % | +0,5 p. b. |
| 30 s: unutar 50 m | 37,6 % | 37,3 % | −0,3 p. b. |
| 30 s: plan ≥ 50 m iza | 34,1 % | 33,8 % | −0,3 p. b. |
| regresije među planovima (> 25 m) | 58.919 | 60.119 | +2,0 % |
| prekršaji redoslijeda prema očitanjima | 2.793 od 1.132.483 | 2.804 od 1.118.044 | +0,4 % broja, 0,247 ‰ → 0,251 ‰ |
| slike unatrag (klijent) | 10.543.874 | 10.707.174 | +1,5 % |
| vidljiva križanja | 10.324 | 10.974 | +6,3 % |
| preticanja | 3.324 | 3.336 | +0,4 % |
| ustupci | 650 | 661 | +1,7 % |
| **udio poznatog smjera** | 100,0 % | **100,0 %** | nepromijenjen, kako je i traženo |
| **udio nepoznate vožnje** | 0,0 % | **0,0 %** | nepromijenjen, kako je i traženo |
| otkucaj p50 / p95 | 29,45 / 180,72 ms | 30,17 / 194,71 ms | +2,4 % / +7,7 % |

Što se iz nje čita:

- **Nijedan uzorak bez oblika više nema tuđu putanju.** Prije F8b sedam uzoraka linija 2, 5 i 13
  (13/1 s 384 vožnje dnevno, 13/0 s 356, 5/1 sa 162, 2/1 sa 150) nije imalo nikakvu sintetičku
  putanju, pa su ih `candidatesFor` slagali na bilo koju putanju iste linije, a vozni red im je
  dolazio od drugog uzorka. Sada svaki od njih ima svoju putanju, svoj posluženi popis i svoj
  vozni red; `mapPatternsToPaths` javlja 0 nepreslikanih i 0 pogođenih.
- **Uzrok je bio radijus, ne usmjerivač.** Olipska 251_2 je 39,4 m od tračnice *suprotnog*
  smjera i 42,8 m od one kojom njezina linija vozi; na 40 m usmjerivač je vidio samo pogrešnu
  tračnicu i od nje do Držićeve nije bilo lanca. Poslužni radijus (`SERVED_STOP_MAX_METRES`,
  60 m, odluka A iz F8) odgovara na pitanje „na kojoj tračnici stoji stajalište *ove* linije",
  što je upravo pitanje koje usmjerivač postavlja. Geometrijskih 40 m ostaje netaknuto: ono
  odgovara na „pokraj kojih perona prolazi ova tračnica" i mora ostati usko.
- **Cijena je mala i posvuda jednaka.** Sedam novih putanja znači sedam uzoraka koje motor sada
  planira po vlastitoj geometriji umjesto po tuđoj, pa se svi retci pomiču za pola postotka do
  nekoliko postotaka; vidljiva križanja +6,3 % najveći su pomak. Ono što je moralo ostati --
  poznati smjer 100 % i nepoznata vožnja 0 % -- ostalo je.
- **Ostao je jedan pravi nedostatak grafa, i sada je izmjeren.** Devet skokova između dva
  susjedna stajališta vozi se znatno dalje nego što ide zrak: šest na putanjama linija 6, 9 i 17
  (Botanički vrt ↔ Zrinjevac, 3241–3261 m luka za 511–522 m zraka) koji su u artefaktu već od
  F8, i tri na linijama 13 (Šubićeva ↔ Trg žrtava fašizma, 1779–2122 m za 304–511 m). Uzrok je
  isti: graf nema čvor ondje gdje linija skreće, jer nijedan oblik u feedu ne crta to skretanje.
  Kod Šubićeve to se vidi golim okom -- Šubićeva ulica (brid 85) i Ulica kralja Zvonimira
  (bridovi 247/248, koje crtaju samo dva oblika noćne linije 32) križaju se *usred* oba brida,
  pa tramvaj koji tuda skreće nema kuda. Gradnja sada svaki takav skok ispisuje imenom
  (`HOP_DETOUR_FACTOR`), ali ga ne odbija: bez putanje bi uzorak bio ondje gdje je i bio.

Dopuna 16. 9. 2026., drugi prolaz, nakon što je područje Vijesti izašlo iz proizvoda
(`b8a6a19`) i karta postala cijelo polje javnog zaslona (`e60bbfc` do `c0c9867`): prijedlog,
Obrazac 2.2, plan provedbe i pitanja Povjerenstva kažu šest područja i devet modula izvora;
pločica vijesti nestala je iz trake Sada, imenika Još, prizora Grad i izvatka za zaslon prije
skeniranja, a i iz naslovne trake "Sada u Zagrebu", njezine skripte i snimke; redak HRT-a
nestao je iz tablice izvora, pa je označenih iznimaka pet. Replika javnog zaslona
`m-kiosk.html` nacrtana je iznova prema novoj kompoziciji (karta kroz sva tri prizora, oznaka
prizora u kutu, tračnica s trakom radova i četiri pločice linija uz donji rub karte; shema
tramvaja u omjeru 3 : 2, čitač artefakta `zet-network.json` prihvaća i inačicu 2), replika
telefona umjesto vijesti nosi pločicu Glasnika (broj 29/2026, 118 akata, prema API-ju Grada
16. 9. 2026.), slika arhitekture ima šest izvora. Brojevi testova u §6.3, §6.7 i Obrascu 2.2
osvježeni su iz istoga dana: Vitest 179 datoteka, 2.564 testova; Playwright 88 scenarija u 12
datoteka. Provjere ponovljene s istim ishodom: bez pogrešaka u konzoli i bez mrežnih
zahtjeva, bez prelijevanja na 390, 768 i 1440 px u obje teme, jedan h1, ispis u A4 41 stranica
sa svakom slikom cijelom, parnost teksta (iste dvije ćelije tablice kao pilula i napomena),
`test/docs` i čuvari kopije prolaze, `e2e/a11y.spec.ts` 20 scenarija prolazi nad `/prijava/`
i ostalim javnim stranicama. Word datoteka ponovno je složena s 13 slika; snimke slika za nju
rade se sa skrivenom ljepljivom statusnom linijom dokumenta, koja je dotad prekrivala vrh
slika viših od prozora.

Treći prolaz istoga dana, odluka vlasnika: HRT nikada neće biti izvor ove aplikacije, pa je
izbrisan iz svakog živog dokumenta, a s njim i svaki preostali trag dnevnih vijesti. Otpalo je:
redak HRT-a u tablici izvora poglavlja 5 i u slici `f-izvori` (22 retka umjesto 23), program
HRT-a i radija kao isporuka faze M5 u §1.3, Obrascu 2.2 (2.2.11, dvaput) i popisu izvora,
pismo HRT-u iz faze M2 u prijedlogu, planu provedbe i Obrascu 2.2, ime HRT-a iz naslova faze
M5 u planu, Obrascu 2.2 i slici `f-plan`, redak ZGportal iz žute tablice registra
izvora i rečenica da se HINA nikada ne preuzima (bespredmetna kad se vijesti ne preuzimaju
uopće), te dva zastarjela komentara u kodu koja su imenovala uklonjeno područje Vijesti
(`producers/index.ts`, `kiosk.css`). Ovo nije aplikacija za vijesti; hitna sigurnosna
informacija dolazi iz DHMZ-a, EMSC-a i Grada, nikada iz novinskog izvora.

### Nakon F8c (čvorovi na križanjima koja linije stvarno skreću), isti snimljeni dan

Mjereno 19. 9. 2026., ista naredba: `node scripts/replay-twin.mjs recordings/2026/09/17 --limit
2216`. **Prozor se opet nije pomaknuo.** Direktorij je u međuvremenu narastao na 5232 okvira,
ali prva 2216 po zaglavlju i dalje idu od 00:00:04Z do 06:34:27Z: `frames processed` 2216,
`vehicles seen` 433 i sva tri broja ocijenjenih očitanja (373886 / 370862 / 362424) identična
su F8 i F8b, pa je tablica F8b valjan stupac „prije" nad **istim** okvirima.

Feed je provjeren prije prve izmjene i nakon zadnje: `feed_version` **000395**, `Last-Modified`
Tue, 01 Sep 2026 08:50:29 GMT, 14.720.190 B -- isti bajt do bajta kao u F8 i F8b.

Gradnja mreže sada zatvara nedostatak koji je F8b samo izmjerio. Od devet predugih skokova
usmjerivač je ponudio **pet kandidatskih križanja**, a gradnja je zadržala **tri** -- ona na
kojima neka putanja doista skreće:

```
Junctions noded: 3 of 5 crossings considered for 9 long hops; 2 hops still route past 2x the straight line (2 allowlisted in scripts/gtfs-shapes-overrides.json)
Junction at 15.978,45.8056 (48.8 deg, 0.37 m off the exact crossing): edges 109 x 228 -> 111,112,231,232 at node 105
Junction at 15.9933,45.8104 (48.5 deg, 0.35 m off the exact crossing): edges 85 x 248 -> 85,86,253,254 at node 80
Junction at 15.9933,45.8103 (50.1 deg, 0.24 m off the exact crossing): edges 98 x 247 -> 99,100,251,252 at node 95
```

Prvi je kod Glavnog kolodvora (kolosijek prema jugu križa Mihanovićevu prema zapadu), druga dva
su dva kolosijeka Šubićeve ulice preko dva kolosijeka Ulice kralja Zvonimira. Preostala dva
kandidata (Šubićeva ↔ suprotni kolosijek Zvonimirove) nijedna putanja ne koristi, pa ih graf
nije dobio: čvor stvara skretanja na sve strane, a mreža puna skretanja koja nijedan tramvaj ne
vozi lošiji je model od jednog obilaska. Graf ima **293 brida nad 212 čvorova** (bilo 287 nad
209): šest bridova rasječeno je na dvanaest, sve ostalo je nedirnuto.

```
twin replay report
-------------------
frames processed:        2216 (dropped, no header: 0)
vehicles seen:           433

hindsight, bucket p50 / p95 (n graded fixes):
  10s:  p50 <50m    p95 ge200m  (n=373886)
  30s:  p50 <100m   p95 ge200m  (n=370862)
  60s:  p50 <200m   p95 ge200m  (n=362424)

signed hindsight, share of graded fixes (plan >=50 m ahead of the tram / within 50 m / >=50 m behind):
  10s:  ahead 23.9%  within 51.6%  behind 24.5%  (n=373886)
  30s:  ahead 28.4%  within 37.6%  behind 34.0%  (n=370862)
  60s:  ahead 29.9%  within 29.6%  behind 40.6%  (n=362424)

between-plan regressions (>25 m):     58944  (of 190816 consecutive plan pairs)
fix-order violations (<=5 s, >35 m):  2784  (of 1124149 fresh pairs on shared rails)
phantom stops:           0 of 11004 geometric entries on 152 paths (3302 served)
  shape paths:           100 paths, 7657 geometric / 2228 served / 0 phantom, median per path 76.5 / 22.0 / 0.0
  synthetic paths:       52 paths, 3347 geometric / 1074 served / 0 phantom, median per path 62.5 / 19.5 / 0.0
  paths without pattern: 0 (left out)

client simulation (polls land at header + 3.5 s, 12 Hz; 284077 frames, 25531087 tram-frames):
  backward frames (must be 0):        10490391
  visible crossings (must be 0):      10384
  hold-time share:                    8.1%  mean hold length: 5.4 s  (32063 holds)

overtakes (must be 0):   3304
reversals (must be 0):   0
concessions:             659
direction known share:   100.0%
unknown-trip share:      0.0%
first moving plan (s):   p50 833  p95 1794  (never moved: 5)
per-tick wall time (ms): p50 31.60  p95 200.89
```

Isti okviri, prije (F8b) i poslije (F8c), uz stupac F8 za mjeru cijelog kruga:

| Mjera | F8 | prije (F8b) | poslije (F8c) | promjena F8b → F8c |
|---|---|---|---|---|
| bridovi grafa / čvorovi | 287 / 209 | 287 / 209 | **293 / 212** | tri križanja postala su čvorovi |
| predugi skokovi (> 2× zraka i > 500 m) | 9 | 9 | **2, oba s obrazloženjem** | sedam popravljeno |
| sintetičke putanje | 45 | 52 | 52 | nijedna nije izgubljena |
| posluženih zapisa | 3.100 | 3.302 | 3.302 | nepromijenjeno |
| fantomska stajališta | 0 od 10.599 | 0 od 11.161 | **0 od 11.004** | 157 geometrijskih zapisa manje (obilasci više ne prolaze pokraj tuđih perona) |
| 30 s: plan ≥ 50 m ispred | 28,4 % | 28,9 % | 28,4 % | −0,5 p. b. |
| 30 s: unutar 50 m | 37,6 % | 37,3 % | **37,6 %** | +0,3 p. b. |
| 30 s: plan ≥ 50 m iza | 34,1 % | 33,8 % | 34,0 % | +0,2 p. b. |
| regresije među planovima (> 25 m) | 58.919 | 60.119 | **58.944** | −2,0 % |
| prekršaji redoslijeda prema očitanjima | 2.793 od 1.132.483 | 2.804 od 1.118.044 | **2.784 od 1.124.149** | −0,7 % broja, 0,251 ‰ → 0,248 ‰ |
| slike unatrag (klijent) | 10.543.874 | 10.707.174 | **10.490.391** | −2,0 % (ispod F8) |
| vidljiva križanja | 10.324 | 10.974 | **10.384** | −5,4 % |
| udio zadržavanja | — | 8,4 % / 5,5 s | 8,1 % / 5,4 s | −0,3 p. b. |
| preticanja | 3.324 | 3.336 | **3.304** | −1,0 % (ispod F8) |
| ustupci | 650 | 661 | 659 | −0,3 % |
| **udio poznatog smjera** | 100,0 % | 100,0 % | **100,0 %** | nepromijenjen, kako je i traženo |
| **udio nepoznate vožnje** | 0,0 % | 0,0 % | **0,0 %** | nepromijenjen, kako je i traženo |
| otkucaj p50 / p95 | 29,45 / 180,72 ms | 30,17 / 194,71 ms | 31,60 / 200,89 ms | +4,7 % / +3,2 % |

Što se iz nje čita:

- **Svaki redak kvalitete se popravio, i F8c poništava cijenu koju je F8b platio.** Regresije
  među planovima vratile su se na razinu F8 (58.944 prema 58.919), slike unatrag i preticanja
  pale su *ispod* F8, vidljiva križanja vratila su se na +0,6 % od F8 umjesto +6,3 %. Razlog je
  isti u svim retcima: sedam planova koji su vozili 1,5 do 2,7 km oko ugla koji tramvaj ne vozi
  više to ne rade, pa ne ostavljaju fantomske tramvaje na bridovima koje dijele druge linije,
  gdje zakon redoslijeda onda steže prave.
- **Sedam od devet skokova je popravljeno, dva nisu i to je zapisano.** Linija 13 sada skreće iz
  Šubićeve u Zvonimirovu u 304 m luka umjesto 1779 (`path:13:1:129fd87e`), odnosno 564 umjesto
  2122 m u suprotnom smjeru; linije 6 i 17 voze Zrinjevac → Botanički vrt u 747 m umjesto 3261.
  Preostaju **Botanički vrt → Zrinjevac na linijama 6 i 9** (3242 m luka za 511 m zraka). To
  skretanje se ne da učvoriti: kolosijek Mihanovićeve prema istoku *završava* u čvoru kod
  Glavnog kolodvora, a kolosijek prema sjeveru *počinje* 6,79 m dalje, pa se dvije crte nikada
  ne sijeku i nema točke koja leži na obje. 6,79 m je daleko izvan `SNAP_METRES` (2,5 m), a
  spajanje dvaju čvorova umjesto toga stvorilo bi tri okreta u mjestu koje nijedan tramvaj ne
  vozi. Oba skoka su zato imenovana u `scripts/gtfs-shapes-overrides.json` s razlogom; bez
  zapisa gradnja **pada**.
- **Graf sada nosi svoje ime.** Artefakt ima `graphHash` (SHA-256 nad poredanim bridovima kako
  ih žica nosi, 16 znamenki), blizanac pamti pod kojim je imenom učio i pri promjeni briše sve
  što je ključano indeksom brida (`edge_time`), a zadržava `stop_dwell`, koji je ključan
  identifikatorom stajališta i koji nijedna pregradnja ne prenumerira. Bez toga bi histogram za
  „brid 137" nakon ove pregradnje govorio o drugom komadu pruge.
- **Tri putanje linije 4 vratile su se na vlastiti ulazni brid.** F8b ih je nehotice pomaknuo na
  61-metarski privoz koji nijedan oblik linije 4 ne crta; prvo i zadnje stajalište uzorka sada
  opet čitaju geometrijskih 40 m (200-metarska iznimka za okretišta i dalje vrijedi), pa putanje
  kreću s brida koji crtaju oblici `4_3` i `4_9`.
- **Cijena je jedan otkucaj.** p50 je 31,60 ms prema 30,17 (+4,7 %); graf je za šest bridova
  veći, a putanje kraće, pa je to unutar šuma mjerenja na jednom prolazu.

### Nakon F9 (klijent nikad ne crta unatrag; redoslijed kroz konvergenciju), isti snimljeni dan

Mjereno 19. 9. 2026., ista naredba: `node scripts/replay-twin.mjs recordings/2026/09/17 --limit
2216`. **Prozor se opet nije pomaknuo**, a ovaj put stupac „prije" nije prepisan iz tablice F8c
nego **ponovno izmjeren** na istom stablu (`9e91716`) neposredno prije prve izmjene, pa su oba
stupca iz istoga sata i s istoga diska. Polazni prolaz vratio je F8c-ove brojke do znamenke
(slike unatrag 10.490.391, križanja 10.384, držanje 8,1 % / 5,4 s), osim vremena otkucaja, koje
je mjera opterećenja stroja, a ne koda.

Blizanac u ovoj cjelini nije mijenjan: `laws.ts` samo uvozi `edgeAt` i `mapArc` iz nove
datoteke `shared/motion/order.ts`. Svi retci koji mjere blizanca zato moraju biti, i jesu,
identični do znamenke: ocjena unatrag sva tri horizonta, regresije među planovima (58.944),
prekršaji redoslijeda prema očitanjima (2.784), fantomska stajališta (0 od 11.004), preticanja
(3.304), vožnje unatrag u planu (0), ustupci (659), poznati smjer i nepoznata vožnja. Promijenio
se samo klijent.

```
twin replay report
-------------------
frames processed:        2216 (dropped, no header: 0)
vehicles seen:           433

hindsight, bucket p50 / p95 (n graded fixes):
  10s:  p50 <50m    p95 ge200m  (n=373886)
  30s:  p50 <100m   p95 ge200m  (n=370862)
  60s:  p50 <200m   p95 ge200m  (n=362424)

signed hindsight, share of graded fixes (plan >=50 m ahead of the tram / within 50 m / >=50 m behind):
  10s:  ahead 23.9%  within 51.6%  behind 24.5%  (n=373886)
  30s:  ahead 28.4%  within 37.6%  behind 34.0%  (n=370862)
  60s:  ahead 29.9%  within 29.6%  behind 40.6%  (n=362424)

between-plan regressions (>25 m):     58944  (of 190816 consecutive plan pairs)
fix-order violations (<=5 s, >35 m):  2784  (of 1124149 fresh pairs on shared rails)
phantom stops:           0 of 11004 geometric entries on 152 paths (3302 served)
  shape paths:           100 paths, 7657 geometric / 2228 served / 0 phantom, median per path 76.5 / 22.0 / 0.0
  synthetic paths:       52 paths, 3347 geometric / 1074 served / 0 phantom, median per path 62.5 / 19.5 / 0.0
  paths without pattern: 0 (left out)

client simulation (polls land at header + 3.5 s, 12 Hz; 284077 frames, 25531087 tram-frames):
  backward frames (must be 0):        0
  visible crossings (must be 0):      13240
  hold-time share:                    8.9%  mean hold length: 5.0 s  (37677 holds)

overtakes (must be 0):   3304
reversals (must be 0):   0
concessions:             659
direction known share:   100.0%
unknown-trip share:      0.0%
first moving plan (s):   p50 833  p95 1794  (never moved: 5)
per-tick wall time (ms): p50 35.34  p95 214.21
```

Isti okviri, prije (`9e91716`, ponovno izmjereno) i poslije (F9):

| Mjera | prije | poslije | promjena |
|---|---|---|---|
| **slike unatrag (klijent)** | 10.490.391 od 25.531.087 | **0** | −100 %, cilj kruga |
| vidljiva križanja | 10.384 | **13.240** | +27,5 % |
| udio držanja | 8,1 % | 8,9 % | +0,8 p. b. |
| prosječna duljina držanja | 5,4 s | 5,0 s | −0,4 s |
| broj držanja | 32.063 | 37.677 | +17,5 % |
| tramvajske slike | 25.531.087 | 25.531.087 | isti okviri |
| 30 s: ispred / unutar / iza | 28,4 / 37,6 / 34,0 % | 28,4 / 37,6 / 34,0 % | nepromijenjeno (blizanac nije diran) |
| regresije među planovima | 58.944 | 58.944 | nepromijenjeno |
| prekršaji redoslijeda prema očitanjima | 2.784 | 2.784 | nepromijenjeno |
| preticanja / ustupci | 3.304 / 659 | 3.304 / 659 | nepromijenjeno |
| otkucaj p50 / p95 | 30,14 / 187,01 ms | 35,34 / 214,21 ms | +17 % / +15 % |

Što se iz nje čita:

- **Nijedna oznaka se više ne crta unatrag, nijedne slike od 25,5 milijuna.** Bilo ih je
  10.490.391 (41,1 % tramvajskih slika u ovom prolazu). Dopuštenje od metra u sekundi do 30 m po
  planu nije više ograničeno nego ukinuto, za svaku vrstu vozila: kad plan stavi vozilo iza
  nacrtane oznake, oznaka **stoji** dok je plan ne sustigne (`Drawn.holding`). To je vlasnikovo
  pravilo kruga — radije iza nego ispred, sustizanje unaprijed, držanje kad je proturječno —
  doslovno provedeno na zaslonu.
- **Cijena je da se proturječje više ne može sakriti.** Vidljivih križanja ima 27,5 % više, i to
  nije nova greška nego ista stara, sada vidljiva. Dosadašnja stezaljka *upisivala* je zaostalu
  oznaku unatrag na svakoj slici, pa je par na istoj putanji bio „ispravljen" u jednoj slici — po
  cijenu tramvaja koji se na ekranu vraća. Sada se par može razriješiti samo unaprijed, pa ostaje
  vidljiv dok ga vođa ne prestigne. Proturječja pritom nisu klijentova: blizanac u istom prolazu
  objavi 58.944 regresije među uzastopnim planovima i 2.784 prekršaja redoslijeda prema
  očitanjima, i svaki put kad se redoslijed dvaju planova okrene između dviju anketa klijent
  danas nema ništa drugo za čitati — `data.behind` još nije na žici. Registar redoslijeda (E3)
  je korak koji to gasi na izvoru; tek s njim ovaj redak može pasti na nulu.
- **Stezaljka sada uopće vidi parove koje prije nije.** Grupirala je samo oznake na **istoj**
  geometriji (`p<idx>`), pa tramvaj linije 1 i tramvaj linije 2 na zajedničkom kolosijeku jedno
  drugome nisu postojali. Sada je par svaki par na dijeljenim tračnicama (`onSharedRails` iz
  `shared/motion/order.ts`), a strop (`min(vođa.s, vođa.plan) − 35 m`) preslikava se na putanju
  sljedbenika preko `mapArc`. Vođa čiji strop ne pada ni na jedan brid sljedbenikove putanje ne
  ograničava ništa — tada su se putanje razišle i tramvaj ispred više nije na istim tračnicama.
- **Držanja je nešto više i kraća su.** 8,9 % naspram 8,1 % slika, prosječno 5,0 s umjesto 5,4 s:
  oznaka koja bi prije krenula unatrag sada pričeka, a kako pričeka odmah, čeka kraće.
- **Otkucaj blizanca nije se usporio zbog blizanca.** Njegov kod nije mijenjan, a svi njegovi
  retci su identični do znamenke; p50 raste jer u istom procesu, između otkucaja, sada radi skuplja
  simulacija klijenta (cijeli prolaz 8 min 26 s naspram 5 min 42 s), pa čišćenje smeća pada i
  unutar mjerenog otkucaja. Prva inačica stezaljke radila je po jednu mapu, dva skupa i niz
  ključeva po slici i dala je 10 min 26 s uz p50 44,66 ms; radni skup je nakon toga premješten na
  same oznake i čisti se umjesto da se gradi, uz istovjetan ishod (0 slika unatrag, 13.240
  križanja, 8,9 % držanja; dva držanja razlike od 37.677 dolaze od drukčijeg, jednako valjanog,
  prekidanja ciklusa u pometanju). U pregledniku je to ionako 40 μs po slici na 150 oznaka.
- **Što još nosi ova cjelina, a replay ne mjeri:** ponovno sjedanje na novu geometriju više ne
  uzima globalno najbližu točku nego najbližu *unutar prozora* oko luka koji novi plan imenuje
  (petlja i okretište prolaze sama pokraj sebe na nekoliko metara, a cijeli krug dalje po luku),
  i gornja granica koraka po slici podignuta je s 0,25 s na 1 s, koliko traje otkucaj smanjenog
  kretanja (`loop.ts`): dotad je takav otkucaj integrirao četvrtinu sekunde koju pokriva, pa je
  oznaka na javnom zaslonu zaostajala za planom zauvijek.

### Nakon F10 (registar redoslijeda iz očitanja, `behind` na žici, matcher zna smjer, identitet kroz vožnje), isti snimljeni dan

Mjereno 19. 9. 2026., ista naredba i isti prozor: `node scripts/replay-twin.mjs
recordings/2026/09/17 --limit 2216`. Stupac „prije" **ponovno je izmjeren** na `fd8afae` (stanje
poslije F9) neposredno prije prve izmjene i vratio je F9-ovu tablicu do znamenke — sva tri
horizonta ocjene unatrag, 58.944 regresije, 2.784 prekršaja redoslijeda, 3.304 preticanja, 659
ustupaka, 0 slika unatrag, 13.240 križanja — osim vremena otkucaja, koje je mjera opterećenja
stroja, a ne koda.

```
twin replay report
-------------------
frames processed:        2216 (dropped, no header: 0)
vehicles seen:           433

hindsight, bucket p50 / p95 (n graded fixes):
  10s:  p50 <50m    p95 ge200m  (n=374127)
  30s:  p50 <100m   p95 ge200m  (n=371250)
  60s:  p50 <200m   p95 ge200m  (n=363023)

signed hindsight, share of graded fixes (plan >=50 m ahead of the tram / within 50 m / >=50 m behind):
  10s:  ahead 17.3%  within 56.1%  behind 26.6%  (n=374127)
  30s:  ahead 21.5%  within 41.6%  behind 36.9%  (n=371250)
  60s:  ahead 23.3%  within 33.0%  behind 43.8%  (n=363023)

between-plan regressions (>25 m):     41243  (of 190649 consecutive plan pairs)
fix-order violations (<=5 s, >35 m):  1883  (of 1088537 fresh pairs on shared rails)
phantom stops:           0 of 11004 geometric entries on 152 paths (3302 served)
  shape paths:           100 paths, 7657 geometric / 2228 served / 0 phantom, median per path 76.5 / 22.0 / 0.0
  synthetic paths:       52 paths, 3347 geometric / 1074 served / 0 phantom, median per path 62.5 / 19.5 / 0.0
  paths without pattern: 0 (left out)

client simulation (polls land at header + 3.5 s, 12 Hz; 284077 frames, 25531087 tram-frames):
  backward frames (must be 0):        0
  visible crossings (must be 0):      6471
  hold-time share:                    3.9%  mean hold length: 3.4 s  (23847 holds)

overtakes (must be 0):   17
reversals (must be 0):   0
concessions / swaps:     77 / 34
direction known share:   100.0%
unknown-trip share:      0.0%
first moving plan (s):   p50 836  p95 1794  (never moved: 5)
per-tick wall time (ms): p50 18.81  p95 44.48
```

Isti okviri, prije (`fd8afae`, ponovno izmjereno) i poslije (F10):

| Mjera | prije | poslije | promjena |
|---|---|---|---|
| **preticanja (blizanac)** | 3.304 | **17** | −99,5 % |
| **prekršaji redoslijeda prema očitanjima** | 2.784 od 1.124.149 | **1.883** od 1.088.537 | −32,4 % |
| **vidljiva križanja (klijent)** | 13.240 | **6.471** | −51,1 % |
| slike unatrag (klijent) | 0 od 25.531.087 | **0** | cilj kruga i dalje drži |
| vožnje unatrag u planu | 0 | 0 | drži |
| regresije među planovima | 58.944 od 190.816 | 41.243 od 190.649 | −30,0 % |
| 10 s: ispred / unutar / iza | 23,9 / 51,6 / 24,5 % | 17,3 / 56,1 / 26,6 % | −6,6 p. b. ispred |
| 30 s: ispred / unutar / iza | 28,4 / 37,6 / 34,0 % | 21,5 / 41,6 / 36,9 % | −6,9 p. b. ispred |
| 60 s: ispred / unutar / iza | 29,9 / 29,6 / 40,6 % | 23,3 / 33,0 / 43,8 % | −6,6 p. b. ispred |
| ustupci / zamjene | 659 / — | 77 / 34 | −83,2 % ustupaka |
| udio držanja | 8,9 % | 3,9 % | −5,0 p. b. |
| prosječna duljina držanja | 5,0 s | 3,4 s | −1,6 s |
| broj držanja | 37.677 | 23.847 | −36,7 % |
| poznati smjer | 100,0 % | 100,0 % | drži |
| otkucaj p50 / p95 | 47,26 / 247,22 ms | 18,81 / 44,48 ms | −60 % / −82 % |

Što se iz nje čita:

- **Preticanja su praktički nestala: 3.304 → 17.** Ta mjera broji svaki put kad se upisani
  redoslijed dvaju tramvaja okrene, a da to nije bio ustupak. Stari zakon
  (`shared/motion/laws.ts`) izvodio je redoslijed iz **dvaju planova** u svakom otkucaju, pa je
  svako križanje dviju ekstrapolacija bilo okretanje; registar (`shared/motion/order.ts`) piše ga
  jednom, iz **očitanja**, i mijenja ga samo ustupkom (77) ili odlučnom zamjenom (34) — 111
  okretanja kroz jutro umjesto 3.963. Preostalih 17 su parovi kojima je odnos pao (razišli su se
  ili je zastario) pa se odmah upisao obrnuto; harness to ne razlikuje od preticanja, i ispravno
  je da ne razlikuje.
- **Prekršaji redoslijeda prema očitanjima padaju za trećinu, ispod polazne vrijednosti kruga.**
  Vrata plana su „ne iznad polazne" (2.784 nakon F7 i F9); F10 daje 1.883. Razlog je izravan: gdje
  odnos stoji, planovi se slažu s očitanjima po konstrukciji, jer je redoslijed iz očitanja i
  proizašao. Preostatak je **namjeran** i vrijedi ga imenovati: harness broji svaki par čija se
  očitanja razlikuju za više od duljine tramvaja (35 m), a registar upisuje odnos tek iznad 60 m
  — dva raspršenja ZET-ova GPS-a. Pojas između 35 i 60 m ostaje neuređen jer u njemu očitanje ne
  može reći tko je ispred; spustiti prag znači upisivati redoslijed iz šuma, što je točno ono što
  je stari zakon radio.
- **Vidljiva križanja su prepolovljena (13.240 → 6.471), ali nisu nula.** Krug traži nulu. Klijent
  od F9 par može razriješiti samo unaprijed (oznaka nikad ne ide unatrag), pa proturječje ostaje
  vidljivo dok ga vođa ne prestigne; registar gasi **izvor** većine tih proturječja, ali par koji
  blizanac uopće ne uređuje — skupljen unutar 60 m, ili na tračnicama koje se ne daju pročitati u
  jednom okviru — i dalje nema ništa osim planova. Ostatak visi o 41.243 regresije među uzastopnim
  planovima, a to su pravila planera (F11), ne registra.
- **Plan je rjeđe ispred tramvaja, na svim horizontima (−6,6 do −6,9 p. b.).** Vlasnikovo pravilo
  kruga je „radije iza nego ispred"; oznaka ispred koja se mora vraćati čita se kao pokvarena
  aplikacija. Najveći pojedinačni doprinos je vremenski ograničen **push**: zastarjelom vođi se
  sada podižu samo čvorovi **od trenutka sljedbenikova očitanja nadalje**, a nikad sidro, pa jedno
  očitanje iza više ne teleportira cijeli tuđi plan naprijed (D6).
- **Držanja ima upola manje i kraća su (8,9 % → 3,9 %, 5,0 s → 3,4 s).** Držanje je cijena
  proturječja: kad ga je manje, oznake stoje rjeđe i kraće, a nijedna i dalje ne ide unatrag.
- **Otkucaj je dvostruko brži (p50 47,26 → 18,81 ms, p95 247,22 → 44,48 ms).** Stari zakon je za
  svaki par u svakom otkucaju iznova uspostavljao odnos i ubacivao prijelomne točke po cijelom
  planu; registar radi samo za parove koji odnos imaju. Dio razlike je i opterećenje stroja, ali
  p95 pada osam puta, što opterećenje ne objašnjava.
- **Identitet vozila je provjeren na istom prozoru.** Od 433 identifikatora vozila njih 418 mijenja
  vožnju, a 415 pritom ima **neprekinut** niz očitanja (razmak manji od 300 s, koliko je i prag
  ispadanja iz blizanca); od 2.495 promjena vožnje 2.410 je neprekinuto, a jedan identifikator
  nosi i do 23 vožnje. Zato blizanac od F10 zadržava `Track` kad nova vožnja vozi brid na kojem
  vozilo stoji ili kreće s perona na kojem stoji: dotad je na svakom okretištu bacao očitanja,
  procjenu brzine i registar zajedno s njima.
- **Smjer i dalje zna za svako vozilo (100 %), a sada ga i koristi.** `adoptPath` je slaganje s
  kretanjem računao pa bacao (`void agrees`); okret na okretištu pod starim identifikatorom vožnje
  čitao se kao tramvaj koji hoda unatrag niz vlastitu liniju, jer je povratni kolosijek nekoliko
  metara dalje — unutar bliskog pojasa, pa brojač skretanja nikad nije opalio (D4). Dva uzastopna
  očitanja protiv tangente putanje sada izvode putanju na suprotan smjer iste linije.

### Nakon F11 (tablica zadržavanja, popravci stanja planera, kvantili, čekanja na križanjima, objavljeni pod), isti snimljeni dan

Mjereno 19. 9. 2026., ista naredba i isti prozor: `node scripts/replay-twin.mjs
recordings/2026/09/17 --limit 2216`.

**Oba stupca voze isti harness.** F11 je u `scripts/replay-core.ts` dodao ono što
`worker/do/twin-do.ts` radi u svakom otkucaju — dokazi otkucaja vraćaju se u motor, pa motor kroz
dan uči. Prvo mjerenje „prije” vozilo je harness **bez** te povratne veze, pa je uspoređivalo planer
koji ništa ne uči s planerom koji uči cijeli dan: usporedbu dvaju harnessa, a ne dvaju planera.
Stupac „prije” zato je **ponovno izmjeren na `ee94037` s istim jednim retkom dodanim u njegov
`replay-core.ts`** (`recordEvidence(engine.learned, result.learned)` i ništa drugo).

Razlika nije mala i ide na štetu starog planera: s učenjem `ee94037` je **gori** nego bez njega
(23,8 % umjesto 21,5 % planova ispred tramvaja na 30 s, 47.052 regresije umjesto 41.243, 36.971
držanje umjesto 23.847). Razlog je sam po sebi nalaz: stari je učitelj upisivao zadržavanje i za
tramvaje koji nisu stajali (nema provjere mirovanja), a stari je planer to onda knjižio po medijanu.
Pošten pomak F11 je zato **veći** od prvotno prijavljenog: −7,9 postotnih bodova na 30 s umjesto
−5,9.

```
twin replay report
-------------------
frames processed:        2216 (dropped, no header: 0)
vehicles seen:           433

hindsight, bucket p50 / p95 (n graded fixes):
  10s:  p50 <50m    p95 ge200m  (n=374127)
  30s:  p50 <100m   p95 ge200m  (n=371250)
  60s:  p50 <200m   p95 ge200m  (n=363023)

signed hindsight, share of graded fixes (plan >=50 m ahead of the tram / within 50 m / >=50 m behind):
  10s:  ahead 13.0%  within 56.2%  behind 30.8%  (n=374127)
  30s:  ahead 15.9%  within 40.5%  behind 43.6%  (n=371250)
  60s:  ahead 16.2%  within 30.7%  behind 53.1%  (n=363023)

between-plan regressions (>25 m):     19996  (of 190661 consecutive plan pairs)
fix-order violations (<=5 s, >35 m):  1884  (of 1089735 fresh pairs on shared rails)
phantom stops:           0 of 11004 geometric entries on 152 paths (3302 served)
  shape paths:           100 paths, 7657 geometric / 2228 served / 0 phantom, median per path 76.5 / 22.0 / 0.0
  synthetic paths:       52 paths, 3347 geometric / 1074 served / 0 phantom, median per path 62.5 / 19.5 / 0.0
  paths without pattern: 0 (left out)

client simulation (polls land at header + 3.5 s, 12 Hz; 284077 frames, 25531087 tram-frames):
  backward frames (must be 0):        0
  visible crossings (must be 0):      5895
  hold-time share:                    1.4%  mean hold length: 2.1 s  (14282 holds)

overtakes (must be 0):   17
reversals (must be 0):   0
concessions / swaps:     77 / 32
direction known share:   100.0%
unknown-trip share:      0.0%
first moving plan (s):   p50 848  p95 1781  (never moved: 5)
per-tick wall time (ms): p50 32.92  p95 49.07

planner interventions:   floor 134709  junction_wait 20187  stand_fix 20294  eta_bound_skipped 57624
learned by the end:      1142 edge cells / 1162 stop cells / 333 node cells; 11168 dwell samples, 1720 junction waits of 5695 passes, 228 platforms in the recent window
dwell candidates:        11168 kept, 3209 refused by the stationarity gate (1466 with ONE fix in the zone = ambiguous, 1743 with two or more that all moved = pass-through); ambiguous share of all candidates 10.2%

why the plan was ahead at 30 s (share of the fixes graded in each situation that had the plan >=50 m ahead):
  anchor age <10 s:           16.6%  (44248 of 266125)
  anchor age 10-20 s:         18.4%  (7714 of 42022)
  anchor age 20-30 s:         25.2%  (2450 of 9703)
  anchor age >=30 s:          23.0%  (4656 of 20261)
  anchor standing:            15.7%  (20097 of 127962)
  anchor moving:              18.5%  (38971 of 210149)
  junction within 30 s:       21.1%  (2657 of 12579)
  no junction within 30 s:    17.3%  (56411 of 325532)
```

Isti okviri, prije (`ee94037` **s povratnom vezom**) i poslije (F11):

| Mjera | prije (pošteno) | poslije | promjena | *(prije, bez povratne veze)* |
|---|---|---|---|---|
| **10 s: ispred / unutar / iza** | 19,1 / 56,4 / 24,5 % | **13,0** / 56,2 / 30,8 % | −6,1 p. b. ispred | *17,3 / 56,1 / 26,6 %* |
| **30 s: ispred / unutar / iza** | 23,8 / 42,6 / 33,6 % | **15,9** / 40,5 / 43,6 % | −7,9 p. b. ispred | *21,5 / 41,6 / 36,9 %* |
| **60 s: ispred / unutar / iza** | 26,5 / 34,0 / 39,5 % | **16,2** / 30,7 / 53,1 % | −10,3 p. b. ispred | *23,3 / 33,0 / 43,8 %* |
| **regresije među planovima** | 47.052 od 190.651 | **19.996** od 190.661 | −57,5 % | *41.243* |
| **vidljiva križanja (klijent)** | 6.638 | **5.895** | −11,2 % | *6.471* |
| **udio držanja / broj držanja** | 8,4 % / 36.971 | **1,4 % / 14.282** | −7,0 p. b. / −61,4 % | *3,9 % / 23.847* |
| prosječna duljina držanja | 4,9 s | 2,1 s | −2,8 s | *3,4 s* |
| slike unatrag (klijent) | 0 od 25.531.087 | **0** | cilj kruga drži | *0* |
| vožnje unatrag u planu | 0 | 0 | drži | *0* |
| preticanja (blizanac) | 17 | 17 | drži | *17* |
| prekršaji redoslijeda prema očitanjima | 1.898 od 1.087.933 | 1.884 od 1.089.735 | −0,7 % | *1.883* |
| ustupci / zamjene | 77 / 34 | 77 / 32 | −2 zamjene | *77 / 34* |
| razred p50 / p95 (10/30/60 s) | <50 / <100 / <200 m; p95 ≥200 m | isto | drži | *isto* |
| poznati smjer | 100,0 % | 100,0 % | drži | *100,0 %* |
| otkucaj p50 / p95 | 14,44 / 24,87 ms | 32,92 / 49,07 ms | p50 raste | *13,86 / 49,62 ms* |

**Popravak I2 iz završnog pregleda grane (svjedok iz TripUpdatea više ne nadglasava očitanja koja mu proturječe), isti prozor i ista naredba:** ustupci 77 → **58**, zamjene 32 → **27**, vidljiva križanja 5.895 → **3.175** (−46,1 %), prekršaji redoslijeda prema očitanjima 1.884 → **313** (−83,4 %), preticanja 17 → **1**, regresije 19.996 → 19.645 (−1,8 %), držanja 14.282 → 13.737, 30 s ispred 15,9 → 15,8 % — ZET-ov `next_stop` ide stajalište ispred zakašnjelog tramvaja, pa je par u kojem se najava i dva očitanja razilaze proturječje, a ne bolji dokaz.

#### Gdje plan još uvijek bježi ispred tramvaja

Cilj E4 traži udio „50 m ili više ispred” na 30 s od 10 % ili niže. F11 daje **15,9 %**. Ograničenja
su ispunjena s puno zraka — „iza” 43,6 % prema dopuštenih 57,4 % (polazni ukupni udio pogrešaka
iznad 50 m na 30 s), razredi p95 nepromijenjeni — pa prostor za nagib postoji, ali ga kvantili ne
koriste. Zato ocjenjivač od ove izmjene **dijeli te ocjene po situaciji** (tri retka gore), i tek se
iz njih vidi gdje ostatak živi. Udjeli su unutar svake situacije, a nazivnici su vlastiti, pa se
čita „od očitanja ocijenjenih u ovoj situaciji, toliko ih je imalo plan ispred”:

| Situacija u kojoj je plan objavljen | udio „ispred” | koliko ocijenjenih | koliko od svih „ispred” |
|---|---|---|---|
| sidro mlađe od 10 s | 16,6 % | 266.125 | **74,9 %** |
| sidro 10–20 s | 18,4 % | 42.022 | 13,1 % |
| sidro 20–30 s | 25,2 % | 9.703 | 4,1 % |
| sidro starije od 30 s | 23,0 % | 20.261 | 7,9 % |
| sidro **stoji** | 15,7 % | 127.962 | 34,0 % |
| sidro **vozi** | 18,5 % | 210.149 | **66,0 %** |
| križanje unutar 30 s plana | 21,1 % | 12.579 | 4,5 % |
| nema križanja unutar 30 s | 17,3 % | 325.532 | 95,5 % |

Što se iz toga čita, i to mijenja ono što je prije stajalo ovdje:

- **Ostatak nije zastarjeli dokaz.** Tri četvrtine svih planova koji su završili ispred tramvaja
  objavljeno je sa sidrom **mlađim od deset sekundi**. Stara očitanja jesu gora *po stopi* (25,2 %
  na 20–30 s prema 16,6 % ispod 10 s), ali ih je premalo da bi nosila zbroj. Čekanje na svježije
  očitanje ne bi popravilo skoro ništa.
- **Ostatak nije ni tramvaj koji stoji, nego tramvaj koji vozi pa stane.** Sidro koje vozi daje
  **dvije trećine** svih „ispred” i ima višu stopu (18,5 % prema 15,7 %). Popravci stanja (D8) i
  objavljeni pod riješili su slučaj „tramvaj stoji na peronu, a plan je otišao”; ono što je ostalo
  je „tramvaj je vozio, plan ga je produžio po kvantilu, a on je u sljedećih pola minute stao zbog
  nečega što feed ne javlja”.
- **Križanja nose malo, a njihov predznak nije stabilan.** U ovom prozoru stopa je ondje gdje čvor
  stupnja većeg od dva leži unutar 30 s plana viša (21,1 % prema 17,3 %), ali na **cijelom danu je
  niža** (17,4 % prema 18,3 %) — vidi odjeljak o punom danu. Predznak se okreće, pa se na taj redak
  ne smije nasloniti zaključak. Takvih je ocjena ionako samo 3,7 % svih, pa ta situacija nosi 4,5 %
  ostatka. Sljedeći korak — **više mjesta na kojima se stajanje može predvidjeti** (semafor koji nije
  na čvoru stupnja većeg od dva, naučeno sporo mjesto po bridu i satu, zatvorena ulica iz ZET-ovih
  obavijesti) — stoji na prva dva retka podjele, koji su na oba mjerenja isti, a ne na ovom.
- Nazivnici ovdje (338.111 ocjena) nešto su manji od zaglavnih (371.250): ocjenjivač pamti stanje
  osam zadnjih objavljenih planova po vozilu, pa ocjena protiv plana starijeg od toga ostaje bez
  situacije i ispada iz podjele. Udjeli su zato usporedivi međusobno, a zaglavni broj (15,9 %) ostaje
  mjera koja vrijedi.

#### Kako su odabrane konstante

Četiri prolaza kroz isti prozor, sva tri broja mijenjana zajedno. **Ti su prolazi izmjereni prije
popravka `movingNow` iz pregleda F11** (planer je tada zadržavao i tramvaj koji je kroz zonu prošao
s jednim očitanjem u njoj); zaključci vrijede jer su svi mjereni pod istim pravilima, a odabrani
prolaz 4 ponovno je izmjeren poslije popravka i pomaknuo se za 0,3 postotna boda (15,6 → 15,9 %
ispred, 19.827 → 19.996 regresija).

| Prolaz | `PLAN_QUANTILE` | `DWELL_PLAN_QUANTILE` | `JUNCTION_STOP_SHARE` | 30 s ispred | 30 s unutar | 30 s iza | regresije | križanja | držanja |
|---|---|---|---|---|---|---|---|---|---|
| 1 (polazne) | 0,65 | 0,70 | 0,40 | 17,6 % | 42,3 % | 40,1 % | 24.608 | 6.108 | 20.281 |
| 2 | 0,80 | 0,85 | 0,30 | 16,5 % | 41,4 % | 42,0 % | 23.121 | 5.941 | 16.880 |
| 3 | 0,90 | 0,90 | 0,25 | 15,6 % | 40,4 % | 44,1 % | 19.737 | 5.826 | 14.146 |
| **4 (odabrano)** | **0,90** | **0,90** | **0,40** | **15,6 %** | **40,4 %** | **44,0 %** | **19.827** | **5.868** | **14.156** |

- **Kvantili se isplate, ali skromno.** Cijeli raspon od 0,65/0,70 do 0,90/0,90 nosi 2,0 postotna
  boda udjela „ispred” na 30 s, a plaća 0,8 postotnih bodova udjela „unutar 50 m” na **10 s** — a to
  je horizont na kojem gledatelj zapravo živi. Uz to padaju regresije (−19 %), križanja (−3,9 %) i
  držanja (−30 %). Dalje se nije išlo: kvantil iznad najsporije desetine prestaje opisivati dionicu,
  a počinje opisivati njezino najgore jutro.
- **Spuštanje praga na križanjima ne zarađuje ništa.** Prolaz 3 i prolaz 4 razlikuju se samo po
  `JUNCTION_STOP_SHARE` (0,25 prema 0,40). Na 0,25 planer knjiži 21 % više čekanja (24.423 prema
  20.178), a dobiva 0,5 % regresija i 0,7 % križanja, dok je ocjena po predznaku ista do desetine
  boda na svakom horizontu. Načelni prag od 0,4 ostaje.

#### Cijena provjere mirovanja: pristranost preživjelih

Uzorak zadržavanja od F11 traži **par mirovanja** u zoni perona. Ono što odbija nije jedna vrsta
stvari nego dvije, i samo je jedna od njih bila pogrešna:

```
dwell candidates:  11.168 zadržano, 3.209 odbijeno
                   1.466 s JEDNIM očitanjem u zoni  (dvosmisleno: ne dokazuje ni stajanje ni prolaz)
                   1.743 s dva ili više, sva u pokretu (dokazan prolaz: nikad nije ni bilo zadržavanje)
                   dvosmislenih 10,2 % svih kandidata
```

Prolaz kroz peron doista nije zadržavanje i njegovo je odbijanje ispravak. Kandidat s **jednim**
očitanjem u zoni je nešto drugo: pri ZET-ovu osvježavanju dva od tri, **kratko** zadržavanje je baš
ono koje najčešće ostavi jedno očitanje u zoni (tramvaj koji je stajao 8 s javi se ondje jednom, onaj
koji je stajao 40 s tri puta). Zato uzorci koji prežive **naginju na dugu stranu**, a tablica ih onda
čita na `DWELL_PLAN_QUANTILE` — dvije pristranosti u istom smjeru. Mjera je gore: 1.466 od 14.377
kandidata, 10,2 %. Ispravak nije blaža provjera (to je D1 natrag) nego procjenitelj koji zna da su
podaci cenzurirani; dotad je ovo poznata i izmjerena pristranost, a ne skrivena.

#### Cijeli snimljeni dan (7.972 okvira)

`node scripts/replay-twin.mjs recordings/2026/09/17`, s odabranim konstantama i poslije popravaka iz
pregleda, protiv polazne tablice cijelog dana iz `replay-fullday-baseline-cd7495c.txt`.

**Ovo nije kontrolirana razlika i ne smije se čitati kao takva.** Ta polazna tablica je `cd7495c`,
stanje **prije F8**, i vožena je harnessom **bez povratne veze učenja** — dakle razlikuju se i
planer (cijeli krug F: F8 posluženi popis stajališta, F9 klijent koji ne crta unatrag, F10 registar
redoslijeda, F11 planer i zadržavanje) i harness. Kontrolirana razlika koja mjeri samo F11 je
tablica prozora gore. Ovdje se čita veličina i smjer, ne pripisivanje.

```
twin replay report
-------------------
frames processed:        7972 (dropped, no header: 0)
vehicles seen:           473

hindsight, bucket p50 / p95 (n graded fixes):
  10s:  p50 <50m    p95 <200m   (n=1560618)
  30s:  p50 <100m   p95 ge200m  (n=1549449)
  60s:  p50 <200m   p95 ge200m  (n=1530176)

signed hindsight, share of graded fixes (plan >=50 m ahead of the tram / within 50 m / >=50 m behind):
  10s:  ahead 13.8%  within 56.8%  behind 29.4%  (n=1560618)
  30s:  ahead 17.3%  within 40.1%  behind 42.6%  (n=1549449)
  60s:  ahead 17.9%  within 29.8%  behind 52.3%  (n=1530176)

between-plan regressions (>25 m):     85387  (of 841568 consecutive plan pairs)
fix-order violations (<=5 s, >35 m):  6974  (of 4495247 fresh pairs on shared rails)
phantom stops:           0 of 11004 geometric entries on 152 paths (3302 served)
  shape paths:           100 paths, 7657 geometric / 2228 served / 0 phantom, median per path 76.5 / 22.0 / 0.0
  synthetic paths:       52 paths, 3347 geometric / 1074 served / 0 phantom, median per path 62.5 / 19.5 / 0.0
  paths without pattern: 0 (left out)

client simulation (polls land at header + 3.5 s, 12 Hz; 1036562 frames, 112221628 tram-frames):
  backward frames (must be 0):        0
  visible crossings (must be 0):      23149
  hold-time share:                    1.1%  mean hold length: 1.8 s  (58863 holds)

overtakes (must be 0):   86
reversals (must be 0):   0
concessions / swaps:     309 / 170
direction known share:   100.0%
unknown-trip share:      0.0%
first moving plan (s):   p50 811  p95 1781  (never moved: 8)
per-tick wall time (ms): p50 39.73  p95 51.25

planner interventions:   floor 595235  junction_wait 101585  stand_fix 97639  eta_bound_skipped 274155
learned by the end:      4252 edge cells / 4755 stop cells / 1317 node cells; 53164 dwell samples, 7491 junction waits of 24559 passes, 78 platforms in the recent window
dwell candidates:        53164 kept, 9444 refused by the stationarity gate (4150 with ONE fix in the zone = ambiguous, 5294 with two or more that all moved = pass-through); ambiguous share of all candidates 6.6%

why the plan was ahead at 30 s (share of the fixes graded in each situation that had the plan >=50 m ahead):
  anchor age <10 s:           17.2%  (202990 of 1177630)
  anchor age 10-20 s:         20.2%  (34760 of 172404)
  anchor age 20-30 s:         26.6%  (10578 of 39798)
  anchor age >=30 s:          25.0%  (20183 of 80737)
  anchor standing:            16.7%  (96086 of 574127)
  anchor moving:              19.2%  (172425 of 896442)
  junction within 30 s:       17.4%  (9442 of 54295)
  no junction within 30 s:    18.3%  (259069 of 1416274)
```

| Mjera (cijeli dan) | prije kruga F (`cd7495c`, bez povratne veze) | poslije F11 | promjena |
|---|---|---|---|
| **slike unatrag (klijent)** | 41.223.762 od 112.221.628 | **0** | nestale |
| **preticanja (blizanac)** | 11.204 | **86** | −99,2 % |
| **fantomska stajališta** | 6.410 od 10.599 | **0** od 11.004 | nestala |
| **regresije među planovima** | 218.265 od 842.298 | **85.387** od 841.568 | −60,9 % |
| **vidljiva križanja (klijent)** | 38.228 | **23.149** | −39,4 % |
| **10 s: ispred / unutar / iza** | 23,7 / 54,2 / 22,1 % | **13,8** / 56,8 / 29,4 % | −9,9 p. b. ispred |
| **30 s: ispred / unutar / iza** | 28,2 / 38,8 / 33,0 % | **17,3** / 40,1 / 42,6 % | −10,9 p. b. ispred |
| **60 s: ispred / unutar / iza** | 29,1 / 29,5 / 41,4 % | **17,9** / 29,8 / 52,3 % | −11,2 p. b. ispred |
| **razred p95 na 10 s** | ≥200 m | **<200 m** | prvi pomak razreda p95 u krugu |
| razred p50 (10/30/60 s) | <50 / <100 / <200 m | isto | drži |
| prekršaji redoslijeda prema očitanjima | 9.356 od 5.022.158 | 6.974 od 4.495.247 | −25,5 % |
| udio držanja / prosjek / broj | 7,8 % / 4,9 s / 148.657 | **1,1 % / 1,8 s / 58.863** | −6,7 p. b. / −60,4 % |
| vožnje unatrag u planu | 0 | 0 | drži |
| ustupci / zamjene | 6.960 / — | 309 / 170 | −95,6 % ustupaka |
| poznati smjer / nepoznate vožnje | 100,0 % / 0,0 % | 100,0 % / 0,0 % | drži |
| prvi plan u pokretu p50 / p95 | 776 / 1.794 s | 811 / 1.781 s | +35 s p50 |
| otkucaj p50 / p95 | 123,03 / 304,87 ms | **39,73 / 51,25 ms** | −68 % / −83 % |

Četiri stvari treba pročitati pažljivo:

- **Razred p95 na 10 s prvi put pada ispod 200 m.** Kroz cijeli krug F razredi p95 stajali su na
  „≥200 m” na sva tri horizonta; na punom danu horizont jednog otkucaja sada završava ispod 200 m.
- **Podjela „zašto ispred” drži na punom danu za dva retka, a za treći se OKREĆE.** Sidro mlađe od
  10 s i dalje nosi tri četvrtine svih „ispred” (75,6 % na punom danu prema 74,9 % u prozoru), a
  sidro koje vozi dvije trećine (64,2 % prema 66,0 %) — ta dva zaključka su stabilna. Ali **križanje
  unutar 30 s** u prozoru je imalo višu stopu (21,1 % prema 17,3 %), a na punom danu ima **nižu**
  (17,4 % prema 18,3 %). Predznak se mijenja, dakle taj signal nije robustan: na punom danu planer
  knjiži 101.585 čekanja na križanjima i ondje gdje ih knjiži plan nije češće ispred — što je upravo
  ono što se želi ako čekanja rade. Zaključak „više mjesta na kojima se stajanje može predvidjeti”
  stoji na prva dva retka, koja su stabilna, a ne na trećem.
- **Pristranost preživjelih je na punom danu manja nego u prozoru** (6,6 % dvosmislenih kandidata
  prema 10,2 %): kroz cijeli dan ima više dugih zadržavanja na okretištima i u slaboj vožnji, koja
  ostavljaju više od jednog očitanja u zoni.
- **Prvi plan u pokretu je 35 s sporiji (776 → 811 s p50).** Vozilo koje blizanac prvi put vidi na
  peronu sada stoji dok ne dokaže da je krenulo. Pola minute čekanja na tramvaj koji doista stoji
  jeftinije je od oznake koja otiđe bez njega i onda se mora vratiti.

#### Ručna tablica zadržavanja (za vlasnika)

Datoteka je **`app/public/data/stop-dwell-overrides.json`**. Uredi je izravno, napravi commit i push
— između tvoje izmjene i onoga što blizanac pročita nema nijednog koraka gradnje: poslužitelj je
dohvaća s `/data/stop-dwell-overrides.json` istim putem kojim dohvaća `zet-trips.json` i
`zet-network.json`. (Druge dvije datoteke s „overrides” u imenu leže u `scripts/` jer su **ulaz** u
gradnju koja prepisuje artefakt; ova se ne prepisuje ničim, pa bi korak kopiranja iz `scripts/` samo
dodao način da tvoja izmjena tiho ne stigne u proizvodnju.)

Jedan redak izgleda ovako:

```json
{ "stop": "Črnomerec", "route": "6", "defaultSec": 90, "pin": true, "reason": "okretište, vozač mijenja smjer" }
```

- `stop` je **id perona iz GTFS-a** (`98_1`) ili **ime stajališta** (`Črnomerec`). Ime pogađa sve
  perone tog imena **koje vozi neki tramvaj** — nikad autobusno ugibalište istog imena. To nije
  sitnica: „Črnomerec” je tri tramvajska perona i jedanaest autobusnih, a ovu tablicu čita i procjena
  brzine, pa bi okretnički broj naplaćen autobusnom ugibalištu gurnuo **autobusov** plan ispred
  njega. Id perona pogađa točno taj peron, kakav god bio: id nije pogađanje. Sjeme od dvadeset imena
  tako pogađa 61 tramvajski peron i nijedno autobusno ugibalište.
- `route` je neobavezan i sužava redak na perone koje ta linija stvarno vozi.
- `defaultSec` su sekunde. Redak s id-om perona jači je od retka s imenom, a redak s linijom od retka
  bez nje; među jednakima vrijedi tvoj zadnji redak.
- Bez `"pin": true` broj je samo **polazna** vrijednost: izmjereno zadržavanje (zadnjih 30 uzoraka u
  90 minuta, pa naučena razdioba po satu i vrsti dana) i dalje ima prednost. S `"pin": true` broj je
  ono što planer knjiži, a mjerenja se vide samo na `/stats`.
- `reason` je obavezan — da za pola godine piše zašto je broj tu.
- Neispravan redak **ruši učitavanje datoteke i ispisuje se cijeli** u zapisnik; blizanac tada vozi
  bez ijednog ručnog unosa, a ne s polovicom njih. To se od popravka I3 **vidi na `/stats`**:
  podebljano uz tablicu zadržavanja piše „Datoteka stop-dwell-overrides.json nije pročitana: …”
  s porukom samog čitača, a brojač `twin_tick` / `overrides_unreadable` kaže od kada traje.
  Datoteka koje uopće nema nije greška nego prazna tablica i ne piše ništa. Unos koji ne pogađa
  nijedan peron učitane mreže (preimenovano stajalište, tipfeler) ne ruši ništa nego se
  **imenuje na `/stats`**.

Sjeme u datoteci su dvadeset okretišta tramvajskih uzoraka iz `zet-trips.json`, sva na 60 s s
razlogom „terminus layover placeholder — owner to adjust”: popis za uređivanje, ne prazna datoteka.
Sve što tablica zna — polazna vrijednost, ručni unos, naučeni p50 i p90 (stupac nosi ime iz same konstante DWELL_PLAN_QUANTILE, pa ne može lagati kad se ona pomakne), broj uzoraka, koliko ih je u
zadnjih 90 minuta i kada je zadnji, te sekunde koje planer stvarno knjiži — vidi se na `/stats` pod
naslovom **Zadržavanje po stajalištu**, a čekanja na križanjima pod **Čekanje na križanjima**.

### Kapija kruga F na spojenoj grani `round-f` (19. rujna 2026.)

Krug je vožen u dvije usporedne grane iz iste baze (`7919846`): **R** (`round-f-render`, iscrtavanje --
oznake, skupine, shema, fokus linije, e2e) i **M** (`round-f-motion`, motor -- posluženi popis stajališta,
graf, klijent koji ne crta unatrag, registar redoslijeda, tablica zadržavanja). Obje su usput spojile
`origin/main` (`b43f343`, novi gradski izvori). Spajanje: R je gotova na `b606d96`, M na `8a284a8`;
integracijska grana `round-f` je `b606d96` + M (`8e3d049`), pa ponovno izgrađeni artefakt sheme
(`8ecef34`, mijenja se samo `builtAt`), pa val popravaka završnog pregleda motora (`e59f85c`).
Ništa nije gurnuto ni spojeno u `main`: objava je `git push` u `main` i traži vlasnikovu odluku.

| Kapija | Naredba | Glava | Rezultat |
|---|---|---|---|
| TypeScript | `npm run typecheck` | `e59f85c` | čisto, oba projekta (`worker`, `app`) |
| Jedinični i radni testovi | `npm test` | `e59f85c` | **204 datoteke / 2.693 testa, sve zeleno.** Poznata krhkost pod opterećenjem: `test/twin/learn.workers.test.ts` zna isteći na 5 s dok isti stroj vrti preglednik -- sam prolazi. |
| Gradnja | `npm run build` | `152e612` (integracija; isti kod kao `e59f85c`, povrh su samo dokumenti) | čisto; upozorenje o veličini komada je zatečeno (`gate-integration-visual-152e612.txt`). |
| Shema | `node scripts/zet-schema.mjs --check` | `e59f85c` | prolazi: 57.639 B sirovo, 10.582 B gzip, feed 000395; **146 od 152 staze** se smješta na nacrt sa strogo monotonim dionicama, šest izuzetih imenovano. |
| Izvori | `npm run check:izvori` | `e59f85c` | svih 36 poveznica odgovara; svi moduli dokumentirani |
| Preglednik | `npx playwright test` (chromium + mobile) | `8ecef34`; podskup `motion`/`round-f`/`schema` ponovljen na `e59f85c` | **101 prolaz / 14 padova**, svih 14 okolišnih ili zajedničkih s `main` -- razvrstano niže. Podskup na `e59f85c`: 12 prolaza / 2 pada (`motion.spec.ts:174` i `:250`, oba iz razreda pločica). |
| Pristupačnost | `npm run e2e:a11y` | `8ecef34`; tekstualna staza (`a11y.spec.ts:225`, `:246`) ponovljena na `e59f85c` i `152e612` | **18 od 20**; padaju ista dva slučaja iz `a11y.spec.ts`. U ponavljanjima `:246` pada u sva tri pokretanja, a `:225` prolazi 2 od 3 -- krhkost iz razvrstavanja niže. |
| Vizualna matrica | `npm run review:visual` | `b606d96` (grana R) i `152e612` (integracija) | **93 površine, 0 nalaza** na objema. Skripta ne diže vlastiti poslužitelj: prvi pokušaj u integracijskom stablu pao je s `ERR_CONNECTION_REFUSED` bez ijedne snimke i ponovljen je uz ručno podignut `wrangler dev` na 8787. |
| Ponavljanje snimljenog dana | `node scripts/replay-twin.mjs recordings/2026/09/17` | `e59f85c` (svih 7.972 okvira 17. rujna) | slike unatrag **0**, fantomska stajališta **0**, vidljiva križanja 12.244, prekršaji redoslijeda 1.218; cijela tablica u sljedećem odjeljku |

**Razvrstavanje padova u pregledniku.** Ovaj stroj nema lokalnu R2 kopiju arhive pločica, pa svaka
karta vrati `data-map-status="tiles-failed"`; sve što čeka na iscrtane slike karte tu istekne. Isti je
skup izmjeren i na čistom `origin/main` (`b43f343`) u zasebnom radnom stablu, pa je razvrstavanje
mjereno, a ne pretpostavljeno.

| Slučaj | Razred |
|---|---|
| `e2e/motion.spec.ts:174`, `e2e/motion.spec.ts:250` | pločice: karta ne dobije nijednu sliku |
| `e2e/kiosk-recovery.spec.ts:4` | pločice |
| `e2e/map-transfer.spec.ts:5` (390 px i 1440 px) | pločice: proračun prijenosa mjeri se nad kartom koje nema |
| `e2e/experience.spec.ts:117` (390 px i 1440 px) | pločice |
| `e2e/mobile.spec.ts:312`, `e2e/mobile.spec.ts:372` | pločice |
| `e2e/a11y-session.spec.ts:140` (svijetla i tamna tema) | pločice |
| `e2e/a11y.spec.ts:246` (`/d/` u sesiji) | pločice |
| `e2e/a11y.spec.ts:225` (`/kiosk/` ploča linija) | **krhko jednako na grani i na čistom `main`** (pada 3 od 8 pokretanja na objema). Uzrok je isti izostanak pločica: kad svaka pločica vrati 503, MapLibre-ov stil prelazi u `errored`/`loading` i događaj `load` se može propustiti, pa `styled` nikad ne postane istinit i spremnik ostane `unavailable`. To je ujedno latentni proizvodni nalaz (redak u „Otvorene točke”). |
| `e2e/experience.spec.ts:191` (pretraga prijevoza bez WebGL-a) | **crven na samom `main`**: 3 od 3 pada na čistom `b43f343`. Uzvodna zadana skupina `cityGroup = 'living'` nikad ne iscrta listu pretrage prijevoza. Nije regresija ovog kruga. |

Nijedan slučaj ne pada na grani, a prolazi uzvodno; to je bio uvjet za kapiju i zadovoljen je
zasebnim usporednim prolazom (zadatak R-fix2).

#### Cijeli snimljeni dan, prije i poslije kruga F

Polazna tablica je `replay-fullday-baseline-cd7495c.txt`: motor **prije kruga F** (`cd7495c`, artefakt
v2), svih **7.972 okvira** 17. rujna 2026., 473 vozila. Sljedeća dva stupca su ista datoteka okvira
kroz integrirano stablo: prije vala popravaka završnog pregleda (`8e3d049`) i poslije njega
(`e59f85c`, ono što se objavljuje). **Čitaju se veličina i smjer, ne pripisivanje**: između prvog i
zadnjeg stupca stoji cijeli krug (posluženi popis stajališta, čvorovi na križanjima, klijent koji ne
crta unatrag, registar redoslijeda, planer i tablica zadržavanja) i, kod dijela mjera, drukčiji
harness -- polazna tablica je vožena **bez povratne veze učenja**. Kontrolirana razlika koja mjeri
jedan zahvat je uvijek tablica prozora u odjeljku tog zadatka.

| Mjera (cijeli dan) | prije kruga F (`cd7495c`) | integrirano, prije vala popravaka (`8e3d049`) | **isporučeno (`e59f85c`)** | ukupna promjena |
|---|---|---|---|---|
| **slike unatrag (klijent)** | 41.223.762 od 112.221.628 | 0 | **0** | nestale |
| **vidljiva križanja (klijent)** | 38.228 | 23.149 | **12.244** | **−68,0 %** |
| **fantomska stajališta** | 6.410 od 10.599 | 0 od 11.004 | **0** od 11.004 | nestala |
| **prekršaji redoslijeda prema očitanjima** | 9.356 od 5.022.158 | 6.974 od 4.495.247 | **1.218** od 4.498.137 | **−87,0 %** |
| **regresije među planovima** | 218.265 od 842.298 | 85.387 od 841.568 | **83.443** od 841.568 | −61,8 % |
| 10 s: ispred / unutar / iza | 23,7 / 54,2 / 22,1 % | 13,8 / 56,8 / 29,4 % | **13,7** / 56,9 / 29,4 % | −10,0 p. b. ispred |
| 30 s: ispred / unutar / iza | 28,2 / 38,8 / 33,0 % | 17,3 / 40,1 / 42,6 % | **17,2** / 40,2 / 42,6 % | −11,0 p. b. ispred |
| 60 s: ispred / unutar / iza | 29,1 / 29,5 / 41,4 % | 17,9 / 29,8 / 52,3 % | **17,8** / 29,8 / 52,4 % | −11,3 p. b. ispred |
| razred p95 na 10 s | ≥200 m | <200 m | **<200 m** | prvi pomak razreda p95 |
| razred p50 (10 / 30 / 60 s) | <50 / <100 / <200 m | isto | isto | drži |
| udio držanja / prosjek / broj | 7,8 % / 4,9 s / 148.657 | 1,1 % / 1,8 s / 58.863 | **1,1 % / 1,8 s / 56.576** | −6,7 p. b. |
| preticanja (blizanac) | 11.204 | 86 | **8** | −99,9 %, ali **definicija se promijenila u F10** |
| vožnje unatrag u planu | 0 | 0 | **0** | drži |
| ustupci / zamjene | 6.960 / — | 309 / 170 | **269 / 143** | −96,1 % ustupaka |
| poznati smjer / nepoznate vožnje | 100,0 % / 0,0 % | 100,0 % / 0,0 % | **100,0 % / 0,0 %** | drži |
| prvi plan u pokretu p50 / p95 | 776 / 1.794 s | 811 / 1.781 s | **811 / 1.781 s** | +35 s p50 |
| otkucaj p50 / p95 | 123,03 / 304,87 ms | 41,94 / 60,73 ms | **39,35 / 49,51 ms** | −68 % / −84 % |

Sažetak se vodi **slikama unatrag (0)** i **vidljivim križanjima (−68 %)**, ne preticanjima: preticanje
je u F10 redefinirano (registar broji obrat priznatog odnosa, stari parni zakon brojao je svako
proturječje dvaju planova), pa −99,9 % uspoređuje dvije različite stvari.

**Što je val popravaka završnog pregleda donio na punom danu** (`8e3d049` → `e59f85c`, treći prema
četvrtom stupcu). Jedan zahvat nosi gotovo sve: popravak I2, ZET-ov svjedok koji proturječi
očitanjima više ne uspostavlja odnos. Vidljiva križanja 23.149 → **12.244** (−47,1 %), prekršaji
redoslijeda 6.974 → **1.218** (−82,5 %), preticanja 86 → **8**, ustupci/zamjene 309/170 → 269/143,
regresije −2,3 %, otkucaj p95 60,73 → 49,51 ms; udio „ispred” se ne miče (17,3 → 17,2 % na 30 s), što
je i očekivano -- I2 dira red, ne plan. Isti je zahvat na kontroliranom prozoru od 2.216 okvira
(`task-M-final-fix-report.md`) dao prekršaje 1.884 → 313 (−83,4 %) i križanja 5.895 → 3.175 (−46,1 %):
prozor i puni dan slažu se u predznaku i veličini.

**Dva praga plana nisu postignuta i to se ne zaokružuje:**

- **„Ispred” na 30 s: 17,2 % na cijelom danu prema traženih ≤ 10 %.** Na kontroliranom prozoru
  (stari motor *s* povratnom vezom učenja protiv novoga, dakle pošteno usporedivo) iznosi 15,8 %
  (15,9 % prije vala popravaka). Zadatak F11 je prošao cijeli raspon triju konstanti (0,65 → 0,90)
  i cijeli taj raspon vrijedi 2,0 postotna boda: prag se ovim konstantama ne može doseći. Ostatak je
  pripisan mjerenjem: **76 % svih „ispred” ima sidro mlađe od 10 s, a 64 % sidro u pokretu**
  (66 % u kontroliranom prozoru) -- tramvaj koji vozi na svježem očitanju i zatim **stane**. To je meta
  idućeg kruga: predvidjeti stajanje, a ne stajanje opisati nakon što je počelo. Udio uz križanje nije
  robustan (predznak se između prozora i punog dana okreće: 21,1 % prema 17,3 % u prozoru, 17,2 %
  prema 18,2 % na punom danu) i ne nosi zaključak.
- **Vidljiva križanja: 12.244 na dan prema pragu od 0.** Prihvaćeno za ovaj krug kao izmjereno.
  Registar po konstrukciji **odbija urediti par čija su očitanja unutar 60 m** (`ORDER_ESTABLISH_M`):
  dva rasipanja GPS-a ne mogu reći tko je prvi, a izmišljeni red je gori od nikakvog. Preostala
  križanja su uglavnom taj pojas i ostaju meta idućeg kruga, uz semantiku guranja (I4).

**Zahvati planera i naučeno na kraju dana** (`e59f85c`, za usporedbu s `/stats` nakon objave):
objavljeni pod 600.269, čekanja na križanjima 101.585, popravci stanja 97.633, odbijenih ZET-ovih
vremena 274.168; naučeno 4.252 ćelije bridova, 4.755 stajališta i 1.317 čvorova, 53.164 uzorka
zadržavanja, 7.491 čekanje na križanju od 24.559 prolazaka, 78 perona u prozoru od 90 minuta.
Provjera mirovanja odbila je 9.444 kandidata (4.150 dvosmislenih s jednim očitanjem u zoni,
5.294 dokazana prolaska), dakle 6,6 % dvosmislenih od svih kandidata -- manje nego u prozoru
(10,2 %), jer cijeli dan nosi više dugih zadržavanja na okretištima.

#### Pogledom, poslije objave (vlasnik)

Popis je spojen iz oba završna pregleda. Ništa od ovoga stroj ne može potvrditi umjesto vlasnika.

1. **Ilica, Črnomerec do Trga, deset minuta, na obje karte.** Svaki tramvaj nosi svoj broj ili sjedi u
   skupini koja taj broj ispisuje; nijedan ne ide unatrag; nijedan par se ne križa na jednom
   kolosijeku; tramvaj koji čeka na semaforu ima oznaku koja čeka, a ne prolazi kroz križanje.
2. **Okretišta i ručna tablica.** Stoje li oznake na okretištima onoliko koliko doista stoje? Ako ne,
   upiši broj u `app/public/data/stop-dwell-overrides.json` (sjeme je dvadeset okretišta na 60 s) i
   provjeri da se promjena vidi nakon objave, bez ijednog koraka gradnje.
3. **Zbijeni parovi na Jelačiću i u Draškovićevoj.** Ondje tramvaji stoje nos uz rep: ostaju li u
   redoslijedu i drže li razmak, ili se dvije oznake preklope i zamijene mjesta?
4. **Linija 13 na Šubićevoj × Zvonimirovoj i linije 6/9 od Botaničkog vrta do Zrinjevca.** Prvo je
   križanje na kojem je krug dodao čvor: vozi li 13 ravno kroz njega? Drugo je imenovana iznimka gradnje
   (dva kolosijeka koja se nikad ne sijeku): tramvaji 6 i 9 ondje idu dužim putem nego u stvarnosti
   i to je poznato, ali treba vidjeti koliko je ružno.
5. **Parovi unutar 60 m.** Registar ih namjerno ne uređuje. Koliko se često vidi da dvije oznake
   u toj blizini zamijene mjesta, i smeta li to?
6. **Okretanja.** Tramvaj koji se okrene na okretištu dok ZET još piše staru vožnju: prelazi li
   oznaka glatko na povratni kolosijek ili skoči?
7. **`/stats` nakon sat vremena rada.** `twin_order` (uspostave, padovi, zadržavanja, guranja, ustupci,
   zamjene), `twin_plan` (pod, čekanja na križanjima, popravci stanja, odbijena ZET-ova vremena),
   ocjena unatrag po predznaku, tablica **Zadržavanje po stajalištu** i **Čekanje na križanjima**;
   te da nigdje ne piše da ručna tablica nije pročitana.
8. **Javni zaslon i smanjeno kretanje.** Na zaslonu: oznake se ne ispuštaju, skupine se spajaju na
   pravoj udaljenosti, nazivi na shemi ne leže jedan preko drugoga, vlastito stajalište je uvijek
   imenovano. Uz `prefers-reduced-motion`: petlja crta jednom u sekundi i oznaka i dalje ne skače.
9. **Linija 14, fokus uključen i isključen.** Odaberi 14: vidi se samo ona, u svojoj ZET-ovoj boji,
   a svako drugo vozilo i dalje nosi broj. Isključi prekidač -- vraća se cijela mreža. Osvježi
   stranicu: izbor se pamti po uređaju.
10. **Dijagram.** Nazivi vodoravno preko linija s oznakama preko njih; okretišta verzalom ispod
    koluta, s čipovima linija; dodir na skupinu otvara njezine članove.
11. **Tamna tema** na svemu gore: tinte oznaka, čipovi okretišta i prigušene linije pod fokusom.
12. **Nos smjera i kolosijeci po zumu.** Nos postoji samo između zuma 14,5 i 16,5: na 15,5 ga svaki
    tramvaj ima, na 17 ga nema i svaki tramvaj sjedi na svom kolosijeku (dva su tada razmaknuta
    bar 4 px). Nos koji ostaje na 17 ili nedostaje na 15,5 znači da je pojas krivo postavljen.

#### Otvorene točke

Odluke i nalazi koje krug ostavlja vlasniku; nijedna nije prepreka objavi, sve su zabilježene u
`.superpowers/sdd/we-need-to-work-wondrous-beaver/progress.md`.

*Odstupanja od teksta plana (vizualna, traže „da” ili „ne”):*

1. **Prekidač ima jedan stalan naziv** („Samo ova linija na karti”) uz `aria-checked`, a ne dva naziva
   koja se izmjenjuju. Čitač zaslona tako ne mijenja ime kontrole pod prstom; plan je tražio dva.
2. **Nazivi okretišta stoje ispod koluta**, ne preko njega: kolut je u krugu F narastao i sjedio bi na
   svom nazivu. Čipovi linija idu pod naziv.
3. **Javni zaslon vozi sudarni prolaz naziva**, sa svojim stajalištem prvim u rangu -- plan je tražio
   „svi nazivi”. Snimka kioska bez prolaza pokazala je nazive jedne preko drugih.

4. **Tramvaji iste linije slažu se jedan preko drugoga na dijagramu kad je jedan odabran.** Odabrano
   vozilo se po planu nikad ne upija u skupinu, pa tramvaj iste linije na istom mjestu sjedi pod
   njim umjesto u skupini s njim. Nalaz završnog pregleda grane R, ostavljen kao manji.

*Zatečeno uzvodno, ne od ovog kruga:*

5. **Radni prostor prijevoza otvara se na gradskoj skupini „Živi grad”**, pa su karta prometa i fokus
   linije jedan klik dublje (iza „Kretanje”). Odluka o zadanoj skupini je vlasnička.
6. **Nazivi na shemi se režu na rubu kadra javnog zaslona** („PADNI / ODVOR”): čitljivost javnog
   zaslona za idući krug.
7. **Karta bez pločica ostaje neiscrtana umjesto da se degradira.** Kad je usluga pločica trajno
   nedostupna, MapLibre-ov stil može propustiti `load`, pa slojevi nikad ne stignu na kartu i spremnik
   ostane `unavailable` -- na grani i na `main` jednako. Latentno u proizvodnji.
8. **`e2e/experience.spec.ts:191` je crven na samom `main`** (pretraga prijevoza bez WebGL-a, 3 od 3).
   Posljedica zadane skupine iz točke 5.
9. **Ponovno prilagođavanje lista na telefonu spušta dijagram pod prag naziva**: kad se donji list
   ponovno prilagodi, shema izgubi zum i nazivi se sakriju dok korisnik sam ne zumira. Zatečeno
   prije kruga F (zabilježeno pri F6), ostavljeno vlasniku.

*Motor, prvi zadaci idućeg kruga:*

10. **Semantika guranja (I4).** Guranje vuče vođu po **sljedbenikovu planu**, ne po njegovu očitanju.
   Promjena semantike traži vlastito ponavljanje snimljenog dana, pa je odvojena.
11. **Redak stanja 1,42 MB u vršcu prema ogradi Durable Objecta od 2 MB.** Dodan je zapis
   `stateBytes`/`vehicles` na minutnom ispiranju da se to promatra; smanjivanje prstena objavljenih
   planova je zaseban zadatak.
12. **Pojas od 35 do 60 m ostaje neuređen.** Očitanje ne može reći tko je prvi unutar dvaju rasipanja
    GPS-a; to je izvor najvećeg dijela preostalih vidljivih križanja.
13. **Na obnovljenom otkucaju `advance()` se vrti dvaput** (ponovno planiranje pri obnovi i sam okvir),
    a izvještaj otkucaja nosi samo drugi prolaz -- pa izvještaj podbroji zadržavanje koje je mjerilo
    ispravno izbrojilo. Nalaz opažanja, ne kvarenja podataka.

### Kapija paketa WP0: vlastite tračnice, tišina vozila, puni natpis skupine (22. rujna 2026.)

Paket WP0 mijenja tri stvari koje se vide na karti: tramvaj vozi samo po stazama svoje linije, a
izvan njih crta se na očitanim položajima; vozilo koje u ZET-ovu feedu šuti dulje od 30 s stoji na
idućem stajalištu, blijedi i nakon 180 s nestaje s karte; spojena oznaka ispisuje svaku liniju.
Mjeri se ocjenjivačem staza nad dva snimljena dana, 20. i 21. rujna 2026. (8.296 i 5.738 okvira).
Ocjenjivač je `scripts/grade-branches.mjs` (jezgra `scripts/grade-branches-core.ts`). Jedan dan:
`npm run replay:grade -- <direktorij-okvira> --out branches-<dan> --targets stage1`; svaki redak
čita jedan ključ iz `branches-<dan>.json`, a uz `--targets` naredba završava izlaznim kodom 1 čim
ijedan redak ne dosegne prag. Polazište je motor prije WP0 (`b300af3`). Stupci D1 izmjereni su 23.
rujna 2026.: nedjelja na isporuci D1 (oznaka `D1`, `f0357bf`), ponedjeljak na kandidatu neposredno
prije isporuke D1 (`0116d1a`). Isporuka D1 tom kandidatu dodaje tri popravka za sigurnu isporuku, a
u nedjeljnoj snimci nijedan redak tablice nema drukčiju vrijednost nego na `0116d1a`. Oba dana ocijenio je
referentni ocjenjivač iz lokalnog stabla pregleda (izvan repozitorija); `scripts/grade-branches.mjs`
prijenos je tog ocjenjivača, a na uzorku od 162 okvira izvještaji obaju ocjenjivača imaju iste
vrijednosti u svakom zajedničkom ključu. Motor kretanja i artefakti mreže isti su na isporuci D1 i
na kandidatu D2.

| Redak | Mjera | Ključ u `branches-<dan>.json` | ned 20. 9. prije WP0 | pon 21. 9. prije WP0 | ned 20. 9. D1 | pon 21. 9. D1 | Prag |
|---|---|---|---|---|---|---|---|
| A | promjene staze unutar iste vožnje na 100 vozilo-sati tramvaja, bez okretanja do 150 m od okretišta, bez ulaska u okretišnu petlju i izlaska iz nje i bez skokova preusmjerenog tramvaja između tračnica vlastite linije (`diversion-hop`, drugi krug 24. rujna 2026.) | `(totals.pathChangesSameTrip - flips.atTerminus - loops.events - diversions.events) / tramVehicleHours * 100` | 165,6 | 136,5 | 21,44 | 12,25 | ≤ 5 |
| A′ | isto u kvadratu središta, 17:15 do 17:44 | `teaserBox.window.per100vh` | 220 | 131 | 41,7 (7 događaja) | 18,7 (6 događaja) | ≤ 5 |
| B | preuzimanja staze druge linije | `otherRoute.onto` | 441 | 483 | 0 | 0 | 0 |
| C | vozilo-sati na tuđoj stazi; svježa očitanja na tuđoj stazi dok je vlastita unutar 60 m | `otherRoute.ticks.foreignVehicleHours`, `otherRoute.ticks.foreignFreshFixesWithPriorWithin60m` | 85,4; 13.707 | 116,4; 19.700 | 0; 0 | 0; 0 | 0; 0 |
| D | ponovna izvođenja u kojima je vlastita staza vozila taj brid, a odabrana je druga inačica | `rederive.priorInPoolButOtherAdopted` | 469 | 620 | 0 | 0 | 0 |
| E | promjene smjera dalje od 300 m od okretišta | `flips.terminalDistanceHist.le600 + gt600` | 179 | 196 | 4 | 7 | 0 |
| F | vožnje unatrag po luku od 500 m i više | `backward.runsOver500m` | 275 | 191 | 0 | 0 | 0 |
| G | ponovna postavljanja oznake na klijentu za više od 50 m unutar iste vožnje; p95 pomaka | `client.sameTripPathToPathOver50`, `client.sameTripPathToPathJumpP95` | 1.990; 683 m | 1.922; 629 m | 1.203; 254 m | 1.232; 226 m | 0; < 50 m |
| H | vidljiva korekcija pri ponovnom izvođenju, p95 | `rederive.planGapM.p95` | 324 m | 387 m | 250 m | 226 m | < 60 m |
| U | tramvaj bez staze, a ne izvan grafa (slobodna ravnina na tračnicama), udio vozilo-sati; ne broji se razdoblje od deset minuta i dulje u kojem se tramvaj ne udalji više od 100 m od mjesta gdje je ostao bez staze (stoji u spremištu ili na okretištu), a sirovi udio i sati stajanja ispisuju se uz redak | `unplaced.shareOfTramVehicleHours` (sirovi udio `unplaced.shareOfTramVehicleHoursRaw`, stajanje `unplaced.parkedVehicleHours`) | 0,000359 | 0,000538 | 0,0289 (sirovo 0,0364; stajanje 11,8 vozilo-sati) | 0,0226 (sirovo 0,0300; stajanje 16,4 vozilo-sati) | ≤ 0,03 |
| S1 | objavljena vozila čije je zadnje očitanje starije od `EVICT_S` | `silence.publishedOlderThanEvict` | 0 uz 300 s | 0 uz 300 s | 0 uz 180 s | 0 uz 180 s | 0 uz 180 s |
| S2 | tramvaji tihi dulje od 30 s čiji objavljeni plan 60 s unaprijed prelazi iduće posluženo stajalište | `silence.extrapolatedPastNextStop` | 26.764 | 30.645 | 0 | 0 | 0 |
| S | tramvaj koji šuti dulje od 60 s: najveći pomak objavljenog položaja preko mjesta zadržavanja na idućem posluženom stajalištu; uz redak se bez praga ispisuje put prijeđen tijekom tišine do mjesta zadržavanja | `ghostAdvance.beyondHoldM.max` (put do mjesta zadržavanja `ghostAdvance.glideM.max`) | nije mjereno | nije mjereno na cijelom danu; uzorak od 17:15 do 17:44: 989,7 m | nije mjereno | nije mjereno na cijelom danu; uzorak od 17:15 do 17:44: 0 m | ≤ 50 m |
| I | preuzimanja staze druge linije ili druge inačice iste linije, a stazom ne vozi nijedna usluga viđena u snimci toga dana | `serviceFilter.adoptionsWithoutService` | nije mjereno | nije mjereno na cijelom danu; uzorak od 17:15 do 17:44: 15 | nije mjereno | nije mjereno na cijelom danu; uzorak od 17:15 do 17:44: 0 | 0 |

Uz ocjenjivač vrijede retci kapije kruga F na 20. rujna (`node scripts/replay-twin.mjs
<direktorij-okvira>`): slike unatrag 0, obrati 0, preticanja 0 (polazište 5), vidljiva križanja
najviše 2.478 (pola polaznih 4.956; stalni cilj ostaje 0) i otkucaj p50 ispod 60 ms; na isporuci
D1 redom 0, 0, 0, 1.552 i 26,79 ms. Rezultati vrijede samo ako se snimljene vožnje razrješuju
prema isporučenom indeksu vožnji: nepoznatih vožnji (`servicesSeen['?'] / tramTrips`) smije biti
najviše 1 % na svakom danu, a na D1 ih je 0,049 % i 0,145 %. Uzorak od 162 okvira
(`npm run accept -- test/accept/wrong-turn.test.ts`) ima vlastiti preduvjet: `unknownTripShare`,
udio tramvajskih otkucaja s oznakom vožnje izvan isporučenog indeksa, ispod 0,02 (na D1 0,0007). Retci tog uzorka i vrijednosti na isporukama nalaze se u odjeljku „Prihvaćanje, companion
2026-09”.

`EVICT_S` je 180 s, a ne 120 s: u ponedjeljak 21. rujna 3.505 tišina iste vožnje trajalo je od 120
do 180 s, u 91 % njih vozilo se pomaknulo najviše 50 m, a 90 % ih je bilo unutar 150 m od
okretišta. Prag od 120 s dnevno bi oko 3.200 puta skinuo s karte tramvaj koji mirno stoji na
okretištu.

## Javni zaslon Prozor (16. 9. 2026.)

Plan `C:/Users/MatijaRadeljak/.claude/plans/observe-the-layout-and-valiant-fiddle.md`, grana i
radna stabla `kiosk-prozor` / `kp-P1`…`kp-P4`, odluke i tumačenja u
`.superpowers/sdd/2026-09-16-kiosk-prozor/rulings.md` (R-KP1 do R-KP23). Val A gradi u
četiri usporedna radna stabla; ovaj odjeljak opisuje protokol provjere koji vlasnik čita nakon
spajanja (val B) -- brojke i snimke iz vala A same po sebi nisu dovoljne jer ni jedno radno
stablo samo ne vidi cijeli sastavljen zaslon. Rezultati ispod izmjereni su u valu B (16. 9. 2026.,
grana `kiosk-prozor`, izvještaj `task-WB-report.md`); retci označeni „proizvodnja” popunjavaju se
nakon spajanja na `main`.

### Matrica snimanja

`review.local/kiosk-pass/capture.mjs <naziv>` (git-ignorirana lokalna alatka, pokreće se protiv
`APP_URL`) snima nepovezani zaslon po veličini iz plana, svjetlo i tamno, jednom po veličini
(nema više prizora kroz koje bi trebalo prolaziti -- polje je jedno). Zaslon se postavlja sa
stajalištem `106_1` (zadano stajalište čarobnjaka; zaslon bez stajališta nema ni prometnu izjavu
ni prsten stajališta, a takav zaslon ni jedan kafić ne dobiva), a lice se nameće adresom
`?tema=svijetla|tamna` jer se javni zaslon otvara na sunčevoj temi i Playwrightov `colorScheme`
sam ga ne preokreće:

| Veličina | Zašto |
|---|---|
| 1920 × 1080 | nacrtana veličina |
| 1366 × 768 | kompaktni nacrt |
| 1080 × 1920 | portretni totem |
| 2560 × 1440 | iznad Full HD: više grada, ne veća rupa |
| 3840 × 2160 | 4K: znak mora prestati rasti |
| 2560 × 1080 | ultra široki: zoom ostaje 1, višak ide polju |
| 1920 × 1200 | viši od nacrta: višak ide polju |
| 390 × 844 | telefon, koji je nekad dobivao raspored javnog zaslona |

Za nacrtanu veličinu (1920 × 1080) alatka dodatno snima par „3m” (ista slika pri
`deviceScaleFactor 0.25`, svjetlo i tamno) i, na istoj stranici bez ponovnog učitavanja, jedan
snimak nakon 20 sati po zagrebačkom vremenu (sat je pomaknut unaprijed, `page.clock`, da zadnji
polazak stigne na zaslon bez nove navigacije). `geometry.json` po veličini bilježi: udio polja
(`[data-testid=kiosk-live]`) u pozornici, prostor stupca i visinu kartice, koliko je izjava
ranker ponudio i koliko ih stoji cijelih (`fit()` skriva ostale od dna), retke svake prikazane
vrijednosti (visina kutije kroz visinu retka -- nikad `scrollHeight`, koji broji i tintu lica
preko retka od 1,1 pa laže o prelijevanju), prelazi li ijedna vrijednost dva retka ili dno svoje
izjave, `data-major-labels` domaćina karte i okvir atribucijske kontrole.

**Rezultat (val B, 16. 9. 2026., `review.local/kiosk-pass/prozor/`, 17:42 po zagrebačkom
vremenu i ponovno 19:10 nakon popravka 1 -- iste brojke osim imena ulica na totemu -- stajalište
Trg bana J. Jelačića):** snimke `<veličina>-light.png`, `<veličina>-dark.png`
i `<veličina>-after-20.png` za svih osam veličina, `3m-light.png`, `3m-dark.png`, `geometry.json`.
Stupac imena ulica čita `data-major-labels` u trenutku snimke, tj. u pravilu slaganje profila prije
pločica vozila (najveću brojku); kadar nakon 20 h čita 2 / 2 / 0 / 5 / 10 / 4 / 2 / 0 istim redom.

| Veličina | polje | prostor stupca | kartica | izjave (cijele / ponuđene) | retci vrijednosti | imena ulica |
|---|---|---|---|---|---|---|
| 1920 × 1080 | 72,9 % | 473 px | 365 px | 2 / 3 (promet, zatvoreno) | 2, 1 | 7 |
| 1366 × 768 | 67,8 % | 248 px | 341 px | 2 / 2 | 1, 1 | 4 |
| 1080 × 1920 | 76,9 % | 382 px | 382 px | 3 / 3 | 1, 1, 1 | 3 (7 prije popravka 1) |
| 2560 × 1440 | 72,9 % | 631 px | 486 px | 2 / 3 | 2, 1 | 9 |
| 3840 × 2160 | 81,7 % | 1149 px | 527 px | 2 / 3 | 2, 1 | 15 |
| 2560 × 1080 | 79,7 % | 473 px | 365 px | 2 / 3 | 2, 1 | 9 |
| 1920 × 1200 | 72,9 % | 593 px | 365 px | 3 / 3 | 2, 1, 2 | 7 |
| 390 × 844 | 19,8 % (traka) | u tijeku | 401 px | 4 / 4 (nakon 20 h 5 / 5) | 1, 1, 2, 2 | 0 |

Nijedna vrijednost ne prelazi dva retka ni dno svoje izjave; nijedan stupac se ne prelijeva. Živa
prometna vrijednost u trenutku snimanja bila je dvoredna („13 rani 4 min · 6 rani 3 min”, prijelom
samo na razdjelniku), pa 1920 × 1080 drži dvije izjave (R-KP22, donja granica); kadar nakon 20 h
nudi zadnji polazak kao treću, koju na zaslonu 1080p ta dvoredna vrijednost skriva, dok je
1920 × 1200 i telefon pokazuju. Zamrznuti sat (`page.clock`) ostavlja vozila bez svježih
očitanja, pa ih kadar nakon 20 h ne crta -- artefakt alata, ne zaslona. Iznad nacrtanih veličina
imena ulica prelaze osam (9 na 2560, 15 na 4K): razmak imena (R-KP17) izmjeren je na nacrtanom
polju, a veće polje nosi više imena.

### Provjera na 3 metre

Od rujna 2026. pravilo za tri metra je tablica „Tri metra” u odjeljku „Prihvaćanje, companion
2026-09”; ovaj podnaslov ostaje zapis vala B od 16. rujna.

`deviceScaleFactor 0.25` snimka 1920 × 1080 kadra oponaša 1080p ploču gledanu s četverostruke
referentne udaljenosti -- jedina poštena provjera da znak čita se s tri metra. Na toj snimci
čitljiv tekst smije biti samo: ime stajališta, imena četvrti, brojevi vozila na pločama/kapsulama
i vrijednosti izjava u stupcu; ništa se drugo ne smije natjecati za pažnju (nema sitnog teksta
karte, nema imena ulica ispod praga `roads_labels_major`).

**Rezultat (val B, `3m-light.png`, `3m-dark.png`):** s tri metra prvo se čita tramvajska pruga
(tinta danju, papir noću) i veliko ime stajališta „Trg bana J. Jelačića” s prstenom; potom imena
četvrti (KAPTOL, MARTIĆEVA, GORNJI GRAD, VOĆARSKO NASELJE) i u stupcu vrijednost prometne izjave u
boji stanja („13 rani 4 min · 6 rani 3 min”) te „Amruševa”; QR i kod („MXQS · X1QJ”) čitaju se
kao blok. Brojevi na pločama vozila raspoznaju se kao plave točke s brojem na granici čitljivosti;
naslovi izjava (PROMET, ZATVORENO), kontekstni retci, imena ulica i atribucija ne natječu se s
gornjim. Ništa drugo na slici nije čitljivo, što je i cilj.

### Pravila slaganja

Iz provjera `compositionIssues` u `e2e/kiosk-layout.spec.ts` (P3, val A): polje karte u pejzažu ≥ 0,60
površine `.k-invitation`; jedino `.maplibregl-ctrl-attrib` smije sjeći okvir polja; `.k-column`
nikad ne sječe polje; QR ≥ 240 px u oba smjera; svaka `.k-say-value` ima
`scrollHeight ≤ clientHeight + 1`, bez `text-overflow: ellipsis`, najviše dva retka; zaglavlje i
traka 96/72 × zoom; u portretu polje ≥ 0,5 visine pozornice, a izjave stoje lijevo od kartice;
jedinstvena postavljena imena `roads_labels_major` ≤ 8 (mjereno preko `placedNames()` na
`CityMapHandle`); bez preklapanja, bez prelijevanja, točno jedan `h1`, zastoj kod prekida izvora
(`stale-feed-hold`), uparene kompozicije zadržavaju svoje čuvare. `?prizor=` više ne postoji ni
kao ruta ni kao query -- njegovo odsustvo provjerava i `node scripts/audit-production.mjs`
(pravilo `legacy-prizor-param`). Broj izjava pinira se kao donja granica, ne kao obećanje (R-KP22):
najmanje dvije na 1920 × 1080 (tri kad je svaka vrijednost u jednom retku), najmanje jedna na
1366 × 768 (dvije kad je prometna vrijednost u jednom retku), tri u portretu; imena ulica
najviše 8 na svakoj veličini (R-KP17). Totem, čije polje nosi dvostruko tla sjever--jug, sam bi
postavio 7--9 imena: kiosk zato širi razmak sudara imena (`text-padding`) u koraku s tlom koje polje
pokazuje više nego vodoravni zaslon (`labelPadding` u `kiosk/mapview.ts`, 48 umjesto 24 pločastih piksela na
totemu, 24 na vodoravnom zaslonu), čime je vlastito slaganje profila prije pločica vozila palo na 3 imena uz
6--8 na vodoravnom zaslonu (mjereno 16. 9. 2026.). Razmak sidara (`symbol-spacing`) nije poluga za taj broj: MapLibre
sidri svaku cestu jednom po pločici bez obzira na razmak (360, 473, 745 i 1100 dali su isto 7--8
imena na totemu).

**Rezultat (val B):** `gate.sh unit` -- `UNIT STAGES PASSED` (`gate-logs/gate-20260916-171723.log`:
typecheck, vitest 179 datoteka / 2534 testova u oba projekta, build). `e2e/kiosk-layout.spec.ts`
16 testova: okvir na 1920 × 1080 drži 2 cijele izjave uz dvorednu prometnu vrijednost i 3 uz
jednoredne, na 1366 × 768 po 2 (granice 1 / 2), na 1080 × 1920 3 i 3; retci oznaka prometa 2 / 1 /
2; `data-major-labels` (prvi otisak pri `ready`, tj. slaganje profila prije pločica vozila / nakon
jednog ciklusa dohvata, popravak 1, 19:05): 4--7 / 2 na 1920 × 1080, 4 / 0 na 1366 × 768, 3 / 0 na
1080 × 1920 -- brojka pada kad pločice vozila zauzmu sidra, ne raste (nula je stvarno brojanje);
prije proširenja razmaka sudara totem je sam postavljao 7--9 (jedanput 9 preko granice), vodoravni zaslon 6--8.
Jedinični stupanj ponovljen je na konačnom HEAD-u popravka 1 (naziv dnevnika u
`task-WB-report.md`). Preglednički stupanj (`gate.sh browser`,
`gate-logs/gate-20260916-174346.log`): Playwright 91 testova u oba projekta -- 86 zelenih i pet
crvenih koji su svi imali isti uzrok (zaslon za e2e dobio je stajalište, pa su dokazi pisani za
zaslon bez stajališta -- telefonska sesija u a11y i motion, ploča lagano u lagano i motion -- i
čekanje na pozitivan broj imena ulica na 1366 × 768 pali); popravak u `e2e/helpers.ts`
(stajalište dobivaju samo Prozorovi dokazi) i `e2e/kiosk-layout.spec.ts` (brojanje nakon jednog
ciklusa dohvata), a četiri pogođene specifikacije ponovno su prošle protiv istog poslužitelja, uz jednu iznimku koju treba znati: `paired at 1366 by 768, light` u dva od tri samostalna ponavljanja nije dočekala preslikani sloj `zrak-i-nebo` dok je lokalni Worker bilježio `twin_fetch_failed` (istek dohvata prema ZET-u) i "Network connection lost"; treće ponavljanje i sam gate bili su zeleni, pa je uzrok mreža razvojnog Workera, ne kompozicija
(`task-WB-report.md`); `review:visual` 77 površina, 0 nalaza; Lighthouse pristupačnost 100 na
`/`, `/hitno`, `/kiosk/`, `/s/`, `/d/` i `/prijava/`.

### Oznake sadržaja za proizvodnju

Testid-ovi koji preživljavaju spajanje (global-constraints.md, ugovor 8): `kiosk-live` (polje),
`kiosk-map-host` (nosi `data-major-labels`), `kiosk-map`, `kiosk-lines` (redak crta prijevoza,
i na izjavi i na laganoj ploči), `kiosk-says` (stupac), `kiosk-say` (svaki `article.k-say`),
`kiosk-strip`, `pair-code`/`code-a`/`code-b` (kod za uparivanje; `kiosk-code` nikad nije
postojao), QR testid-ovi, `kiosk-context`, `kiosk-clock`,
`kiosk-weather`. Ukinuti: `kiosk-scene`, `kiosk-scene-meta`, `kiosk-scene-position`,
`kiosk-tonight`, `kiosk-city`, `kiosk-works`, `tile-vehicles`, `tile-closures`, `k-city-ink`.
Osam mogućih izjava u stupcu (`app/src/kiosk/say.ts`, P2): prometna presuda, potres, zatvaranje,
zadnji polazak (od 20 sati), ZET-ova prometna obavijest, najava sjednice Skupštine, radovi i
kvartovske novosti -- najviše tri istovremeno, poredane po važnosti sada. Workerov teaser
(`/api/teaser`, ova radna cjelina): kutija vozila 3,8 km oko stajališta (`TEASER_BOX_HALF_M`
1900 m), otvoreni retci `dogadanja` poredani (sjednice, ZET promet, pa ostatak) i ograničeni
na 20.

**Rezultat (proizvodnja): popunjava kontrolor nakon spajanja na `main`** -- živi `kiosk.css` nosi
`.k-say`, posluženi stil nema sloj `pois`, teaser odgovara pinovima dalje od 1,4 km.

## Prihvaćanje, companion 2026-09

Prihvaćanje paketa WP0 do WP6 iz `docs/companion-2026-09-22.md` (odjeljak 16) na jednom mjestu: za
svaki redak paket, mjera, naredba, prag i izvor praga, izmjerena vrijednost na isporuci D1 i poslije
nje te ocjena. D1 je oznaka `D1` (`f0357bf`), u produkciji od 23. rujna 2026. Stupac „Poslije D1”
uz svaku vrijednost navodi glavu na kojoj je izmjerena: kandidate D2 (`2d46817`, `10ed458`, a za
preglednik puno ponavljanje na `725991c` 23. i 24. rujna), kandidate D3 (`48cb09f`, `4848e36`,
ocjenjivač na `bd86ebb6`), kandidata izdanja `92950b17` i samo izdanje `d52cc47b` (oznake D2 do D5,
jedna isporuka 24. rujna 2026.) te naknadne isporuke D5.1 do D5.14 istoga dana: provjeru izdanja u
pregledniku i promatranje produkcije na D5.8 (`ea5439e0`), drugu rundu tračnica na `7dfe32ad`
(isporučena kao D5.11, `a5a18195`), popravak mirnog kretanja na `ab0abf87` (isporučen kao D5.12,
`8be813df`) i mjerenja pristupačnosti i brzine na `560ec7a0` i `9e7cc0b9` (isporučena kao D5.6 i
D5.10). Vrh isporuke D5.14 je `1826178c`. Na kandidatima D2 motor kretanja i artefakti mreže bajtno su isti
kao na D1; graf s grane `lane/t-rail` stiže s D3, a graf druge runde (graphHash
`7ad4834435980e22`) s D5.11. Crtica znači da se redak na toj
isporuci ne mjeri. Prag je broj iz odjeljka 16 i ne prilagođava se izmjerenom: crveni redak ostaje
crven dok vrijednost ne dosegne prag, a izmjerena vrijednost služi kao radno polazište.

Razina prihvaćanja (`npm run accept` u Vitestu, `npm run accept:e2e` u Playwrightu) namjerno ostaje
crvena do isporuke odgovarajućeg paketa i nikad se ne preskače. `npm test` i `npm run e2e` ne
pokreću tu razinu; na isporuci D4 razina postaje dio obiju naredbi. Drugo pokretanje Playwrighta na
istom računalu, iz zasebnog radnog stabla, dobiva vlastite lokalne poslužitelje uz varijablu
`E2E_PORT`, na primjer `E2E_PORT=8797 npm run accept:e2e -- e2e/accept/wall.spec.ts`: aplikacija
tada sluša na 8797, poslužitelj s kratkom sesijom na 8798, a bez varijable ostaju 8787 i 8788.
Uzorak okvira za redak U1
opisan je u
[`test/fixtures/frames/2026-09-21-1715-1744/README.md`](../test/fixtures/frames/2026-09-21-1715-1744/README.md):
162 okvira ZET-ova GTFS-RT-a samo s tramvajima, od 21. rujna 2026., od 17:15 do 17:44, isključivo
testni podatak repozitorija. Retci A1 do A12 čitaju ključeve iz tablice „Kapija paketa WP0” iznad,
gdje su i polazišta prije WP0.

README uzorka generira `scripts/frames-sample.mjs`: `npm run frames:sample -- --readme-only
test/fixtures/frames/2026-09-21-1715-1744` osvježava samo README, bez okvira. README navodi
graphHash artefakta mreže, pa ga treba ponovno generirati kad se spoji novi artefakt; za graf s
grane `lane/t-rail` to je učinjeno na `8e91bcdd` (graphHash `c7e6e555d9845ffd`), za graf druge
runde na `7dfe32ad` (graphHash `7ad4834435980e22`), a test uspoređuje README s artefaktom.

Na isporuci D4 „`npm test` uključuje razinu prihvaćanja” znači konkretno: skripta `test` dobiva
projekt `accept` (`vitest run --project unit --project workers --project accept`), a skripta `e2e`
Playwrightov projekt `accept`, i to tek kad je svaki redak razine zelen (pravilo spajanja u
`vitest.config.ts`), jer je `npm test` kapija svake trake. Do tada je kapija isporuke D4
`npm run typecheck && npm run typecheck:tests && npm test && npm run accept`, a `npm run accept`
smije biti crven samo u retku U1: taj redak prema odluci od 23. rujna ostaje crven s nepromijenjenim
pragovima. Nastavak za tračnice i prepoznavanje staza (`lane/t-rail`, u izdanju) spustio je na
uzorku A na 1,33 i A′ na 0, a E, G i H ostaju crveni (`d52cc47b`). Druga runda (`7dfe32ad`) na
uzorku zadržava A 1,33 i A′ 0 i spušta G sa 6 na 3, a E 1 i H 611 m ostaju, pa je U1 i dalje
crven.

| # | Paket | Mjera | Naredba | Prag | Izvor | D1: ned 20. 9. / pon 21. 9. | Poslije D1 (glava uz vrijednost) | Ocjena |
|---|---|---|---|---|---|---|---|---|
| A1 | WP0 | A: promjene staze unutar iste vožnje na 100 vozilo-sati tramvaja | `npm run replay:grade -- <dan> --out <prefiks> --targets stage1` | ≤ 5 (drugi stupanj ≤ 1) | §16.2 | 21,44 / 12,25 | D2 (`725991c`) kao D1; `bd86ebb6` (D3, oba dana): 17,97 / 3,20; `7dfe32ad` (druga runda tračnica, isporuka D5.11, oba dana, oba ocjenjivača bez razlike, kao i u retcima A2 do A12): 1,39 (22 događaja) / 1,80 (40 događaja) | prolazi oba dana u prvom stupnju (drugi stupanj ≤ 1 ne prolazi); skokovi preusmjerenog tramvaja (u nedjelju 253, obilazak linije 11) ne ulaze u A, kako kaže formula u tablici „Kapija paketa WP0”; preostali događaji su podaci (vremena vožnji, skraćene vožnje) ili nenacrtano okretanje kod Ravnica, nijedan nije pogrešna tračnica |
| A2 | WP0 | A′: isto u kvadratu središta, 17:15 do 17:44 | kao A1 | ≤ 5 | §16.2 | 41,7 (7 događaja) / 18,7 (6 događaja) | D2 (`725991c`) kao D1; `bd86ebb6` (D3, oba dana): 23,8 (4 događaja) / 0; `7dfe32ad` (D5.11): 0 (0 događaja, 6 uz sve razrede) / 0 (0 događaja, 2 uz sve razrede) | prolazi oba dana |
| A3 | WP0 | B: preuzimanja staze druge linije | kao A1 | 0 | §16.2 | 0 / 0 | D2 (`725991c`) kao D1; `bd86ebb6` (D3, oba dana): 0 / 0; `7dfe32ad` (D5.11): 0 / 0 | prolazi |
| A4 | WP0 | C: vozilo-sati na tuđoj stazi; svježa očitanja na tuđoj stazi | kao A1 | 0; 0 | §16.2 | 0; 0 / 0; 0 | D2 (`725991c`) kao D1; `bd86ebb6` (D3, oba dana): 0; 0 / 0; 0; `7dfe32ad` (D5.11): 0; 0 / 0; 0 | prolazi |
| A5 | WP0 | D: vlastita staza među mogućima, a odabrana druga inačica | kao A1 | 0 | §16.2 | 0 / 0 | D2 (`725991c`) kao D1; `bd86ebb6` (D3, oba dana): 0 / 0; `7dfe32ad` (D5.11): 0 / 0 | prolazi |
| A6 | WP0 | E: promjene smjera dalje od 300 m od okretišta | kao A1 | 0 | §16.2 | 4 / 7 | D2 (`725991c`) kao D1; `bd86ebb6` (D3, oba dana): 8 / 10, od toga 4 i 5 predaja petlje dalje od 300 m od okretišta; `7dfe32ad` (D5.11): 4 / 7; u nedjelju sva 4 i u ponedjeljak 5 su povratci s plana zadržanog na stajalištu okretišne petlje (T8) nakon duge tišine, prvi put očitani dalje od 300 m, u ponedjeljak još 1 s nove petlje u Zapruđu i 2 stvarna okretanja po pravilu D4 dok je ZET zadržao staru vožnju | ne prolazi (4 / 7 uz prag 0) |
| A7 | WP0 | F: vožnje unatrag po luku od 500 m i više | kao A1 | 0 | §16.2 | 0 / 0 | D2 (`725991c`) kao D1; `bd86ebb6` (D3, oba dana): 0 / 0; `7dfe32ad` (D5.11): 0 / 0 | prolazi |
| A8 | WP0 | G: ponovna postavljanja oznake na klijentu za više od 50 m; p95 pomaka | kao A1 | 0; < 50 m | §16.2 | 1.203; 253,9 m / 1.232; 226,2 m | D2 (`725991c`) kao D1; `bd86ebb6` (D3, oba dana): 416; 142,8 m / 261; 131,4 m; `7dfe32ad` (D5.11): 271; 98,7 m / 131; 58,0 m | ne prolazi: u ponedjeljak su 120 od 131 izlasci iz petlje nakon stajanja, u nedjelju 110 izlazaka iz petlje i 150 ponovnih postavljanja na skokovima preusmjerenog tramvaja linije 11 |
| A9 | WP0 | H: vidljiva korekcija pri ponovnom izvođenju, p95 | kao A1 | < 60 m | §16.2 | 250 m / 226 m | D2 (`725991c`) kao D1; `bd86ebb6` (D3, oba dana): 260 m / 230 m; `7dfe32ad` (D5.11): 255 m / 234 m | ne prolazi: rep čine povratci s petlje nakon 49 do 119 s tišine (bez izlazaka iz petlje u ponedjeljak p95 121 m) i, u nedjelju, skokovi preusmjerenog tramvaja linije 11 na skretanjima koja nijedan oblik ne crta |
| A10 | WP0 | U: tramvaj bez staze, bez razdoblja stajanja u spremištu ili na okretištu | kao A1 | ≤ 0,03 | §16.2 | 0,0289 / 0,0226 (sirovo 0,0364 / 0,0300) | D2 (`725991c`) kao D1; `bd86ebb6` (D3, oba dana): 0,0208 / 0,0114 (sirovo 0,0251 / 0,0153); `7dfe32ad` (D5.11): 0,0219 / 0,0136 (sirovo 0,0260 / 0,0168) | prolazi |
| A11 | WP0 | S1 i S2: rok izbacivanja; objavljena vozila starija od roka; tihi tramvaji planirani preko idućeg stajališta | kao A1 | 180 s; 0; 0 | §16.2, [O-63] | 180 s; 0; 0 / 180 s; 0; 0 | D2 (`725991c`) kao D1; `bd86ebb6` (D3, oba dana): 180 s; 0; 0 / 180 s; 0; 0; `7dfe32ad` (D5.11): 180 s; 0; 0 / 180 s; 0; 0 | prolazi |
| A12 | WP0 | nepoznate vožnje u snimci | kao A1 | ≤ 1 % | §16.2 | 0,049 % / 0,145 % | D2 (`725991c`) kao D1; `bd86ebb6` (D3, oba dana): 0,049 % / 0,145 %; `7dfe32ad` (D5.11): 0,049 % / 0,145 % | prolazi |
| A13 | WP0 | kapija kruga F na 20. 9.: slike unatrag, obrati, preticanja, vidljiva križanja, otkucaj p50 | `node scripts/replay-twin.mjs <dan>` | 0; 0; 0; ≤ 2.478; < 60 ms | §16.2 | 0; 0; 0; 1.552; 26,79 ms / – | D2 (`725991c`) kao D1; `bd86ebb6`: 0; 0; 0; 1.529; 41,63 ms (p50 uz dijeljeno računalo; na grani `lane/t-rail` 26,50 ms); `7dfe32ad`: 0; 0; 0; 1.402; 47,15 ms (p95 72,32 ms, uz četiri ocjenjivača i jedinične testove na istom računalu) | prolazi |
| A14 | WP0, WP6 | provjera tipova i testovi | `npm run typecheck && npm run typecheck:tests && npm test` | zeleno, 0 pogrešaka u četiri programa | §16.1 | 3.068 testova u 223 datoteke, 0 pogrešaka u četiri programa / – | `92950b17` (kandidat izdanja): 4.727 testova u 258 datoteka, 0 pogrešaka u četiri programa; `2d46817`: 4.598 testova u 247 datoteka; `1826178c` (vrh D5.14): 4.889 testova u 267 datoteka, 0 pogrešaka u četiri programa | prolazi |
| A15 | WP0 | artefakt mreže: bez dugih dionica, najmanje 20 okretišnih petlji, isti bajtovi pri ponovnoj gradnji | `npm run build:network -- --zip <arhiva> --built-at <vrijeme>`, `npm run build:schema -- --check` | ≥ 20 petlji; isti bajtovi | §16.2 | 30 petlji, od toga 7 bez crteža na shemi (`loop-undrawn`); isti bajtovi / – | D2 (`725991c`) kao D1; `bd86ebb6`: artefakt grane `lane/t-rail` (graphHash `c7e6e555d9845ffd`), 71 okretišna petlja, od toga 18 bez crteža na shemi, 145 od 152 staze na nacrtu, `npm run build:schema -- --check` izlazni kod 0; `7dfe32ad` (artefakt `8062732b`, isporuka D5.11): graphHash `7ad4834435980e22`, 75 okretišnih petlji, od toga 18 bez crteža na shemi, 145 od 152 staze na nacrtu, `npm run build:schema -- --check` izlazni kod 0, ponovna gradnja bajtno ista | prolazi |
| A16 | WP0, WP2 | oznake vozila bez „+N” i bez skraćivanja popisa linija | `npm run accept -- test/accept/trust.test.ts -t pills`, `npm run e2e -- e2e/round-f.spec.ts e2e/schema.spec.ts` | 0 oznaka s „+N” | §16.3, §16.5 | 0 od 21.645 oznaka u 280 uzoraka (najviše 9 linija u oznaci); `round-f` i `schema` 11 od 11 / – | `725991c`: 0 oznaka s „+N” u 300 očitanja svakog od 8 prizora i u deset minuta uživo (161 različita oznaka, sve u jednom retku); `c-pills` i `c-no-fold` zeleni; `48cb09f`: `round-f` 3 od 3; `ea5439e0` (D5.8, provjera izdanja u pregledniku): 0 oznaka s „+N” u specifikaciji zaslona i u deset minuta uživo; `schema` zelen, `round-f` 3 od 3 nakon ispravka testnog okvira `4a73d1e8` (spojen u `fda441d4`); produkcija na D5.8 (24. 9. od 13:37 do 13:50): 0 u 300 očitanja zaslona i na hladnom otvaranju Karte | prolazi |
| A17 | WP0 | svaki doslovni ključ i18n postoji u oba kataloga; QR u dijalogu dijeljenja ima hrvatski opis | `npm test -- test/app/dashboard.test.ts test/app/i18n-keys.test.ts` | nedostaje 0 ključeva | §16.5 | 80 od 80 / – | `92950b17`: cijeli `npm test` zelen; `d52cc47b`: `a-keys` zelen | prolazi |
| A18 | WP0 | atribucija zatvaranja prometnica bez sata i bez „posljednja izmjena” | `npm test -- test/app/attribution.test.ts test/open/attribution.test.ts test/app/izvori.test.ts` | 0 | §16.5 | 114 od 114 / – | `92950b17`: cijeli `npm test` zelen; `d52cc47b`: `b-templates` i `b-rendered` zeleni | prolazi |
| A19 | WP0 | na zaslonu nema kontrole za završetak prikaza | `npm test -- test/app/kiosk.test.ts test/app/kiosk-css.test.ts`, `npm run e2e -- e2e/pairing.spec.ts` | 0 | §16.5 | 120 od 120, uparivanje 3 od 3 / – | `725991c`: `kiosk-layout` 7 od 7 (uz `de1c232a`); `48cb09f`: uparivanje 3 od 3; `d-presentation` i `d-presentation-source` zeleni | prolazi |
| U1 | WP0, WP6 | uzorak od 162 okvira, prvi stupanj | `npm run accept -- test/accept/wrong-turn.test.ts` | preduvjeti: 162 okvira, nepoznate vožnje < 0,02; A i A′ ≤ 5; B, C, D, E, F, I 0; G 0 uz p95 < 50 m; H < 60 m; U ≤ 3 %; S ≤ 50 m | §16.2 | kao kandidat D2 (isti motor) | `725991c` (D2): nepoznate 0,0007; A 10,67; A′ 18,8; E 1; G 34 uz p95 385 m; H 173 m; ostali retci 0; `d52cc47b` (izdanje, graphHash `c7e6e555d9845ffd`): 162 okvira, nepoznate 0,0007; A 1,33; A′ 0; B, C, D, F, I 0; U 1,96 %; S 0 m; E 1; G 6 uz p95 85,8 m; H 611 m; `ea5439e0` (D5.8, provjera izdanja u pregledniku): `npm run accept` 105 od 106, jedini crveni redak U1 (E 1, G 6 uz p95 85,8 m, H 611 m); `7dfe32ad` (druga runda, oba ocjenjivača jednaka u 9.663 lista): A 1,33; A′ 0; E 1; G 3 uz p95 75,4 m; H 611 m; U 2,28 % | ne prolazi (4 retka: E, G, p95 od G, H); H 611 m i jedini E su isti događaj, povratak s petlje kod Svetog Duha nakon 97 s tišine (vozilo 102230), a ne pogrešno prepoznata staza |
| Z1 | WP1 | prvi pogled zaslona u osam prizora, a za `peak1745` i uspravno | `npm run accept:e2e -- e2e/accept/wall.spec.ts` | `INSTRUCTION` 0, `COUNT` 0, `UNCLASSIFIED` 0; `EMPTY` i `DISCLAIMER` 0 u bočnom stupcu | §16.3 | – | `725991c`: 0/0/0 u svih 9 prizora (8 vodoravno i `peak1745` uspravno); specifikacija zaslona 9 od 9; `ea5439e0` (D5.8, provjera izdanja u pregledniku): specifikacija zaslona 17 od 17 (8 prizora, 8 dodira i uspravni položaj), 0/0/0 u svakom prizoru; produkcija na D5.8 (24. 9. od 13:37 do 13:50): 0/0/0 vodoravno i uspravno, bočni stupac bez `EMPTY` i `DISCLAIMER` | prolazi |
| Z2 | WP1 | polasci u 300 očitanja kroz deset minuta | kao Z1 | 1 do 3 u svakom očitanju, i na zaslonu za cijeli grad | §16.3, [O-65] | – | `725991c`: 1 do 3 u svakom od 300 očitanja u svih 8 prizora (`lastTrams2240` 1, `afterLast0045` 2); na 1366 × 768 u četiri noćna prizora rezervirani retci istisnu sve polaske i sami se režu (`data-fit-overflow` 1, `readable-city` :161 i `redesign` :59 crveni); uživo 24. 9. od 00:03 do 00:15 bez polaska u 6 od 300 očitanja; `ea5439e0` (D5.8, provjera izdanja u pregledniku): 1 do 3 u svakom od 300 očitanja u svih 8 prizora, nikad 0; `data-fit-overflow` 0 u svakom očitanju na 1366 × 768, 1920 × 1080 i 1080 × 1920 (30 očitanja po prizoru, 17 slučajeva), 0 odrezanih redaka; `readable-city` i `redesign` zeleni; uživo 2 do 3 u 300 očitanja; produkcija na D5.8 (24. 9. od 13:37 do 13:50): 2 do 3 u 300 očitanja | prolazi (noćni raspored na 1366 × 768 i noćno mjesto za polazak ispravljeni na grani `lane/w-fix8`, isporuka D5.3) |
| Z3 | WP1 | rečenica u zaglavlju | kao Z1 | 1 do 80 znakova, bez prelijevanja i trotočja; najmanje 3 različite i nijedna uzastopno ponovljena (lokalni predložak); u produkciji nijedna doslovno ponovljena unutar deset minuta | §16.3, §12 | – | `725991c`: najmanje 8 različitih, 0 uzastopnih ponavljanja, najdulja 51 znak, bez prelijevanja i trotočja; uživo nijedno doslovno ponavljanje unutar 600 s; izmjene kraće od 20 s: `lastTrams2240` 8,2 s, uživo 4,0 s, 5,9 s i 10,5 s; `ea5439e0` (D5.8, provjera izdanja u pregledniku): 12 do 25 različitih, 0 uzastopnih ponavljanja; najkraće zadržavanje 18,3 s (zadržavanje od 20 s očitano u koracima od 2 s), nijedna izmjena prije 20 s dok činjenica vrijedi; uživo, brojeno po činjenici, svako zadržavanje najmanje 20 s (preformulirano odbrojavanje ista je rečenica) i jedno doslovno vraćanje točno 600 s kasnije, koje `89090ae3` (D5.14) isključuje jer vraćanje mora čekati strogo dulje od 600 s; produkcija na D5.8 (24. 9. od 13:37 do 13:50): 18 različitih u 22 izmjene, 0 doslovnih ponavljanja unutar deset minuta | prolazi; ritam od 20 s na prizorima i uživo prolazi, a ispravak granice od 600 s (`89090ae3`) još nije izmjeren uživo |
| Z4 | WP1 | „U blizini” i kartica s QR-om | kao Z1 | zaglavlje odgovara `/^U blizini · \d+(,\d)? km · ~\d+ min$/`; najviše jedan redak sunca; svaki redak nosi `data-when` ili `data-always`; uvod točno „Skeniraj za 10 minuta grada.”; QR ≥ 240 px | §16.3, [O-68] | – | `725991c`: zaglavlje, uvod i mjesto u redu u svih 9 prizora; najviše 1 redak sunca; QR 240 px; `ea5439e0` (D5.8, provjera izdanja u pregledniku): QR 240 px, zaglavlje i uvod u redu u svakom prizoru; produkcija na D5.8 (24. 9. od 13:37 do 13:50): `nearby-head`, `lead`, `solar`, `rows-timed` i `qr` prolaze u svih 300 očitanja | prolazi |
| Z5 | WP1, WP3 | na zaslonu nema upravljanja | kao Z1, `npm run accept -- test/accept/trust.test.ts -t d-controls` | 0 kontrola osim marke i QR-a; Postavke samo dugim pritiskom od 0,8 s bilo gdje na zaslonu osim prstena stajališta, retka popisa i ljekarne u podnožju te tipkama Enter i razmaknica dok zaslon ima fokus; podnožje bez HH:MM | §16.3, §16.5 | – | `725991c`: 0 kontrola u prvom očitanju i u svih 300 u svakom prizoru; Postavke samo držanjem od 900 ms u 8 prizora; podnožje bez HH:MM; `d-controls-invitation` i `d-controls-presentation` zeleni (`10ed458`); `ea5439e0` (D5.8, provjera izdanja u pregledniku): 0 kontrola, podnožje bez sata; produkcija na D5.8 (24. 9. od 13:37 do 13:50): `controls` i `footer-clock` 0 | prolazi |
| Z6 | WP1 | mirno kretanje | kao Z1 | najviše 2 promjene DOM-a u minuti mirovanja; retci zadržavaju svoje čvorove | §16.3 | – | `725991c`: 0 u svakoj minuti mirovanja u svih 8 prizora; uživo 4, 0, 4, 2, 4, 7, 4, 10, 14 i 4 u minuti (jedno noćno mjesto za polazak mijenja vožnje); `ea5439e0` (D5.8, provjera izdanja u pregledniku): 0 u šest prizora i 2 u dva prizora (po jedna izmjena polaska, višak 0); uživo lokalno (13:52 do 14:03) višak iznad izmjena polazaka 1, 6, 4, 0, 2, 0, 0, 7, 0 i 4 u minuti i jedan ponovno stvoren redak; produkcija na D5.8 (24. 9. od 13:37 do 13:50), pravilo koje izuzima samo polaske: 85 zapisa, 25 izmjena, višak 35, 2 ponovno stvorena retka, 6 od 10 minuta iznad 2; `ab0abf87` (popravak, isporučen kao D5.12), deset minuta uživo lokalno uz živi ZET-ov feed (14:17 do 14:27), pravilo koje izuzima ulazak i izlazak svakog retka: 58 zapisa, 21 izmjena, višak 18, 3 ponovno stvorena retka, 3 od 10 minuta iznad 2, višak 0 u pet minuta, nijedan redak koji ostaje nije promijenio mjesto | prizori prolaze; uživo crveno (3 od 10 minuta na `ab0abf87`): blizanac tramvaj na stajalištu na nekoliko očitanja označi kao prošao, pa redak polaska ode i vrati se s novom procjenom; popravak je na grani `lane/t-rail3` |
| Z7 | WP1 | prizori zadnjeg i prvog polaska, noći, jutra i prekida ZET-a | kao Z1 | `lastTrams2240`: retci `last` i `first`; `afterLast0045`: nijedan `last` s prošlim vremenom i nijedno /zadnji/ kad su svi zadnji tramvaji otišli; `night0430`: tamna tema, `first` i `pharmacy`; `morning0745`: najmanje 1 živo odbrojavanje; `outage0800`: `data-feed` nije `live`, bez oznaka vozila, 0 živih redaka, `map-note` jednom, `data-markers` > 0, nijedan naslov /nedostup/ | §16.3, [O-41] | – | `725991c`: `lastTrams2240` `first` i `last`; `afterLast0045` `first` i 0 prošlih `last`; `night0430` `first` i `pharmacy`; `outage0800` markeri 1 i zum 13,17 od prvog očitanja, izvor nedostupan, 0 oznaka i 0 živih redaka, `map-note` jednom, bez /nedostup/; specifikacija prolazi i `morning0745` i `midday1230`; `ea5439e0` (D5.8, provjera izdanja u pregledniku): specifikacija zaslona 17 od 17 sa svim prizorima retka; `readable-city` zelen, uz noćnu snimku | prolazi |
| Z8 | WP2 | karta zaslona | kao Z1, `npm run e2e -- e2e/wall-map.spec.ts` | `data-unlabelled` 0; zum okvira unutar ±0,05 od `frameView`; autobusi u okviru; brojani krugovi BAJS, uz sivu nulu i prazan krug | §16.3, [O-71] | – | `725991c`: `data-unlabelled` 0 u svim prizorima; `wall-map` 3 od 3 na ponovljenom prolazu (u prvom prolazu pod opterećenjem 7 jednom crven, sam zelen); `ea5439e0` (D5.8, provjera izdanja u pregledniku): `wall-map` zelen; produkcija na D5.8 (24. 9. od 13:37 do 13:50): `data-unlabelled` 0 u svakom očitanju, vodoravno i uspravno | prolazi |
| Z9 | WP3 | postavljanje zaslona i mjesto | `npm run e2e -- e2e/screen-creation.spec.ts`, kao Z1 | `setup-preview` odgovara `/Na zaslonu: .* i [468] stajališta uokolo/`; `kiosk-context` nije prazan ni u jednom prizoru | §16.3, [O-65], [O-66] | – | `725991c`: `screen-creation` 1 od 1; `kiosk-context` nije prazan ni u jednom prizoru; `ea5439e0` (D5.8, provjera izdanja u pregledniku): `screen-creation` zelen; produkcija na D5.8 (24. 9. od 13:37 do 13:50): `kiosk-context` nije prazan ni u jednom od 300 očitanja | prolazi |
| Z10 | WP6 | čitljivost s 3 m na ploči 43″ 1080p | kao Z1, blok (G) | `legibilityViolations(page, WALL_1920)` prazan u svakom prizoru; pragovi u tablici „Tri metra” niže | §16.3 | – | `725991c`: `[]` u svih 9 prizora; oznaka polaska 40 px u svijetloj i 44 px u tamnoj temi; `ea5439e0` (D5.8, provjera izdanja u pregledniku): `[]` u svakom prizoru, oznaka polaska 40 px u svijetloj i 44 px u tamnoj temi; produkcija na D5.8 (24. 9. od 13:37 do 13:50): 0 prekršaja vodoravno i uspravno, snimka za 3 m (DPR 0,25) zapisana | prolazi |
| Z11 | WP6 | snimači preglednika | kao Z1, blok (I) | greške konzole i stranice, neuspjeli zahtjevi i odgovori HTTP ≥ 400: 0 | §16.3 | – | `725991c`: 0 u svih 9 prizora; `ea5439e0` (D5.8, provjera izdanja u pregledniku): 0 u svim prizorima i u deset minuta uživo; produkcija na D5.8 (24. 9. od 13:37 do 13:50): 0 na zaslonu, telefonu i stolnom računalu | prolazi |
| Z12 | WP1 do WP4 | oznake `data-testid` iz ugovora §15.6 | `npm run accept -- test/accept/probes.test.ts` | 0 crvenih | §15.6 | – | `725991c`: zelenih 54, crvenih 13 (`stop-board` i 12 redaka paketa WP4, D3); `4848e36` i `d52cc47b`: 67 od 67; `ea5439e0` (D5.8, provjera izdanja u pregledniku): `npm run accept` 105 od 106, jedini crveni redak U1, probe zelene | prolazi |
| Z13 | WP2 | dodir na zaslonu, samo čitanje | kao Z1, blok (F) | ploča polazaka unutar 5 s s 1 do 3 retka, sama se zatvara unutar 60 s, kamera se ne pomiče | §16.3 | – | `48cb09f`: 8 od 8 prizora, 3 retka u svakom, zatvara se sama, `data-zoom` od 13,17 do 13,21 bez promjene; `ea5439e0` (D5.8, provjera izdanja u pregledniku): 3 retka u svakom prizoru, zatvara se sama, `data-zoom` od 13,17 do 13,21 bez promjene | prolazi |
| M1 | WP4 | Sada na Pixelu 7 | `npm run accept:e2e -- e2e/accept/phone.spec.ts` | `INSTRUCTION` 0, `COUNT` 0; točno 3 polaska unutar 390 × 844; `sada-place` i `sada-sentence`; kartice „Sada · Karta · Još”; „Podijeli grad” vidljivo, jedan dodir otvara `share-code` | §16.4 | – | `48cb09f` i `4848e36`: 0/0/0 od 34 jedinice; točno 3 polaska unutar 390 × 844; mjesto „Trg bana J. Jelačića”, rečenica s natpisom; kartice „Sada · Karta · Još”; „Podijeli grad” vidljivo, kod nakon jednog dodira; `ea5439e0` (D5.8, provjera izdanja u pregledniku): specifikacija telefona 9 od 9; produkcija na D5.8 (24. 9. od 13:37 do 13:50): 3 od 3 polaska u prvom pogledu, mjesto „Trg bana J. Jelačića”, kartice „Sada · Karta · Još”, kod 143 ms nakon dodira na „Podijeli grad” | prolazi |
| M2 | WP4 | Karta i Još | kao M1 | najmanje 1 oznaka vozila unutar 2.000 ms bez dodira; 0 sklopivih izbornika; `data-unlabelled` 0; dodir na platno otvara `stop-board` s 3 retka u prozoru; pretraga najviše 3 dodira; Još vodi na „Događanja ovaj tjedan” | §16.4 | – | `4848e36`: prve oznake 1,20 do 1,80 s nakon `ready` u 17 hladnih otvaranja (opterećenje 0,5 do 1,4); red specifikacije bio je crven jer je njegovo čitanje s odgodom stalo nakon 1,3 do 1,7 s, što ispravlja `c63bdbe` (čitanje svakih 100 ms); 0 sklopivih izbornika, `data-unlabelled` 0, markeri najmanje 1 (`48cb09f`); dodir na platno i pretraga u 3 dodira otvaraju ploču s tri cijela vodeća retka (`companion-phone` 10 od 10), ali proba je brojila 12 redaka jer su i retci voznog reda nosili `data-kind=departure`, što ispravlja `d1bccc71` (retci voznog reda nose `data-kind=timetable`); Još vodi na „Događanja ovaj tjedan” s brojem; `ea5439e0` (D5.8, provjera izdanja u pregledniku): specifikacija telefona 9 od 9, hladno otvaranje Karte zeleno iz prvog pokušaja, dodir i pretraga pokazuju 3 retka; `9e7cc0b9` (D5.10): od dodira na Kartu do `ready` 0,78 do 1,22 s, `companion-phone` :243 3 od 3; produkcija na D5.8 (24. 9. od 13:37 do 13:50): prva oznaka 215 ms nakon `ready`, `data-unlabelled` 0, 0 sklopivih izbornika, ploča stajališta nakon 3 dodira s 3 od 3 polaska u prozoru | prolazi (izmjereno na `ea5439e0` i u produkciji) |
| M3 | WP4 | kraj sesije i stolno računalo | kao M1 | `session-ended` s poveznicama `/s/` i `/hitno`, 0 redaka, 0 izvoza, nijedan daljnji zahtjev `/api/data`; na 1440 × 900 Sada i Karta u prozoru; axe, ozbiljni i kritični nalazi 0 | §16.4, [O-62] | – | `4848e36`: `session-ended` s poveznicama `/s/` i `/hitno`, 0 redaka, 0 izvoza, nijedan zahtjev `/api/data` nakon kraja; zapis zahtjeva bio je crven samo na dva dohvata slika simbola karte (`/maps/sprites/light@2x.json` i `.png`, `net::ERR_ABORTED`) prekinuta u trenutku kraja, što ispravlja `e2d4724` (statične datoteke prekinute pri rušenju navode se, svaki zahtjev `/api/` ostaje nalaz); 1440 × 900: Sada i Karta u prozoru, `scrollWidth` najviše 1441 na 100, 125 i 200 %; axe: 0 ozbiljnih i kritičnih (`48cb09f`); `ea5439e0` (D5.8, provjera izdanja u pregledniku): popis zahtjeva prekinutih pri kraju sesije prazan, zapisi 0, `a11y` zelen i u retcima :228 i :275; produkcija na D5.8 (24. 9. od 13:37 do 13:50): `session-ended` 599 s nakon iskorištenja koda s poveznicama `/s/` i `/hitno`, 0 redaka, 0 zahtjeva `/api/data` nakon kraja, axe 0 ozbiljnih i kritičnih na Sada i Karta, na 1440 × 900 Sada i Karta u prozoru | prolazi (izmjereno na `ea5439e0` i u produkciji) |
| J1 | WP5 | jezik, katalozi i dokumenti | `npm test`, `npm run accept -- test/accept/trust.test.ts` | popis nekorištenih ključeva prazan; hr i en isti ključevi; bez hrvatskih literala u `app/src/city/strings.ts`; pojmovnik iz §16.6 | §16.6, [O-66] | – | `92950b17`: cijeli `npm test` zelen, čuvari dokumenata 38 od 38; `d52cc47b`: svi retci paketa WP5 u `trust.test.ts` zeleni | prolazi |
| V1 | WP6 | čuvari povjerenja i suvišnog teksta | `npm run accept -- test/accept/trust.test.ts` | 0 crvenih | §16.5 | – | `d52cc47b`: zelenih 36, crvenih 0; `4848e36`: zelenih 26, crvenih 9 (retci paketa WP5, prije spajanja paketa WP5) | prolazi |
| V2 | WP6 | alati provjere mjere sami sebe | `npm test -- test/e2e test/scripts/grade-branches.test.ts test/app/font-metrics.test.ts` | zeleno | §16.1 | – | `92950b17`: zeleno (dio punog `npm test`) | prolazi |
| V3 | WP6 | nijedna skripta ne stvara zaslon u produkciji | `AUDIT_KIOSK_URL= node scripts/audit-production.mjs`; `E2E_KIOSK_URL= node scripts/observe-production.mjs` | izlazni kod 2 i rečenica odbijanja prije ijednog zahtjeva; u promatraču nema `setup-create` ni `/api/screens` | §16.7 | odbijanje s izlaznim kodom 2, bez preglednika / – | čuvar nepromijenjen od D1; `test/scripts/observe-production.test.ts` zelen (`92950b17`) | prolazi |
| V4 | WP6 | promatranje produkcije nakon isporuke, samo čitanjem | `E2E_KIOSK_URL=<adresa postave zaslona> npm run observe:production -- --minutes 10` | izlazni kod 0; najviše 1 iskorišten kod po površini, najmanje 12 s razmaka | §16.7 | još nije pokrenuto: za dan isporuke nije zabilježena adresa zaslona / – | produkcija, izdanje `d52cc47b`, 24. 9. od 02:30 do 02:43: izlazni kod 1, ne prolazi 6 od 56 primijenjenih pragova (`unlabelled`: jedno očitanje bez probe; `pills-drawn`: 2 očitanja bez oznaka vozila uz živi izvor; `legibility`: karta u uspravnom položaju bez popisa oznaka; `karta-pills`: prva oznaka 4.442 ms nakon `ready`; `karta-unlabelled`: 1 od 58 markera; `phone-stop-board`: ploča nakon pretrage nije u prozoru, a 3 od 3 polaska jesu); otisak: 0 stvorenih zaslona, po jedan iskorišten kod na telefonu i na stolnom računalu, najmanje 12 s razmaka; zapisi zahtjeva prazni; produkcija na D5.8 (`ea5439e0`), 24. 9. od 13:36 do 13:50, uz mirno računalo: ne prolazi 1 od 56 primijenjenih pragova, samo `calm-motion` (6 minuta s viškom iznad 2 i jedan ponovno stvoren redak polaska); otisak: 0 stvorenih zaslona, po jedan iskorišten kod na telefonu i na stolnom računalu; zapisi zahtjeva prazni; produkcija, 24. 9. od 14:44 do 14:58, zaslon učitan dok je u produkciji bila isporuka D5.11 (`a5a18195`), a D5.12 do D5.14 isporučeni su tijekom promatranja: ne prolazi 2 od 56 pragova, `calm-motion` (4 minute s viškom iznad 2) i `closure-reentries` (redak zatvaranja u Gundulićevoj ulici napustio je popis i vratio se, ponovno stvoren u tri minute); polasci 1 do 3 u 300 očitanja, oznake vozila u 302 od 302 očitanja, prva oznaka na Karti 345 ms nakon `ready`, `session-ended` 602 s nakon iskorištenja koda; otisak: 0 stvorenih zaslona, po jedan iskorišten kod na telefonu i na stolnom računalu | ne prolazi (na D5.8 1 prag, na D5.11 2 praga: mirno kretanje, čiji je popravak isporučen kao D5.12, i povratak retka zatvaranja, nov nalaz); popravak mirnog kretanja u produkciji još nije promatran; otisak prolazi |
| V5 | WP6 | ništa osjetljivo ni golemo u gitu | naredbe iz podnaslova „Što nikad ne ulazi u git” | 0 datoteka; `test/fixtures/frames` ≤ 14.000.000 B (do 29. 9. 2026. 9.000.000 B, prije toga 6.500.000 B); 0 adresa postave s tajnom | §16.9 | – | `d52cc47b`: 0; 6.215.622 B; 0 | prolazi |
| V6 | WP6 | ručne provjere na uređaju | tablica „Ručne provjere na uređaju” niže | prije pilota svaki redak nosi uređaj, preglednik, datum i rezultat | §16.8 | prazno | prazno | na čekanju |

### Praćene brojke, bez praga

Brojke u ovoj tablici prate se na isporukama, ali nijedna nije prag i nijedna ne mijenja izlazni
kod. Prve dvije prate se prema odluci od 23. rujna: svježe probe koje granica vanjskog teksta
propusti (tekst treće strane sročen kao poruka čitatelju, svaki put nov) i popis teksta koji zaslon
preskoči (`data-skipped-text`). Druge dvije, Lighthouseova ocjena pristupačnosti i pomak rasporeda
(CLS), mjere se samo na lokalnoj gradnji, gdje poslužitelj nema pločica osnovne karte, pa je karta
u tim mjerenjima prazna.

| Brojka | Gdje se mjeri | D1 | Poslije D1 |
|---|---|---|---|
| propuštene svježe probe, zaglavlje i retci | pregled svake runde, 30 ili 50 novih proba po površini | – (granica stiže s D2) | 19/50 i 30/50 (`d08cb9b`), 7/30 i 7/30 (`cd71e53`), 1/30 i 1/30 (`3f18896`), 1/30 i 4/30 (`10ed458`) |
| `data-skipped-text` na zaslonu | `npm run observe:production`: zbroj, najveća vrijednost u jednom očitanju i razlozi u `report.md` | nema popisa: isporuka D1 još ne piše atribut | `count:0` u svih 300 očitanja lokalnog promatranja od deset minuta (`08ce4bf`, 23. 9. od 15:41 do 15:53, živi ZET-ov feed) i u 300 očitanja uživo na `725991c` (24. 9. od 00:03 do 00:15); produkcija, izdanje `d52cc47b` (24. 9. od 02:30 do 02:43): 0 u svih 300 očitanja; produkcija na D5.8 (`ea5439e0`, 24. 9. od 13:36 do 13:50) i na D5.11 (`a5a18195`, 24. 9. od 14:44 do 14:58): 0 u svih 300 očitanja |
| ocjena pristupačnosti u Lighthouseu | `node scripts/lighthouse-a11y.mjs` (1366 × 768, bez sesije) i Lighthouse 13.4.1 u lokalnoj sesiji, telefon 390 × 844 i stolno 1440 × 900 | – | `560ec7a0` (D5.6): 100 na `/`, `/hitno`, `/kiosk/`, `/s/`, `/d/` i `/prijava/`, 100 i na Sada, Karta i Još u obje teme; axe bez ozbiljnih i kritičnih nalaza; na `/d/` izmjereno samo lokalno, bez pločica osnovne karte |
| pomak rasporeda (CLS) | Lighthouse 13.4.1, lokalna gradnja, telefon 390 × 844 u sesiji i stolno 1440 × 900 | – | `9e7cc0b9` (D5.10): Sada na telefonu 0, 0 i 0,016 u tri mjerenja (na `ea5439e0` 0,081, 0,064 i 0,044); naslovnica na stolnom 0,001 (prije 0,113); otvoreno: ukupno blokiranje glavne niti (TBT) na Sada oko 125 s i prije i poslije, jer se traka karte pod SwiftShaderom neprestano iscrtava, a uzrok se još traži |

Retci `e-obuhvat` i `e-registra` od grane `lane/v-F3` provjeravaju samo zaslon, kako §13 kaže za napomene
#12 i #13: telefon zadržava napomenu o obuhvatu zaštite i rečenicu o registru, a provjera zaslona
čita i zajednički opis mjesta onako kako ga zaslon iscrtava.

### Tri metra

Pravilo čitljivosti s tri metra ima jedan izvor, `e2e/legibility.ts` (`WALL_1920`), a zamjenjuje
podnaslov „Provjera na 3 metre” u odjeljku „Javni zaslon Prozor”. `test/app/font-metrics.test.ts`
čita omjere iz isporučenih datoteka fonta Manrope, 0,54 za visinu malih slova i 0,72 za visinu
velikih, pa zamjena fonta ne može tiho pomaknuti pragove. Ploča je 43″ 16:9 na 1920 × 1080, 0,50 mm
po pikselu. Provjera se izvodi u svakom prizoru retka Z10 i piše izvještaj
`test-results/accept/legibility-<prizor>.json`, a umanjena snimka (DPR 0,25) za pregled okom ide u
`test-results/accept/wall-<prizor>-3m.png`.

| Razina | Sadržaj | Mjera na 3 m | Veličina slova na 43″ 1080p | Provjera |
|---|---|---|---|---|
| čitanje | mjesto (`kiosk-context`), rečenica, naslov i vrijeme retka „U blizini”, kod, presuda i ljekarna u traci | visina malih slova najmanje 10,5 mm (kritična veličina 0,2°, Legge i Bigelow); udobno 12 mm (DIN 1450, udaljenost / 250) | najmanje 38,9 px, u tamnoj temi ×1,1 (najmanje 42,8 px); od 10,5 do 12 mm (38,9 do 44,4 px) upozorenje | prekršaj ispod donje granice, upozorenje u izvještaju |
| prilazak | podredak retka, datum, legenda karte, natpis iznad rečenice (Promet, Kultura, Vrijeme, Bicikli, Noćas, Radovi), uvod i napomena kartice s QR-om, adresa za upisivanje | čita osoba koja priđe zaslonu | najmanje 28 px | prekršaj |
| ostalo | svaki drugi vidljivi tekst osim atribucije karte (`.maplibregl-ctrl-attrib`) | | najmanje 28 px | prekršaj |
| simboli | krugovi BAJS, oznake vozila, križ ljekarne | promjer 40 mm (DfT Inclusive Mobility, 3 do 6 m) | 80 px | samo izvještaj; odluka P3 pripada vlasniku |

Tekst pripada razini najbližeg pretka s odgovarajućim selektorom razine; natpis rečenice zato je
razina prilaska iako je rečenica razina čitanja. Karta zaslona crta simbole na jednom platnu, pa
izvještaj čita popis s okvira karte (`data-markers`, `data-unlabelled`, `data-bajs`,
`data-overlaps`, `data-pills`); karta bez oznake `[data-symbol]` i bez toga popisa je prekršaj,
kako neizmjerena karta ne bi prošla kao karta bez simbola.

### Ručne provjere na uređaju

Preglednik ne može dokazati ove provjere. Rezultat se upisuje nakon provjere, s uređajem,
preglednikom i datumom; prazna ćelija znači da provjera još nije provedena.

| # | Provjera | Uređaj | Preglednik | Datum | Rezultat |
|---|---|---|---|---|---|
| R1 | ploča 43″ 1080p s 3 m pri svjetlu prostora: čitaju se mjesto, rečenica, tri polaska, kod, presuda i ljekarna (pragovi iz tablice „Tri metra”) | | | | |
| R2 | isto nakon zalaska sunca, u tamnoj paleti sa slovima većima za 10 % | | | | |
| R3 | QR s 2 m i s 3 m, kamerom iPhonea | | | | |
| R4 | QR s 2 m i s 3 m, kamerom telefona s Androidom | | | | |
| R5 | zaslon na dodir: dodir na prsten stajališta otvara ploču polazaka, a zaslon se sam vraća unutar 60 s | | | | |
| R6 | zaslon na dodir: dugi pritisak (0,8 s) bilo gdje na zaslonu otvara Postavke, osim na prstenu stajališta, retku popisa i ljekarni u podnožju, gdje vrijedi kao dodir; kratak dodir i prst koji se pomakne za više od 12 piksela ne otvaraju Postavke | | | | |
| R7 | Safari i VoiceOver na Sada: mjesto, rečenica i tri polaska čitaju se tim redom; „Podijeli grad” ima naziv | | | | |
| R8 | Chrome na Androidu i TalkBack na Sada: isto kao R7 | | | | |
| R9 | smanjeno kretanje na zaslonu: retci i dalje ulaze i izlaze, bez animacije | | | | |
| R10 | tekst 200 % na telefonu: tri polaska i dalje u prvom pogledu | | | | |
| R11 | promatranje produkcije: jedan termin na dan, samo vlasnikov zaslon (`E2E_KIOSK_URL`), najviše 5 iskorištenih kodova u minuti, nikad tuđi zaslon | | | | |
| R12 | vlasnik čita svaki novi ili promijenjeni hrvatski tekst (razlika skenera i18n za svaku isporuku) [O-66] | | | | |

### Što nikad ne ulazi u git

- `.dev.vars`, lokalne tajne.
- Sve pod `review.local/` (pravilo `*.local` u `.gitignore`), uključujući
  `review.local/companion/screen.json` s oznakom i tajnom zaslona, i svaki `screen-<datum>.json`.
- `recordings/` na bilo kojoj dubini, oko 700 MB snimaka na dan. Uzorci okvira u repozitoriju
  postoje samo pod `test/fixtures/frames/` (popis je u tamošnjem `README.md`): uzorak za redak U1
  (`2026-09-21-1715-1744/`), uzorak sa ZET-ovim otkazanim polascima i obavijestima i uzorci štrajka
  od 28. i 29. rujna, koje prvi redak njihova README-a označava kao odstupanje, nikad kao uzorak
  običnog dana. Sve ih piše `npm run frames:sample`, a naredba odbija izlaz pod `recordings/`.
- `test-results/`, `.wrangler/`, `.cache/`.
- Adrese postave zaslona (`E2E_KIOSK_URL`, `AUDIT_KIOSK_URL`): tajna je u dijelu adrese iza `#`,
  pa su takve adrese samo u varijablama okoline, nikad u specifikacijama, dokumentima,
  izvještajima ni zapisima CI-ja.
- Servisni tokeni Cloudflare Accessa.
- Snimke produkcije na kojima se vide živi kodovi.

Čuvari (redak V5; na kandidatu D2 redom 0, 6.215.319 i 0):

```sh
git ls-files | grep -E '(^|/)\.dev\.vars$|screen(-[0-9-]+)?\.json$|(^|/)recordings/|^review\.local/|test-results/' | wc -l
du -sb test/fixtures/frames | cut -f1
grep -rn 'kiosk/#[0-9A-HJKMNP-TV-Z]\{8\}\.[A-Za-z0-9_-]\{24,\}' e2e scripts docs test --exclude-dir=superpowers | wc -l
```

Prva naredba mora dati 0, druga najviše 14.000.000, treća 0; treću provjerava i redak `e-secret` u
`test/accept/trust.test.ts`. Prag druge naredbe podignut je 29. rujna 2026. sa 6.500.000 na
9.000.000 prema mjerenju: s uzorkom otkazanih polazaka i uzorcima štrajka mapa ima 8.505.615 B, a
ostatak je mjesto za uzorak jutra 29. rujna. Istoga dana podignut je na 14.000.000 jer je 9.000.000
već bilo premašeno: mjereno 12.654.741 B na `05d98735` (artefakti feeda 000395 uz uzorak 21. rujna
3.267.924 B, `zet-expect-000395.json` 878.731 B), uz mjesto za uzorak jednog autobusa i eventualni
uzorak povratka. Pri zatvaranju nadogradnje mjereno je 12.675.382 B, s uzorkom jednog autobusa
i s `zet-expect-000395.json` od 878.724 B.

## Prihvaćanje, nadogradnja 2026-10

Prihvaćanje paketa U0 do U4 iz `docs/upgrade-2026-10.md` (odjeljak 6) na jednom mjestu, u istom obliku kao za companion: za svaki prihvatni redak paketa paket, mjera, naredba, prag, izmjerena vrijednost i ocjena. Naredbe i pragovi preuzeti su iz izvršnih datoteka paketa (`docs/history/upgrade-2026-10-plan/U0.md` do `U4.md`, kamo je mapa otišla zatvaranjem nadogradnje) bez promjene, a `\|` u naredbi znači `|` u ljusci; prag se ne prilagođava izmjerenom, pa crveni redak ostaje crven dok vrijednost ne dosegne prag. Stupac „Izmjereno” napunjen je pri zatvaranju nadogradnje iz zapisa u `review.local/upgrade/run/logs/` i iz izvještaja u `review.local/upgrade/run/reports/` (Codexova vrata na integriranom stablu `c8cea254`, promatranje `observe-du1`, izvještaji paketa), a ocjena „na čekanju” ostaje samo za retke koji čekaju produkciju nakon DU2 i DU3 ili mjerenje KPI-ja nakon objave. Retci koji traže produkciju (U0-10, U1-7, U2-8, U4-13) izvode se samo čitanjem, jednim zaslonom dana, i nikad ih ne pokreće agent.

| Paket (redak) | Mjera | Naredba | Prag | Izmjereno | Ocjena |
|---|---|---|---|---|---|
| U0-1a | Ponoć 27./28. rujna: budući pinovi i duhovi | `d=$(mktemp -d) && ln -s "$PWD"/review.local/companion/recordings/2026/09/27/2[23]*.pb "$PWD"/review.local/companion/recordings/2026/09/28/*.pb "$d"/ && nice node scripts/replay-twin.mjs "$d" --fleet-series > review.local/upgrade/run/logs/u0-series-0928.jsonl && node -e 'const L=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);const G=["22114","102269","102284","232","102280","22109","394"];const bad=L.filter(l=>l.futurePins>0\|\|l.itemCount!==l.pins\|\|(l.h>=1790557800&&l.ids.some(i=>G.includes(i)))\|\|(l.h>=1790616420&&l.pins+l.routeRows>0));console.log(L.length,"frames",bad.length,"bad");process.exit(bad.length?1:0)' review.local/upgrade/run/logs/u0-series-0928.jsonl` | nijedan pin s vremenom više od 30 s iza vremena izvora njegova sadržaja; nijedan od sedam duhova iz naredbe u sadržaju od 2026-09-28T01:10:00Z (1790557800); `itemCount === pins` u svakom okviru | 8.765 okvira, 0 povreda (budući pinovi, `itemCount !== pins`, duhovi, prazan feed); 8 s; `codex-integrated-u0-series-0928.jsonl` | prošlo |
| U0-1b | Ponoć 26./27. rujna (106 budućih vremena) | kao U0-1a, s `26/2[23]*.pb` i `27/*.pb`, `--network test/fixtures/frames/2026-09-21-1715-1744/artefacts/zet-network.json --trips test/fixtures/frames/2026-09-21-1715-1744/artefacts/zet-trips.json`, izlazom `u0-series-0927.jsonl` i provjerom bez dviju `h` klauzula | nijedan pin s budućim vremenom i `itemCount === pins` u svakom okviru | 9.039 okvira, 0 povreda; 481 s; `codex-integrated-u0-series-0927.jsonl` | prošlo |
| U0-2 | Prazan feed | zadnja klauzula naredbe iz U0-1a | od 28. rujna 17:27:00Z (1790616420) svaki okvir prazan: 0 pinova, `itemCount` 0, nijedan redak `route:` | od 1790616420 nijedan okvir s pinom ili retkom `route:`, 0 povreda u istom nizu (`codex-integrated-u0-series-0928.jsonl`) | prošlo |
| U0-3 | Popis parkiranih vozila, 24. rujna, cijeli dan | `nice node scripts/replay-twin.mjs review.local/companion/recordings/2026/09/24 --network test/fixtures/frames/2026-09-21-1715-1744/artefacts/zet-network.json --trips test/fixtures/frames/2026-09-21-1715-1744/artefacts/zet-trips.json --fleet-series --standing > review.local/upgrade/run/logs/u0-series-0924.jsonl && tail -1 review.local/upgrade/run/logs/u0-series-0924.jsonl \| node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8")).summary;const ok=s.publishedStandOver.tram+s.publishedStandOver.bus===0&&["22132","102297"].every(i=>s.everHidden.depot.includes(i));console.log(JSON.stringify(s.publishedStandOver));process.exit(ok?0:1)'` | 22132 i 102297 među vozilima skrivenima u spremištu; nijedno objavljeno vozilo ne stoji dulje od granice svog prijevoza | 7.945 okvira; objavljeno vozilo iznad granice: tramvaj 0, autobus 0; u spremištu 22132 i 102297, parkiranih 10; 1.280 s; `codex-integrated-u0-series-0924.jsonl` | prošlo |
| U0-4 | Zatvaranja s pomičnim krajem | `npx vitest run --maxWorkers=4 test/city/closures.test.ts test/app/kiosk-sentence.test.ts` | 38 od 39 nepoznatog kraja u obje kopije, Jazbina poznata, nijedna činjenica `closureUntil` | 38 od 39 nepoznatog kraja u obje kopije, Jazbina poznata, nijedna činjenica `closureUntil`; zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U0-5 | Zastarjeli zaslon i šav `service-state` | `npx vitest run --maxWorkers=4 test/city/service-state.test.ts test/app/kiosk.test.ts` | svi slučajevi zeleni; scena bez polaska u zaglavlju, tri retka polaska bez `data-live`, jedna napomena na karti | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U0-6 | Popunjavanje popisa: utorak, ponedjeljak, scene C do G | `npx vitest run --maxWorkers=4 test/app/wall-fit-0929.test.ts` | utorak 300 od 300 s tri retka polaska i oba zatvaranja; ponedjeljak najmanje 294 od 300; scene C do G zelene | utorak 300 od 300, ponedjeljak (kontrola) 294 od 300 (`reports/U0-client.md`); `accept:e2e` 26 od 26, zidna specifikacija 17 od 17 nakon `ef8d7442` (prvi prolaz 25 od 26, `lastTrams2240` crven; `fix-lasttrams-wall-spec.log`) | prošlo |
| U0-7 | Artefakti aktualni i međusobno usklađeni | `node scripts/check-artefacts.mjs && npx vitest run test/scripts/artefacts-consistent.test.ts` | izlazni kod 0 i test zelen (izlazni kod 2 je odgovor mreže: ponoviti) | izlazni kod 0 na mreži: feed 000396 u svim datotekama, medijan `validUntil` zadnjih polazaka 19. 10. 2026. (najraniji 4. 10.), ZET-ova arhiva nije izmijenjena nakon gradnje (`codex-integrated-artefacts.log`); test zelen u punim vratima | prošlo |
| U0-8 | Vrata na `du1-boundary` i na integriranom stablu | `npm run typecheck && npm run typecheck:tests && npm test`, zatim `npm run accept` | sve zeleno; `npm run accept` samo dokumentirano crveno (pogrešna skretanja E, G, H) | integrirano stablo: 295 datoteka, 5.617 testova, `codex-integrated-fullgate.log` zeleno; `npm run accept` 110 prošlo, jedino dokumentirano crveno E=1, G=3, G_p95=75,40 m, H=611 m (`codex-integrated-accept.log`); `du1-boundary` (`72e498c3`): proizvod istovjetan, crven samo zbog jednog zastarjelog testnog fixturea (sat vraćanja zadržavanja), `du2-boundary` (`44e8ac14`) još i zbog inventara prikaza, oba popravljena na vrhu (`e6f4b50b`, `c8cea254`; `reports/codex-gate-boundaries.md`) | prošlo, s dokumentiranim iznimkama |
| U0-9 | Nijedna riječ uzroka u nizovima proizvoda | `! grep -rniE "štrajk\|strike" app/src/i18n shared/kiosk/sentence.ts app/src/city/sentence.ts` | naredba izlazi s 0 (nijedan pogodak); `shared/city/notices.ts` nosi ZET-ovu vlastitu riječ po dizajnu, pa opseg ne obuhvaća `shared/city` | 0 pogodaka u opsegu iz U1-5 (izmjereno pri zatvaranju); u `shared/city` jedino `notices.ts` nosi riječ, ZET-ovu vlastitu, po dizajnu, pa je izvan opsega | prošlo |
| U0-10 | Produkcija nakon DU1, tri trenutka u razmaku od deset minuta | `curl -s https://zagreb.aningfilm.hr/api/teaser \| node -e 'const m=JSON.parse(require("fs").readFileSync(0,"utf8")).modules.find(x=>x.module==="zet-rt");const v=m.items.find(i=>i.id==="vozila");console.log(v.data.vehicles,m.sources.zet.itemCount);process.exit(v.data.vehicles===m.sources.zet.itemCount?0:1)'` | broj vozila na teaseru jednak `itemCount`; izlazni kod 0 | sonda 29. 9. u 22:41: vozila 0 = `itemCount` 0; promatranje `observe-du1` 22:41 do 22:52, 300 očitanja, svaki redak zelen (`review.local/upgrade/observe-du1/report.md`); ZET-ov feed bio je prazan i zastario, pa tri odvojena trenutka s vozilima nisu uzeta | prošlo, s napomenom |
| U1-1 | Rez od 21. rujna 17:15 | `npx vitest run --maxWorkers=4 test/twin/feed-decode.test.ts test/twin/operator.test.ts test/twin/publish.test.ts` | 25 vožnji NO_SERVICE po okviru u `noServiceTrips`, nijedna od 7 CANCELED; `operatorSummary` `{25, 25, null}`; pinovi CANCELED vožnji zadržavaju odredište | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U1-2 | Nijedan pravi polazak nije uklonjen | `npx vitest run --maxWorkers=4 test/city/arrivals.test.ts test/app/kiosk-nearby.test.ts` | s ploče odlaze samo vožnje iz upozorenja, a vožnja koju vozilo nosi ostaje uživo (popis: pravilo skriva 1 od 83 vožnje iz upozorenja do preuzimanja vozila, p50 13 min prije početka); sama oznaka `CANCELED` ne uklanja ništa | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U1-3 | Obavijest CRO Race (`zet-rss-promet-2026-09-27.xml`) | `npx vitest run --maxWorkers=4 test/app/kiosk-nearby.test.ts test/app/kiosk-sentence.test.ts test/feed/dogadanja/zet-rss.test.ts` | 27. 9. 2026. u 12:30+02:00 ploča s linijom 13 ima jedan redak `notice:zet-promet:10160` sa sažetkom kao podretkom, ploča s linijom 113 redak `notice:zet-promet:8134`, ploča samo s linijama 6 i 11 nijedan, ploča s linijom 137 nijedan; 28. 9. 2026. u 12:30+02:00 ploča s linijom 13 nijedan; javni zaslon i Sada popisuju isti redak; činjenica „ZET javlja: Linije 5 i 13 u nedjelju mijenjaju trase.” nudi se u prvom trenutku | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U1-4 | Kopije od 29. rujna | kao U1-3 | kopija prometa (samo uspinjača, bez linije) ne daje redak ni na jednoj ploči; kopija novosti daje `notice:zet-novosti:10164` u 2026-09-29T09:00+02:00 (bez rečenice: 76 znakova) i `notice:zet-novosti:10166` u 12:00 s rečenicom „ZET javlja: Uspostavljena autobusna linija 228 (Borongaj – Rebro – Borongaj).”; izjava Uprave (10165) nikad | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U1-5 | Nijedan niz proizvoda ne imenuje uzrok (izraz je u `shared/city/notices.ts`) | `! grep -rniE "štrajk\|strike" app/src/i18n shared/kiosk/sentence.ts app/src/city/sentence.ts` | naredba izlazi s 0 (nijedan pogodak) | 0 pogodaka (izmjereno pri zatvaranju) | prošlo |
| U1-6 | Vrata samog paketa | `npm run typecheck && npm run typecheck:tests && npx vitest run --maxWorkers=4 test/twin/feed-decode.test.ts test/twin/operator.test.ts test/twin/publish.test.ts test/twin/tick.test.ts test/city/arrivals.test.ts test/app/kiosk-nearby.test.ts test/app/kiosk-timeline.test.ts test/app/kiosk-sentence.test.ts test/app/copy-guards.test.ts test/app/nearby-contract.test.ts test/app/i18n.test.ts test/app/i18n-keys.test.ts test/app/i18n-orphans.test.ts test/app/external-text.test.ts test/app/next-departures.test.ts test/app/kiosk.test.ts test/app/transport-workspace.test.ts test/app/sada.test.ts test/feed/dogadanja test/feed/fixtures.test.ts` | sve zeleno | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U1-7 | Produkcija nakon DU2 (orkestrator, miran sat) | `curl -s https://zagreb.aningfilm.hr/api/teaser \| node -e 'const z=JSON.parse(require("fs").readFileSync(0,"utf8")).modules.find(m=>m.module==="zet-rt").sources.zet;const n=(z.noServiceTrips??[]).length;console.log(n,z.service?.operator);process.exit(z.service?.operator&&Math.min(z.service.operator.cancelledTrips,400)===n?0:1)'` | radnim danom preko dana `noServiceTrips` postoji i `service.operator.cancelledTrips` jednak je njegovoj duljini (najviše 400); izlazni kod 0 | DU2 objavljen 29. 9. u 22:53, uživo u 22:54:59; ZET-ov feed zamrznut od 21:15 (odgovori 304), pa `noServiceTrips` i `service` još nisu na žici; ponoviti u tri trenutka čim feed opet šalje | na čekanju |
| U2-1 | Graditelj očekivanja: prekid niza i proračun | `npx vitest run test/scripts/gtfs-expect.test.ts test/motion/expect.test.ts` | sve zeleno | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`); izgrađeno očekivanje: 460 u 07:00 i 384 u 11:00 za 29. 9. na feedu 000396 (`reports/U2-twin.md`) | prošlo |
| U2-2 | Automat stanja usluge | `npx vitest run test/twin/service.test.ts` | svaki prijelaz na svom trajanju (299 s ostaje, 300 s prelazi; 599 i 600 s za `silent`), sve zeleno | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U2-3 | Rezovi odstupanja i normalni rez (integrirano stablo) | `npx vitest run --project accept test/accept/service-state.test.ts` (integrated tree) | collapse: `reduced` do 00:20; start: `silent` do 04:10; peak i one-bus: `silent` od prvog okvira + 11 min do kraja; normalni rez: svaki prosuđeni redak `normal`, omjer najmanje 0,7, `expected` između 380 i 470 | svih pet slučajeva zeleno u `npm run accept` (110 prošlo), uključujući rez početka koji je na samoj grani U2 bio crven do spajanja s U0 (`codex-integrated-accept.log`) | prošlo |
| U2-4 | Pravila glasa i tekst | `npx vitest run test/city/service-fleet.test.ts test/app/service-voice.test.ts test/app/kiosk-sentence.test.ts test/app/sentence-contract.test.ts test/kiosk/sentence-wire.test.ts test/app/copy-guards.test.ts test/app/i18n.test.ts test/app/i18n-keys.test.ts test/app/i18n-orphans.test.ts` | sve zeleno | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U2-5 | Nijedna riječ uzroka | `! grep -rniE "štrajk\|strike" app/src/i18n shared/kiosk/sentence.ts app/src/city/sentence.ts shared/city/service-state.ts` | naredba izlazi s 0 (nijedan pogodak) | 0 pogodaka (izmjereno pri zatvaranju) | prošlo |
| U2-6 | Šest običnih dana (integrator, lokalne snimke, miran stroj) | `for d in 20 21 24 25 26; do nice node scripts/replay-twin.mjs review.local/companion/recordings/2026/09/$d --service-log --assert-normal --expect test/fixtures/frames/zet-expect-000395.json > review.local/upgrade/analysis/service-09$d.txt \|\| exit 1; done && nice node scripts/replay-twin.mjs review.local/companion/recordings/2026/09/27 --service-log --assert-normal --to 210000 --expect test/fixtures/frames/zet-expect-000395.json > review.local/upgrade/analysis/service-0927.txt` | 0 minuta izvan `normal`, satni p05 najmanje 0,65 | šest običnih dana, 0 minuta `reduced` i `silent`: `normal` 1.260 od 1.440 minuta (20. 9.), 1.321 od 1.436 (21.), 1.322 od 1.437 (24.), 1.322 od 1.437 (25.), 1.320 od 1.440 (26.), 1.080 od 1.260 (27. do 21:00 UTC), ostalo `unknown` (`below-min`, noćna udubina); satni p05 svugdje najmanje 0,65 (`reports/codex-gate-service-replays.md`, `codex-integrated-service-09NN.log`) | prošlo |
| U2-7 | Vrata | `npm run typecheck && npm run typecheck:tests && npm test` | sve zeleno | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U2-8 | Produkcija nakon DU2 (orkestrator, miran sat) | `curl -s https://zagreb.aningfilm.hr/api/teaser \| jq '.modules[]\|select(.module=="zet-rt").sources.zet.service'`, u tri trenutka; zatim `E2E_KIOSK_URL=<zaslon dana> npm run observe:production -- --stage d2 --minutes 10 --max-load 4` | `service` prisutan u tri trenutka, `expected` unutar 20 % reda veličine iz README-a za sat i vrstu dana, `state` `normal` običnim danom (ili `silent` dok odstupanje traje); retci `silent-departures` i `departures` zeleni | DU2 uživo od 22:54:59, ali ZET-ov feed zamrznut (`service` nije na žici, kako je zamišljeno dok okvir stariji od 180 s drži stanje); ponoviti u tri trenutka čim feed opet šalje | na čekanju |
| U3-1 | Parseri ponavljaju svoje fixtureove i odbijaju tuđi oblik | `npx vitest run --maxWorkers=4 test/feed/kultura-zg.test.ts test/feed/programi.test.ts test/feed/dhmz-hourly.test.ts test/feed/hak.test.ts test/feed/prekidi.test.ts test/feed/street-points.test.ts test/feed/fixtures.test.ts test/feed/registry.test.ts` | sve zeleno | zeleno; na svojim fixtureovima: kultura-zg 150, programi 21, dhmz-hourly 168, hak 3 (5 prije popravka kojim se redak prikazuje tek kad je počeo, `cc4b8e21`), prekidi 32 stavke (`reports/U3-modules.md`) | prošlo |
| U3-2 | kultura.zagreb.hr: čitano otvoreno, objavljeno, identificirano | `npx vitest run --maxWorkers=4 test/feed/robots.test.ts test/docs/docs.test.ts test/docs/izvori.test.ts test/app/izvori.test.ts && grep -q "O-70" docs/izvori.md && grep -q "O-70" app/src/data/izvori.json && npm run check:izvori` | testovi zeleni; `O-70` u `docs/izvori.md` i u `app/src/data/izvori.json`; `npm run check:izvori` izlazi s 0 | `O-70` u `docs/izvori.md` i u `izvori.json`; `npm run check:izvori`: „All 40 URLs answer; every module documented.” (`reports/U3-modules.md`); testovi zeleni u punim vratima | prošlo |
| U3-3 | Izvadak OpenStreetMapa unutar proračuna | `npx vitest run --maxWorkers=4 test/scripts/osm-hours.test.ts test/city/osm-hours.test.ts && test $(gzip -9c app/public/data/osm-hours.json \| wc -c) -le 307200` | testovi zeleni; `gzip -9c` datoteke najviše 307200 B | 218.858 B sirovo, 41.166 B `gzip -9c` (granica 307.200 B); 1.982 zapisa radnog vremena, 1.005 mjesta, 59 odbačenih (`reports/U3-osm.md`) | prošlo |
| U3-4 | Mjesta događanja: najmanje 10 od 22, 0 od 12, nijedno pogrešno | `npx vitest run test/city/venues.test.ts` | test zelen | 10 od 22 mjesta smješteno, 0 od 12 izvan Zagreba, nijedno pogrešno; test zelen (`reports/U3-osm.md`) | prošlo |
| U3-5 | Jedan redak po novoj vrsti, tramvaji zadržavaju tri, vlak samo po voznom redu | `npx vitest run --maxWorkers=4 test/app/kiosk-nearby.test.ts test/app/kiosk-timeline.test.ts test/app/sada.test.ts test/app/wall-render-inventory.test.ts` | sve zeleno | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U3-6 | Obitelji rečenica u tri primjerka | `npx vitest run --maxWorkers=4 test/app/copy-guards.test.ts test/app/sentence-contract.test.ts test/app/kiosk-sentence.test.ts test/kiosk/sentence-wire.test.ts test/app/i18n.test.ts test/app/i18n-keys.test.ts test/app/i18n-orphans.test.ts` | sve zeleno | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U3-7 | Spojevi J2 i J3 iz fixtureova | `npx vitest run test/app/joins.test.ts` | test zelen | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U3-8 | Pretvorba KPI-ja vjerna (nulta polazna vrijednost ponovljena) | `npx vitest run test/scripts/thin-spot.test.ts && node scripts/thin-spot.mjs review.local/companion/data-calendar --from 2026-09-21 --to 2026-09-29 --json review.local/upgrade/kpi/baseline-port.json > /dev/null && node -e "const s=require('./review.local/upgrade/kpi/baseline-port.json').summary;process.exit(s.dayMedian===0&&s.cityPerDayMedian===0?0:1)"` | test zelen; `dayMedian` 0 i `cityPerDayMedian` 0 | `dayMedian` 0 i `cityPerDayMedian` 0 nad 188 uzoraka; test zelen (`reports/U3-osm.md`) | prošlo |
| U3-9 | KPI nakon DU3 (96 sati uzorkovanja od objave) | `node scripts/thin-spot.mjs review.local/companion/data-calendar --from <DU3 day + 2> --hours 48 --json review.local/upgrade/kpi/after.json > review.local/upgrade/kpi/after.md && node -e "const s=require('./review.local/upgrade/kpi/after.json').summary;process.exit(s.minDay>=1&&s.minEvening>=1&&s.dayMedian>=3&&s.eveningMedian>=3&&s.cityPerDayMedian>=30?0:1)"` | `minDay` najmanje 1, `minEvening` najmanje 1, `dayMedian` najmanje 3, `eveningMedian` najmanje 3, `cityPerDayMedian` najmanje 30 | mjerenje nakon nadogradnje još nije uzeto: 96-satni uzorkivač počinje pri objavi DU3, a KPI čita drugi i treći zagrebački dan nakon dana objave; prije nadogradnje izmjerena nula na svih šest mjesta (`review.local/upgrade/kpi/baseline.md`) | na čekanju |
| U3-10 | Cijelo stablo, jednom, u fazi vrata | `npm run typecheck && npm run typecheck:tests && npm test` | sve zeleno | `npm run typecheck && npm run typecheck:tests && npm test -- --maxWorkers=8` zeleno: 295 datoteka, 5.617 testova, `codex-integrated-fullgate.log` | prošlo |
| U4-1 | Broj polazaka prema uklapanju i sonda | `npx vitest run --maxWorkers=4 test/e2e/wall.test.ts` | test zelen sa slučajevima A1 | zeleno u punim vratima (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`); `accept:e2e` zidna specifikacija 17 od 17 nakon `ef8d7442` (ista presuda `e2e/wall.ts`) | prošlo |
| U4-2 | Dva retka promatrača, nijedan otkazani redak | `npx vitest run --maxWorkers=4 test/scripts/observe-production.test.ts`; `grep -c "'silent-departures'" scripts/observe-production.mjs` = 1; `grep -cE "'(fleet-ratio\|service-steady\|service-honest\|stale-note\|timetable-current)'" scripts/observe-production.mjs` = 0 | testovi zeleni; `grep -c "'silent-departures'"` daje 1; drugi `grep -cE` daje 0 | testovi zeleni u punim vratima; `grep -c` daje 1, drugi `grep -cE` daje 0 (izmjereno pri zatvaranju) | prošlo |
| U4-3 | Zatvaranja, pretraga, zrak | `grep -c "windowOf" app/src/kiosk/mapview.ts app/src/layers/u-pokretu.ts` ≥ 1 u svakoj datoteci; `npx vitest run --maxWorkers=4 test/city/city.test.ts test/city/readable.test.ts` | `grep -c "windowOf"` najmanje 1 u svakoj datoteci; testovi zeleni | `windowOf` 4 u `mapview.ts` i 3 u `u-pokretu.ts`; testovi zeleni u punim vratima | prošlo |
| U4-4 | /open, /statistika, zasluge | `! grep -n "Grad javlja" worker/open/index-page.ts`; `npx vitest run --maxWorkers=4 test/open/open-index.test.ts test/open/statistika-public.test.ts test/app/izvori.test.ts` | nijedan pogodak za „Grad javlja” u `worker/open/index-page.ts`; testovi zeleni | nijedan pogodak za „Grad javlja”; testovi zeleni u punim vratima | prošlo |
| U4-5 | F28: planirana tablica, licenca fixturea, zastavice | `awk '/^## Izvori planirani/,/^## Kako/' docs/izvori.md \| grep -cE "hidro_bilten\|iszz.azo\|GTFS_files\|dezurne-ljekarne"` = 0; `grep -c "Licenca nije navedena; nema otvorenog skupa" test/fixtures/waste.json` = 1; `npx vitest run --maxWorkers=4 test/app/flags.test.ts` | `awk` broji 0 pogodaka; `grep -c` daje 1; test zastavica zelen | `awk` broji 0, `grep -c` daje 1; test zastavica zelen u punim vratima | prošlo |
| U4-6 | Prolaz kroz dokumente | `grep -c "u tijeku" docs/kiosk.md docs/izvori.md` ≥ 1 u svakoj datoteci; `grep -c "O-70" docs/izvori.md` ≥ 1; `grep -c "sources.zet.service" docs/arhitektura.md` ≥ 1; `grep -c "^## Prihvaćanje, nadogradnja 2026-10" docs/kaj-verification.md` = 1; `! grep -niE "štrajk\|strike" docs/kiosk.md` | `u tijeku` najmanje jednom u `docs/kiosk.md` i `docs/izvori.md`; `O-70` najmanje jednom u `docs/izvori.md`; `sources.zet.service` najmanje jednom u `docs/arhitektura.md`; točno jedan odjeljak `## Prihvaćanje, nadogradnja 2026-10`; nijedan pogodak za riječi uzroka u `docs/kiosk.md` | `u tijeku` 1 u `docs/kiosk.md` i 1 u `docs/izvori.md`; `O-70` 4 u `docs/izvori.md`; `sources.zet.service` 1 u `docs/arhitektura.md`; točno jedan odjeljak; nijedan pogodak za riječi uzroka u `docs/kiosk.md` | prošlo |
| U4-7 | README | `grep -c "Nine feed modules" README.md` = 0; `grep -c "neslužbeni prikaz" README.md` ≥ 1; `grep -c "](docs/upgrade-2026-10.md)" README.md` = 1 | 0 pogodaka za „Nine feed modules”; „neslužbeni prikaz” najmanje jednom; točno jedna poveznica na `docs/upgrade-2026-10.md` | „Nine feed modules” 0; „neslužbeni prikaz” 1; poveznica na `docs/upgrade-2026-10.md` 1 | prošlo |
| U4-8 | Tipovi dijela A | `npm run typecheck && npm run typecheck:tests` | oba izlaza 0 u `wt/U4` | `npm run typecheck` i `npm run typecheck:tests` 0 grešaka u `wt/U4` i, zeleno, na integriranom stablu (295 datoteka, 5.617 testova, `codex-integrated-fullgate.log`) | prošlo |
| U4-9 | Mapa u povijesti, upućivanja | `test ! -e docs/upgrade-2026-10-plan && test -f docs/history/upgrade-2026-10-plan/U4.md && grep -c "](upgrade-2026-10-plan/" docs/history/README.md` ≥ 1; `git grep -n "upgrade-2026-10-plan/" -- . ':!docs/history'` ispisuje samo staze pod `docs/history/upgrade-2026-10-plan/` | stare mape nema, `docs/history/upgrade-2026-10-plan/U4.md` postoji, najmanje jedna poveznica u `docs/history/README.md`; `git grep` ispisuje samo staze pod `docs/history/upgrade-2026-10-plan/` | stare mape nema, `docs/history/upgrade-2026-10-plan/U4.md` postoji, `grep -c` daje 1; svaki redak koji `git grep` ispisuje nosi putanju `docs/history/upgrade-2026-10-plan/` (`u4-partb-u4-9-10-12.log`) | prošlo |
| U4-10 | Bilješka; predani tekstovi bajtno isti | `npm run build:prijava && npx vitest run --maxWorkers=4 test/docs/prijava.test.ts`; `git diff --stat 05d98735..HEAD -- docs/prijava/prijedlog-projekta.md docs/prijava/prijedlog-projekta.html docs/prijava/prijedlog-projekta.docx docs/prijava/obrazac-2-2.md docs/prijava/obrazac-3-financijski-plan.md docs/prijava/plan-provedbe.md docs/prijava/rizici-i-odgovori.md` bez izlaza | gradnja i test zeleni; `git diff --stat` za sedam predanih datoteka prazan | `npm run build:prijava` i `test/docs/prijava.test.ts` zeleni; `git diff --stat` za sedam predanih datoteka prazan (`u4-partb-build-prijava.log`, `u4-partb-vitest.log`) | prošlo |
| U4-11 | Dokumenti navedeni, naredbe stvarne (integrirano stablo) | `npx vitest run --maxWorkers=4 test/docs` | `test/docs` zelen | `test/docs` zelen u zajedničkom prolazu s `open-index`, `transport-detail` i `izvori` (`u4-partb-vitest.log`) | prošlo |
| U4-12 | Ništa osjetljivo ni golemo | `git ls-files \| grep -E '(^\|/)\.dev\.vars$\|screen(-[0-9-]+)?\.json$\|(^\|/)recordings/\|^review\.local/\|test-results/' \| wc -l` = 0; `du -sb test/fixtures/frames \| cut -f1` ≤ 14000000 | prva naredba 0, druga najviše 14000000 | prva naredba 0; `test/fixtures/frames` 12.675.382 B (granica 14.000.000; `u4-partb-u4-9-10-12.log`) | prošlo |
| U4-13 | Produkcija nakon DU3 (orkestrator) | `E2E_KIOSK_URL=<zaslon dana> npm run observe:production -- --minutes 10 --max-load 8 --out review.local/upgrade/observe-du3` | retci `departures` i `silent-departures` zeleni | nakon objave DU3; na čekanju | na čekanju |

## Prihvaćanje, prolaz otkrivanja 2026-10

Prihvaćanje paketa R0 do R4 iz `docs/reveal-2026-10.md` (odjeljak 6) na jednom mjestu, u istom obliku kao za nadogradnju: za svaki prihvatni redak paketa paket, mjera, naredba, prag, izmjerena vrijednost i ocjena. Naredbe i pragovi preuzeti su iz izvršnih datoteka paketa (`docs/reveal-2026-10-plan/R0.md` do `R4.md`, odjeljak „Acceptance”) bez promjene, a `\|` u naredbi znači `|` u ljusci; prag se ne prilagođava izmjerenom, pa crveni redak ostaje crven dok vrijednost ne dosegne prag. Jedino je riječ uzroka u dvije naredbe (R1-11, R4-5) napisana kao `štr[a]jk`, istog značenja za `grep`, da novi tekst dokumenata ne nosi tu riječ. Stupac „Izmjereno” puni se nakon objave DR3 iz zapisa u `review.local/reveal/run/logs/` i iz izvještaja u `review.local/reveal/run/reports/`, a ocjena „na čekanju” ostaje samo za retke koji čekaju produkciju ili mjerenje KPI-ja nakon 3. listopada.

| Paket (redak) | Mjera | Naredba | Prag | Izmjereno | Ocjena |
|---|---|---|---|---|---|
| R0-1 | Vrijednosti retka, pojasevi, blagdani i simboli | `npx vitest run --maxWorkers=4 test/app/takt-values.test.ts test/city/holidays.test.ts test/city/dhmz-symbols.test.ts` | green; the 17 values, the bands, 14 holidays in 2026 and 2027, 42 symbols | zeleno na grani (12 testova: 17 vrijednosti, pojasevi, 14 blagdana, 42 simbola); zeleno u punim vratima DR1 (5.808 testova, `codex-DR1-unit-final.log`) | prošlo |
| R0-2 | Retci „U blizini”: otvorena mjesta, vlakovi, izložbe, bez otvorenog mjesta na blagdan | `npx vitest run --maxWorkers=4 test/app/kiosk-nearby.test.ts test/app/sada.test.ts test/app/nearby-contract.test.ts` | green; two open rows at 17:45, two trains at Glavni kolodvor, exhibitions as openings, the notice's short title, no open row on 1 Nov 2026 | zeleno na grani (138 testova); zeleno u punim vratima DR1 (5.808 testova, `codex-DR1-unit-final.log`) | prošlo |
| R0-3 | Popis i uklapanje u utorak 29. rujna | `npx vitest run --maxWorkers=4 test/app/kiosk-timeline.test.ts test/app/wall-strip.test.ts test/app/wall-fit-0929.test.ts` | green; Tuesday 29 Sep: 3 departures and both closures at 300 of 300; the flipped pins of Step 4 and nothing else | zeleno na grani (112 testova); utorak 29. 9. 300 od 300 s tri polaska i oba zatvaranja, `wall-fit-0929` nepromijenjen; preokrenuti pinovi opisani u izvješću R0; zeleno u punim vratima DR1 (5.808 testova, `codex-DR1-unit-final.log`) | prošlo |
| R0-4 | Obitelji rečenica u tri primjerka | `npx vitest run --maxWorkers=4 test/app/kiosk-sentence.test.ts test/app/copy-guards.test.ts test/app/sentence-contract.test.ts test/kiosk/sentence-wire.test.ts` | green; 35 families; the three copies byte-identical | zeleno na grani (427 testova, 35 obitelji); na stablu DR3 41 obitelj (35 + 6 iz R3), tri primjerka bajtno ista; punim vratima DR3 (6.108 testova, `codex-DR3-unit.log`) | prošlo |
| R0-5 | Opis vremena DHMZ-a | `npx vitest run --maxWorkers=4 test/feed/dhmz-weather.test.ts test/feed/fixtures.test.ts` | green; `weather` "Oblačno" and "Promjenljivo oblačno uz malu količinu kiše" | zeleno na grani (108 testova); zeleno u punim vratima DR1 (5.808 testova, `codex-DR1-unit-final.log`) | prošlo |
| R0-6 | Slojevi, čuvani izbori i popisi | `npx vitest run --maxWorkers=4 test/city/curated.test.ts test/app/kiosk-front.test.ts test/app/kiosk-local.test.ts test/app/layers.test.ts test/app/layer-breadth.test.ts test/app/transport-workspace.test.ts test/app/dashboard.test.ts test/app/kiosk.test.ts` | green | zeleno na grani (514 testova, nakon pinova dashboarda i zaslona); zeleno u punim vratima DR1 (5.808 testova, `codex-DR1-unit-final.log`) | prošlo |
| R0-7 | Katalog jezika, ključevi i nekorišteni listovi | `npx vitest run --maxWorkers=4 test/app/i18n.test.ts test/app/i18n-keys.test.ts test/app/i18n-orphans.test.ts test/app/i18n-scan.test.ts test/city/copy-keys.test.ts` | green; leaves 1126 hr, 1097 en | zeleno na grani (41 test, listova 1.126 hr i 1.097 en); na stablu DR3 1.141 hr i 1.112 en (R2 dodaje 1, R3 dodaje 14); zeleno u punim vratima DR1 (5.808 testova, `codex-DR1-unit-final.log`) | prošlo |
| R0-8 | Tipovi | `npm run typecheck && npm run typecheck:tests` | 0 errors | 0 grešaka na grani i na integriranom stablu svake isporuke (`codex-DR1-typecheck.log`, `codex-DR2-typecheck.log`, `codex-DR3-typecheck.log` i njihovi `-tests` dnevnici) | prošlo |
| R0-9 | Bez nove duge crtice u datotekama koje je R0 napisao; otvorena mjesta uvijek kroz izbor blagdana | `grep -cP '\x{2014}' docs/reveal-2026-10-plan/R0.md app/src/city/nearby.ts shared/kiosk/takt.ts shared/city/holidays.ts shared/city/dhmz-symbols.ts` and `grep -n 'false)' app/src/kiosk.ts app/src/city/feed.ts \| grep openPlacesNear` | no new em dash in the files R0 wrote; the second command prints nothing | 0 u svih pet datoteka; drugi `grep` ne ispisuje ništa (ponovljeno na stablu DR3, 1. 10. 2026.) | prošlo |
| R1-1 | Sljedeći polasci prema sučelju (d) | `npx vitest run test/app/kiosk-nearby.test.ts -t "nextDepartures"` | 5 tests pass | 5 testova prolazi (`nextDepartures`) | prošlo |
| R1-2 | Redak polazaka, uklapanje, mirno kretanje, odluka 67, smanjenje na 64 px, donje granice | `npx vitest run --maxWorkers=4 test/app/kiosk-timeline.test.ts test/app/wall-fit-0929.test.ts test/app/wall-strip.test.ts test/app/kiosk-css.test.ts` | all pass; Tuesday 300 of 300 with three cells and both closures, Monday at least 294 of 300 containing the recorded ids | 798 testova u 14 datoteka na grani; utorak 300 od 300 s tri ćelije i oba zatvaranja; ponedjeljak: 299 od 300 sadrži sve zabilježene identifikatore (prag 294); zeleno u punim vratima DR1 (5.808 testova, `codex-DR1-unit-final.log`) | prošlo |
| R1-3 | Dodir i petlja zaslona | `npx vitest run --maxWorkers=4 test/app/kiosk-touch.test.ts test/app/kiosk.test.ts` | all pass | zeleno u skupu R1 na grani (798 testova); zeleno u punim vratima DR1 (5.808 testova, `codex-DR1-unit-final.log`) | prošlo |
| R1-4 | Redak polazaka na računalu i retci na telefonu | `npx vitest run --maxWorkers=4 test/app/sada.test.ts test/app/next-departures.test.ts test/app/dashboard.test.ts` | all pass | zeleno u skupu R1 na grani (798 testova); zeleno u punim vratima DR1 (5.808 testova, `codex-DR1-unit-final.log`) | prošlo |
| R1-5 | Alat broji ćelije | `npx vitest run --maxWorkers=4 test/e2e/wall.test.ts test/e2e/accept-support.test.ts test/scripts/observe-production.test.ts` | all pass | zeleno u skupu R1 na grani; promatrač i sonda broje ćelije; zeleno u punim vratima DR1 (5.808 testova, `codex-DR1-unit-final.log`) | prošlo |
| R1-6 | Svako odredište teksta na zaslonu čuvano | `npx vitest run test/app/wall-render-inventory.test.ts` | passes on the regenerated snapshot (`-u` after the path) | zeleno nakon regeneracije popisa (DR1: samo pomaknuti retci i dva nova mjesta `departureCellMarkup`; DR3: samo pomaknuti retci i jedno novo mjesto, zasluga radara) | prošlo |
| R1-7 | Tipovi | `npm run typecheck && npm run typecheck:tests` | exit 0 | 0 grešaka (grana, integrirano stablo) | prošlo |
| R1-8 | Prihvatna specifikacija zaslona s novom scenom | `E2E_PORT=8931 npx playwright test e2e/accept/wall.spec.ts --project=accept` | 19 tests pass (8 scenes, 8 touches, portrait, the departures line at 1920 and at 1366; the documented wrong-turn reds are in `test/accept`, not here) | na grani 17 od 19, dva popravljena (redak polazaka u `af90806b`, mirno kretanje u `lastTrams2240` odlukom 3 i `e342a8e2`); na vratima DR1 `accept:e2e` 28 od 28 nakon ponavljanja samo neuspjelih (`codex-DR1-e2e.log`); `lastTrams2240` izvorno: 2 promjene, nijedan čvor obnovljen | prošlo |
| R1-9 | Ponašajne specifikacije koje čitaju retke polazaka (integrirano stablo) | `npx playwright test --project=chromium e2e/kiosk-layout.spec.ts e2e/readable-city.spec.ts e2e/redesign.spec.ts e2e/refit.spec.ts e2e/desk.spec.ts` | pass | 37 slučajeva: prvi prolaz 25 od 37, 12 neuspjelih riješeno ciljanim ponavljanjima (`codex-DR1-layout-specs.log`, `codex-DR1-browser-fixes.log`, `codex-DR1-passive-after.log`) | prošlo |
| R1-10 | Vrata na integriranom stablu DR1 | `npm run typecheck && npm run typecheck:tests && npm test` | , then `npm run accept` and `npm run accept:e2e`: green but for the documented wrong-turn red | DR1: oba tipa 0 grešaka; `npm test` 5.808 (orkestrator 5.813, `claude-DR1-verify.log`); `npm run accept` 110 prošlo i dokumentirano crveno E=1, G=3, G_p95=75,40 m, H=611 m (odluka 5); `npm run accept:e2e` 28 od 28 | prošlo (dokumentirano crveno) |
| R1-11 | Bez trotočke, bez riječi uzroka, bez upozorenja u retku | `! grep -nE "text-overflow\|line-clamp" <(grep -n "k-dep-" app/src/ui/kiosk-city.css) && ! grep -rniE "štr[a]jk\|strike" app/src/kiosk/timeline.ts app/src/city/next-departures.ts` | izlaz 0 (nijedan pogodak) | izlaz 0, nijedan pogodak (ponovljeno na stablu DR3) | prošlo |
| R1-12 | Produkcija nakon DR1 (DEV zaslon, deset minuta) | `node scripts/observe-production.mjs --minutes 10 --out review.local/reveal/observe-dr1` | on the DEV screen: the `departures` row green as cells, calm motion green, `rows[].kind` includes `departures` in every `rotation.jsonl` reading with `departures` 1 to 3 equal to `departuresOffered`; by day at Jelačić at least 2 non-transit rows in every reading (brief §6, read by hand for DR1) | promatranje `observe-DR1` (noć, 1. 10. u 02:16, DEV zaslon): `departures` crven u 1 od 300 očitanja (n 186 u 02:23:03: ćelija koja ulazi, očitana usred prijelaza od 220 ms; popravak alata DR1.1, `e56b36a4`), `calm-motion` zelen, svako očitanje ima retke `departures` s 3 ćelije, najmanje 4 retka koji nisu polasci; `phone-expiry` crven na DEV zaslonu, što nije greška (odluka 6, zatvorena u `5680f157`); dnevno očitanje (`review.local/strike/observe-1001-1230`, Trg bana J. Jelačića, 1. 10. od 12:30 do 12:42, produkcija `0e10141a`, 300 očitanja): najmanje 3 retka koji nisu polasci u svakom očitanju (obavijest, zatvaranje, baštinski redak; zalazak sunca u 248 očitanja, događanje u 24) | prošlo (noć i dan) |
| R2-1 | Dnevnik taktova jednog dana | `CI=1 npx vitest run test/app/takt.test.ts` | green; the beat log equals `test/fixtures/takt/beat-log.jsonl` (with `CI` set, a missing or changed snapshot fails instead of being written) | 28 testova u `takt.test.ts`; dnevnik taktova jednak `beat-log.jsonl` uz `CI=1`; 381 redak, 336 okretanja stranice i 15 pomaka | prošlo |
| R2-2 | Vremenska crta, rečenice, zaslon i dodir | `npx vitest run test/app/kiosk-timeline.test.ts test/app/kiosk-sentence.test.ts test/app/kiosk.test.ts test/app/kiosk-touch.test.ts test/app/wall-fit-0929.test.ts test/app/wall-strip.test.ts test/app/sentence-contract.test.ts` | green, including the R2 blocks of steps 3, 4, 7 | zeleno u skupu R2 na grani (16 datoteka, 1.007 testova); punim vratima DR2 (5.905 testova) | prošlo |
| R2-3 | Redak `reveal-cadence` u tablici promatrača | `npx vitest run test/scripts/observe-production.test.ts` | green; `reveal-cadence` in the table | zeleno (4 nova testa promatrača); redak `reveal-cadence` u tablici | prošlo |
| R2-4 | Katalog jezika i ključ `kiosk.nearby.zatim` | `npx vitest run test/app/i18n.test.ts test/app/i18n-keys.test.ts test/app/i18n-orphans.test.ts test/app/copy-guards.test.ts` | green; `kiosk.nearby.zatim` in both catalogues | zeleno; `kiosk.nearby.zatim` u oba kataloga („zatim”, „then”); listova 1.127 hr i 1.098 en | prošlo |
| R2-5 | Takt je čist (bez sata, DOM-a i slučajnosti) | `! grep -nE "Date\.now\|performance\.\|Math\.random\|document\.\|window\.\|localStorage" shared/kiosk/takt.ts` | no match (takt is pure) | izlaz 0, nijedan pogodak (takt je čist; ponovljeno na stablu DR3) | prošlo |
| R2-6 | Dnevnik taktova dodan jednom, svaka izmjena obrazložena | `git diff --stat <DR1 commit>..HEAD -- test/fixtures/takt/beat-log.jsonl` and `git log --format=%B -- test/fixtures/takt/beat-log.jsonl` | the log added once; every commit that touched it says why in its body | `git diff --stat e915e042..HEAD`: 1 datoteka, 381 umetanje; jedino `3e3f7736`, čije tijelo kaže kako je nastao | prošlo |
| R2-7 | Cijelo stablo | `npm run typecheck && npm run typecheck:tests && npm test` | green (integrated tree) | DR2: oba tipa 0 grešaka; 5.905 testova u 305 datoteka (`codex-DR2-unit.log`, `claude-DR2-verify.log`); proračuni prijenosa prema odluci 10 (vidi tablicu proračuna niže) | prošlo |
| R2-8 | Prihvaćanje (`npm run accept`) | `npm run accept` | green (integrated tree) | DR2: `npm run accept` 110 prošlo i isto dokumentirano crveno E=1, G=3, G_p95=75,40 m, H=611 m (`codex-DR2-accept.log`, odluka 5) | prošlo (dokumentirano crveno) |
| R2-9 | Prihvatna specifikacija zaslona: takt i proračun taktova | `npm run accept:e2e -- e2e/accept/wall.spec.ts` | every scene green, with the cadence and the beat budget in each scene's ten minutes and idle minute, and the `reveal` test green (integrated tree) | DR2: `accept:e2e` 32 od 32 pri prvom pokretanju (`codex-DR2-e2e.log`); vršna snimka devet stvarnih okretanja stranice bez neuspjeha takta; tri nova slučaja pomaka s tri polaska u svakom očitanju | prošlo |
| R2-10 | Produkcija nakon DR2 (DEV zaslon) | orchestrator, after the push, on the DEV screen: `URL=$(curl -s -X POST -H 'Origin: https://zagreb.aningfilm.hr' https://zagreb.aningfilm.hr/api/dev/screen \| jq -r .provisionUrl)` then `E2E_KIOSK_URL="$URL" nice npm run observe:production -- --stage d2 --surfaces kiosk --minutes 10 --max-load 4 --out review.local/reveal/observe-dr2` | `report.md`: `reveal-cadence`, `calm-motion`, `sentence-dwell`, `sentence-repeat`, `departures` green; see the reading below | promatranje `observe-DR2` (noć, 1. 10. u 04:07, DEV zaslon, Ritam 20): 2 od 59 crveno; `reveal-cadence` zelen s 0 okretanja i 0 pomaka u 300 očitanja (noćni popis je sav zaštićen, F-6), `departures` 3 od 3 u svakom očitanju, trajanje i ponavljanje rečenica zeleno, 0 trotočki; `calm-motion` crven u jednoj minuti (dva legitimna ponovna slaganja retka polazaka, 4 zapisa, nijedan čvor obnovljen): odluka 11, popravak alata DR2.1 (`7f0c736c`), bez novog promatranja; `phone-expiry` kao u odluci 6; dnevno očitanje (`review.local/strike/observe-1001-1230`, 12:30 do 12:42): 0 okretanja i 0 pomaka u 30 taktova, a `fitDropped` nije prazan ni u jednom od 300 očitanja (popis izostavlja gradske retke), pa pravilo čitanja R2-10 to bilježi kao nalaz (F-11): prva stranica rasporedivača bira se po broju i vrijednosti, a iscrtani popis po izmjerenoj visini, pa retci koje bi rasporedivač zamijenio nisu na zaslonu | prošlo uz odluku 11; dnevno: nije prošlo, nalaz F-11 |
| R3-1 | PNG, kalibracija radara i modul radara | `npx vitest run --maxWorkers=4 test/feed/png.test.ts test/scripts/radar-calibrate.test.ts test/feed/dhmz-radar.test.ts` | green; the committed calibration has `residualPx` ≤ 3, `residualMaxPx` ≤ 4, ≥ 8 landmarks | zeleno (18 testova); 12 oznaka, `residualPx` 1,57 (RMS), `residualMaxPx` 2,45; granice 3, 4 i najmanje 8 | prošlo |
| R3-2 | Biometeorološka prognoza, valovi, plin, programi | `npx vitest run --maxWorkers=4 test/feed/dhmz-bio.test.ts test/feed/dhmz-waves.test.ts test/feed/gpz.test.ts test/feed/prekidi.test.ts test/feed/programi.test.ts` | green | zeleno (70 testova na grani; 59 nakon popravaka parsera) | prošlo |
| R3-3 | Fixtureovi, registar, robots i putanje feeda | `npx vitest run --maxWorkers=4 test/feed/fixtures.test.ts test/feed/registry.test.ts test/feed/robots.test.ts test/integration/feed-to-layers.test.ts && npx vitest run --project workers test/feed/routes.workers.test.ts` | green; 17 modules; every module gives at least one item on its fixture | zeleno (165 testova plus 23 u projektu workers na grani; na vratima DR3 26 u workers); 17 modula, svaki daje barem jednu stavku na svom fixtureu | prošlo |
| R3-4 | Izvori dokumentirani | `npx vitest run --maxWorkers=4 test/docs/docs.test.ts test/docs/izvori.test.ts test/app/izvori.test.ts && npm run check:izvori` | green; "every module documented" | testovi zeleni (54); `npm run check:izvori` bio je crven na jednoj starijoj poveznici (Geofabrik, 404, odluka 12a), popravljeno u dokumentima (F-7): „All 45 URLs answer; every module documented.” | prošlo |
| R3-5 | Blagdani | `npx vitest run --maxWorkers=4 test/city/holidays.test.ts` | green | zeleno (24 testa) | prošlo |
| R3-6 | Obitelji rečenica u tri primjerka i katalog jezika | `npx vitest run --maxWorkers=4 test/app/copy-guards.test.ts test/app/sentence-contract.test.ts test/app/kiosk-sentence.test.ts test/kiosk/sentence-wire.test.ts test/app/i18n.test.ts test/app/i18n-keys.test.ts test/app/i18n-orphans.test.ts` | green; family count = DR2's + 6; leaves = DR2's + 14 in each language | zeleno (471 test); obitelji 35 + 6 = 41; listova 1.127 + 14 = 1.141 hr i 1.098 + 14 = 1.112 en | prošlo |
| R3-7 | Popis, vremenska crta, isječak radara, slojevi i dashboard | `npx vitest run --maxWorkers=4 test/app/kiosk-nearby.test.ts test/app/kiosk-timeline.test.ts test/app/wall-render-inventory.test.ts test/app/kiosk-local.test.ts test/app/kiosk.test.ts test/app/layers.test.ts test/app/dashboard.test.ts test/app/takt.test.ts` | green; `takt.test.ts` unchanged by R3 | zeleno (750 testova nakon regeneracije popisa); `takt.test.ts` nepromijenjen | prošlo |
| R3-8 | Radar nije u javnom katalogu `/open` | `grep -c "'dhmz-radar'" worker/open/catalog.ts; git diff --stat <DR2 commit>..HEAD -- worker/open/catalog.ts` | `0`; no output | 0; `git diff --stat c1b0ea56..HEAD -- worker/open/catalog.ts` bez izlaza (popravak testa `3ace5961` ne dira katalog) | prošlo |
| R3-9 | Tipovi | `npm run typecheck && npm run typecheck:tests` | exit 0 | 0 grešaka | prošlo |
| R3-10 | Artefakti i cijelo stablo (integrirano stablo) | (integrated tree, orchestrator) `node scripts/check-artefacts.mjs` and `npm test` | green (brief §6 DR3) | `node scripts/check-artefacts.mjs` zeleno (`codex-DR3-artefacts.log`); `npm test` 6.108 prošlo nakon ispravka zastarjele tvrdnje o otvorenoj razini (`3ace5961`), orkestrator 6.110 u 313 datoteka (`claude-DR3-verify.log`) | prošlo |
| R3-11 | Produkcija nakon DR3: slika radara i teaser | (production after DR3, orchestrator) `curl -sS -D - -o /tmp/zg.png https://zagreb.aningfilm.hr/api/radar/zagreb.png \| grep -iE "^(content-type\|cache-control\|x-attribution):"` and `curl -s https://zagreb.aningfilm.hr/api/teaser \| node -e 'const m=JSON.parse(require("fs").readFileSync(0,"utf8")).modules;const r=m.find(x=>x.module==="dhmz-radar");console.log(r.status,r.items[0]?.id,r.items[0]?.data);process.exit(r.status==="live"&&r.items.length===1?0:1)'` | `image/png`, `public, max-age=300`, `Izvor: DHMZ`; the teaser's radar module live with one item; `/izvori` lists the three modules and GPZ (brief §6 DR3) | 1. 10. u 06:17: `image/png` 120 × 120 (7.158 B), `public, max-age=300`, `Izvor: DHMZ`; `dhmz-radar` live s jednom stavkom (`rainNear` false, suho jutro), `dhmz-bio` live s dvije stavke, `dhmz-waves` live bez stavke (izvan sezone), `prekidi` live s 24 stavke | prošlo |
| R4-1 | Prikazane činjenice na fixtureu | `npx vitest run --maxWorkers=4 test/scripts/shown-facts.test.ts && node scripts/shown-facts.mjs test/fixtures/observe/rotation-sample.jsonl \| tail -1` | green; `Fewest non-transit facts: 2026-10-01 13:00 (4).` | zeleno (10 testova); `Fewest non-transit facts: 2026-10-01 13:00 (4).` | prošlo |
| R4-2 | Redak `shown-facts` promatrača i sonda radara | `npx vitest run --maxWorkers=4 test/scripts/observe-production.test.ts test/e2e/wall.test.ts && grep -c "'shown-facts'" scripts/observe-production.mjs` | green; `1` | zeleno (promatrač, sonda zaslona); `grep -c` daje 1 | prošlo |
| R4-3 | Redak `shown-facts` je praćen, nije prag | `grep -n "monitored" scripts/observe-production.mjs \| head -3 && node -e "import('./scripts/observe-production.mjs').then(m=>{const r=m.THRESHOLDS.find(t=>t.id==='shown-facts');process.exit(r&&r.monitored===true&&r.min===6?0:1)})"` | exit 0 | izlaz 0 (`monitored` true, `min` 6) | prošlo |
| R4-4 | Dokumenti navode stvarne naredbe, brief povezan s README-om | `npx vitest run --maxWorkers=4 test/docs` | green (every command a document cites exists; the brief is linked from the README) | zeleno (4 datoteke, 71 test); svaka navedena naredba postoji, brief je povezan iz README-a | prošlo |
| R4-5 | Bez crtice i zabranjenih riječi u novom tekstu dokumenata | `git diff <DR2 commit>..HEAD -U0 -- docs README.md \| grep '^+' \| grep -v '^+++' \| grep -cP '\x{2014}'; git diff <DR2 commit>..HEAD -U0 -- docs README.md \| grep '^+' \| grep -v '^+++' \| grep -ciP '\bzid\|štr[a]jk\|\x{2026}'` (U+2014 is the em dash, U+2026 the ellipsis character) | `0`; `0` | `0`; `0` (razlika od `c1b0ea56`, dijela A i B) | prošlo |
| R4-6 | Bilješka na /prijava/, predani tekstovi bajtno isti (dio B) | (part B) `npm run build:prijava && npx vitest run --maxWorkers=4 test/docs/prijava.test.ts && git diff --stat 4b2d1191..HEAD -- docs/prijava/prijedlog-projekta.md docs/prijava/prijedlog-projekta.html docs/prijava/prijedlog-projekta.docx docs/prijava/obrazac-2-2.md docs/prijava/obrazac-3-financijski-plan.md docs/prijava/plan-provedbe.md docs/prijava/rizici-i-odgovori.md` | green; the `git diff --stat` prints nothing | `npm run build:prijava` i `test/docs/prijava.test.ts` zeleni (17 testova); `git diff --stat 4b2d1191..HEAD` za sedam predanih datoteka bez izlaza; u `docs/prijava` samo bilješka u `razvojne-biljeske.md` | prošlo |
| R4-7 | README, odjeljak prihvaćanja i `shown-facts.mjs` u dokumentu zaslona (dio B) | `grep -c "Fourteen feed modules" README.md; grep -c "Seventeen feed modules" README.md; grep -c "](docs/reveal-2026-10.md)" README.md; grep -c "^## Prihvaćanje, prolaz otkrivanja 2026-10" docs/kaj-verification.md; grep -c "shown-facts.mjs" docs/kiosk.md` | `0`, `1`, `1`, `1`, ≥ `1` | `0`, `1`, `1`, `1`, `1` | prošlo |
| R4-8 | Tipovi | `npm run typecheck && npm run typecheck:tests` | exit 0 (part A in `wt/R4`; part B on the integrated tree) | oba izlaza 0 na integriranom stablu (dio B) | prošlo |
| R4-9 | Popis mjesta iscrtavanja, katalog jezika (dio B) | (part B, integrated tree) `npx vitest run --maxWorkers=4 test/app/wall-render-inventory.test.ts test/app/i18n-orphans.test.ts test/app/i18n.test.ts` | green after the regeneration of B5 | zeleno (3 datoteke, 24 testa); regeneracija `-u` popisa mjesta iscrtavanja ne mijenja `test/fixtures/wall-render-sites.txt`; listova 1.141 hr i 1.112 en, oslonac nije bio pomaknut | prošlo |
| R4-10 | Produkcija nakon DR3, prikazane činjenice (orkestrator) | (orchestrator, after the DR3 push) the recipe of §0.3 D-D at 12:30 or 18:00, else at push time | `observe:production` exit 0 on every applied row; `shown-facts.md` for the hour reads at least 6 non-transit rows (monitored: a lower value is recorded, not a red deploy) | `observe-DR3` (jutro, 1. 10. u 06:15, DEV zaslon): 0 od 58 primijenjenih redaka crveno; `shown-facts` 4 retka u satu 06:00 (praćeno, ispod 6); dnevno očitanje (`review.local/strike/observe-1001-1230`, Trg bana J. Jelačića, 1. 10. od 12:30 do 12:42, produkcija `0e10141a`, 300 očitanja, svaki primijenjeni prag zelen): `shown-facts` 6 različitih redaka koji nisu polasci u satu 12:00 (5 bez obećanja; 13 činjenica rečenice, 4 ne o prometu) | prošlo (praćeno: 6 od 6; jutarnje očitanje 4) |
| R4-11 | KPI nakon listopadske nadogradnje (dio C) | (part C, after 3 Oct) C1, then `node scripts/thin-spot.mjs review.local/companion/data-calendar --from 2026-10-01 --hours 48 --json review.local/upgrade/kpi/after.json > review.local/upgrade/kpi/after.md && node -e "const s=require('./review.local/upgrade/kpi/after.json').summary;process.exit(s.minDay>=1&&s.minEvening>=1&&s.dayMedian>=3&&s.eveningMedian>=3&&s.cityPerDayMedian>=30?0:1)"` | the numbers recorded whatever the exit code; U3-9 graded by it |  |  |

### Isporuke DR1 do DR3

| Isporuka | Commit | Objava (Zagreb) | Vrata (npm test, accept, accept:e2e) | Promatranje | Ocjena |
|---|---|---|---|---|---|
| DR1 | `e915e042` (DR1.1 `e56b36a4`, samo alat) | 1. 10. 2026. 02:14 (DR1.1 u 02:58) | `npm test` 5.808 (orkestrator 5.813), `npm run accept` 110 i dokumentirano crveno (E=1, G=3, G_p95=75,40 m, H=611 m), `accept:e2e` 28 od 28 | `observe-DR1`, noć 02:16: 2 od 58 crveno (`departures` u 1 od 300 očitanja, popravak DR1.1; `phone-expiry` na DEV zaslonu, odluka 6) | prošlo uz DR1.1 |
| DR2 | `c1b0ea56` (DR2.1 `7f0c736c`, samo alat) | 1. 10. 2026. 04:06 (DR2.1 u 04:45) | `npm test` 5.905, `npm run accept` 110 i isto dokumentirano crveno, `accept:e2e` 32 od 32 | `observe-DR2`, noć 04:07: 2 od 59 crveno (`calm-motion`, dva legitimna ponovna slaganja retka u jednoj minuti, odluka 11, DR2.1; `phone-expiry`) | prošlo uz DR2.1 |
| DR3 | `266f269d` | 1. 10. 2026. 06:13 | `npm test` 6.108 (orkestrator 6.110), `npm run accept` 110 i isto dokumentirano crveno, `node scripts/check-artefacts.mjs` zeleno, `accept:e2e` 35 od 35 | `observe-DR3`, jutro 06:15: 0 od 58 crveno | prošlo |

### Proračuni prijenosa nakon prolaza

Proračuni prijenosa (gzip, bajtovi) nisu zadovoljeni u izvornom iznosu: prije prolaza `/kiosk/` je bio na 199.405 od 200.000, a prolaz stavlja na prvi iscrtani zaslon raspoređivač, otkrivanja i redak polazaka. Granice su zato podignute dvjema izričitim odlukama (10 i 16) tek nakon jednog izmjerenog lijenog razdvajanja kôda koji prvi prikaz ne treba; ostale granice se nisu mijenjale.

| Površina i mjera | Prijašnja granica | Izmjereno | Nova granica | Odluka i commit |
|---|---|---|---|---|
| `/kiosk/`, početak | 200.000 | 204.390 na integriranom DR1, 202.172 na integriranom DR2; 201.260 nakon razdvajanja dodira | 210.000 | odluka 10, `8709bdab` (razdvajanje), `5ea43e4f` (granica) |
| `/kiosk/`, otvorena karta | 600.000 | 602.265 na integriranom DR2; 603.030 uključujući odgođene bajtove dodira | 620.000 | odluka 10, `5ea43e4f` |
| `/d/`, otvorena karta | 600.000 | 601.789 na integriranom DR3; 601.643 odmah, 603.102 s odgođenim bajtovima nakon razdvajanja lista sjednice | 620.000 | odluka 16, `955c70f4` (razdvajanje), `fe1de0e5` (granica) |

### Prikazane činjenice (scripts/shown-facts.mjs)

Skripta `node scripts/shown-facts.mjs <mapa promatranja>` čita `rotation.jsonl` promatranja i po satu (zagrebsko vrijeme) broji različite retke popisa koji nisu polasci, to jest svih vrsta osim `departure` i `departures`; to je broj koji provjera DR3 čita (najmanje 6 u satu). Rečenice zaglavlja i otkrivanja navode se uz njega i nikad mu se ne pribrajaju, jer su redak i njegova rečenica obično ista činjenica; stupac „Bez obećanja” isključuje retke `first`, `last`, `notice` i `rail`.

| Promatranje | Mjesto, vrijeme | Očitanja | Retci koji nisu polasci | Bez obećanja (first, last, notice, rail) | Činjenice rečenice | Otkrivanja |
|---|---|---|---|---|---|---|
| `observe-2026-09-25-d527` (prije obje nadogradnje) | Trg bana J. Jelačića, 25. 9. 2026. 17:55 do 18:08, večer | 300 | 6 u promatranju: 4 u satu 17:00, 5 u satu 18:00 (always, closure, solar) | 4 u satu 17:00, 5 u satu 18:00 | 8 različitih (2 ne o prometu) u satu 17:00, 10 (1) u satu 18:00 | nijedno |
| `observe-DR3` (DEV zaslon) | Trg bana J. Jelačića, 1. 10. 2026. 06:15 do 06:27, jutro | 300 | 4 u satu 06:00 (always 2, closure 1, notice 1) | 3 | 13 različitih, 5 ne o prometu (među njima `hourlyTemp`) | nijedno |
| `observe-1001-1230` (produkcija `0e10141a`; mapa `review.local/strike/observe-1001-1230`) | Trg bana J. Jelačića, 1. 10. 2026. 12:30 do 12:42, dan | 300 | 6 u satu 12:00 (always 2, closure 1, event 1, notice 1, solar 1) | 5 | 13 različitih, 4 ne o prometu (među njima `hourlyTemp` i `closureUntil`) | nijedno |

Mjerenja su alatom `node scripts/shown-facts.mjs <mapa promatranja> --json <datoteka>` (JSON u `review.local/reveal/observe-DR3/shown-facts.json` i `review.local/reveal/analysis/shown-facts-before.json`). Jutarnje očitanje DR3 (4) bilo je ispod 6 koje provjera DR3 traži za 12:30 ili 18:00 i nije usporedivo s večernjim očitanjem od 25. rujna (tijekom kratkog promatranja 6, od toga 4 u satu 17:00 i 5 u satu 18:00): u svakom očitanju stoje obavijest, jedno zatvaranje i jedan bezvremenski redak; tijekom promatranja izmijenila su se dva identifikatora bezvremenskog retka, pa su ukupno četiri različita identifikatora; otkrivanja nema. Redak je samo praćen, pa niža vrijednost je zapisana, ne crvena isporuka; broj koji vrijedi daje dnevno očitanje u 12:30 (6, u tablici), koje ispunjava 6 iz briefa.

### KPI nakon listopadske nadogradnje

`node scripts/thin-spot.mjs review.local/companion/data-calendar --from 2026-10-01 --hours 48 --json review.local/upgrade/kpi/after.json > review.local/upgrade/kpi/after.md`, zatim usporedba s pragovima retka U3-9 (`minDay` najmanje 1, `minEvening` najmanje 1, `dayMedian` najmanje 3, `eveningMedian` najmanje 3, `cityPerDayMedian` najmanje 30): na čekanju.

## Prihvaćanje, snimka 2026-10

Prihvaćanje prolaza za stranicu `/snimka/` iz `docs/snimka-2026-10.md` (odjeljak 10, redci SN-1 do SN-14; drugi prolaz, redci SN-15 do SN-24, u odjeljku 14.5; treći prolaz, redci SN-25 do SN-30, u odjeljku 15.4 i niže) na jednom mjestu, u istom obliku kao za nadogradnju i za prolaz otkrivanja: za svaki redak mjera, naredba, prag, izmjerena vrijednost i ocjena. Naredbe i pragovi preuzeti su iz tog odjeljka bez promjene (pragovi ostaju na izvornom jeziku), a prag se ne prilagođava izmjerenom, pa crveni redak ostaje crven dok vrijednost ne dosegne prag. Stupci „Izmjereno” i „Ocjena” pune se nakon objave, iz zapisa u `review.local/snimka/run/logs/` i iz izvještaja u `review.local/snimka/run/reports/`; do tada u njima piše „na čekanju”. Redak SN-14 traži produkciju: izvodi se samo čitanjem, nakon objave, jednim prolazom preglednika, i nikad ga ne pokreće agent iz paketa. Ručne provjere na uređaju iz tablice „Ručne provjere na uređaju” gore ostaju kakve jesu; njezin zadnji redak, vlasnikovo čitanje svakog novog hrvatskog teksta, vrijedi i za sve stranice ovog prolaza (popis rečenica stoji u izvještajima paketa S0 do S4).

| Redak | Mjera | Naredba | Prag | Izmjereno | Ocjena |
|---|---|---|---|---|---|
| SN-1 | Niz po minutama prema snimkama | `node scripts/snimka/build.mjs --stage verify` | `seen.all` at most 6 at Mon 03:00 and at least 200 at Wed 20:30; replayed state `silent` at every judged minute from Mon 04:30 to Wed 18:00; `reduced` first at Wed 19:05 ± 3 min; `normal` first between Wed 20:15 and 20:30; `published.vehicles` 5 at Mon 19:27 with `feed.entities` 0; the day's highest `bikes.empty` on Wed at least 100; `expected.all` never null | seen.all 0 u pon 03:00 i 234 u sri 20:30; 3.038 od 3.038 procijenjenih minuta `silent`; prvo `reduced` sri 19:03; prvo `normal` sri 20:16; objavljeno 5 uz 0 entiteta u pon 19:27; najviše praznih stanica u sri 126; `expected.all` bez praznih minuta | prošlo |
| SN-2 | Veličina pokretnog dijela | isto kao SN-1 | every chunk at most 150,000 bytes gzip; at least 300 vehicles in the 24 Sep chunk of 12:00 | najveći komad 32.025 B gzip (24. 9. u 07:20), nijedan iznad praga; 326 vozila u komadu 24. 9. u 12:00 | prošlo |
| SN-3 | Usporedni dan je običan | isto kao SN-1 | no judged minute of 24 Sep `reduced` or `silent` | 0 od 1.202 procijenjene minute | prošlo |
| SN-4 | Ugovor, kodiranje i natrag | `npx vitest run test/snimka` | green | zeleno (u punom paketu 1. 10.) | prošlo |
| SN-5 | Podrijetlo naslova | `node scripts/snimka/build.mjs --stage news` | every curated link found in the recordings | 65 od 65 odabranih poveznica pronađeno u snimkama (Jutarnji 22, Večernji 23, N1 20) | prošlo |
| SN-6 | Snimke zaslona su maskirane | dnevnik stupnja `captures` | a located and blurred code in every kiosk capture, or the capture is named in the log and checked by eye | 60 od 60 kodova pronađeno i zamućeno zajedno s cijelom karticom za uparivanje; nijedna snimka za ručnu provjeru | prošlo |
| SN-7 | Ruta | `npx vitest run --project workers test/snimka` | headers per §7; 404 for `..`, `.pb` and anything outside the prefix | zeleno, 54 testa | prošlo |
| SN-8 | Logika stranice | `npx vitest run test/app/snimka-*.test.ts` | green | zeleno, 318 testova | prošlo |
| SN-9 | Pozornica u pregledniku | `npx playwright test e2e/snimka-stage.spec.ts` | green | zeleno, 12 od 12 | prošlo |
| SN-10 | Izvještaj u pregledniku | `npx playwright test e2e/snimka-report.spec.ts` | green, including axe in both themes and no horizontal overflow at 360 px | zeleno, 11 od 11 (snimanje zaslona za pregled preskočeno); axe za `/snimka/` 4 od 4 | prošlo |
| SN-11 | Proračuni prijenosa | `npx vitest run test/app/budget.test.ts` | the `/snimka/` rows of §8 | 15 od 15; ulaz oko 33 KB gzip, otvorena karta oko 500 KB gzip, bez integratora | prošlo |
| SN-12 | Tekst | `npx vitest run test/app/snimka-strings.test.ts test/app/copy-guards.test.ts` | green | zeleno | prošlo |
| SN-13 | Predana stranica je ponovna gradnja | `npx vitest run test/docs/prijava.test.ts` | green | zeleno | prošlo |
| SN-14 | Produkcija | `curl -sI https://zagreb.aningfilm.hr/api/snimka/v1/manifest.json` i prolaz preglednikom samo čitanjem | 200 with the manifest's cache headers; the page plays on the real dataset in both themes at 1366 and 390 px | objavljeno 1. 10. 2026. u 7b0f00d0 (skup v1 767 od 767 na R2, manifest 200 s-maxage=300); 2. 10. 2026. v1 manifest i dalje 200, tjedan dana uz v2 | prošlo |
| SN-15 | Razdoblje i obični dani (cjevovod) | `node scripts/snimka/build.mjs --stage verify` | window `n` 6720 and `expected.all` never null; `seen.all` at least 300 at Thu 1 Oct and Fri 2 Oct 07:45 (Thu measured 338); no judged `reduced` or `silent` minute from Thu 00:00 to the end; `feed.frozen` minutes Mon 05:03 to 05:46 at least 40 and at most 5 on 24 Sep | verify 38 od 38: n 6720, expected.all bez null; u 07:45 čet 338, pet 376 vozila; nijedna prosuđena minuta smanjeno ili bez vozila od čet 00:00; zamrznuto pon 05:03 do 05:46 ≥ 40 min, 24. 9. ≤ 5 | prošlo |
| SN-16 | Linije, glas i table (cjevovod) | the same | routes `n` 1344 and at least 100 routes; route 6 `expected` above 0 at Mon 07:45; route 17 `seen` at least 1 at Thu 07:45; day files `n` 288; the voice covers every window minute, Mon 07:45 leads with fact `service:zet`, Thu 07:45 has a `dep:` fact, no sentence matches /štrajk/i; eight boards with at least 1,000 samples each | verify 38 od 38: routes n 1344, 154 linija (19 tramvajskih); linija 6 očekivano > 0 u pon 07:45; linija 17 viđena u čet 07:45; dani n 288; glas 6720 od 6720 minuta, bez „štrajk” | prošlo |
| SN-17 | Preuzimanja, mjesta, usporedni dani, komadi (cjevovod) | the same | row counts: series 6,721, hourly 113, routes 1,344 × routes + 1, bikes 1,345 rows × 202 columns; every `focus` and `mentions` id resolves; places within 15.8 to 16.2 E and 45.7 to 45.95 N; both comparison chunks of 12:00 at least 300 vehicles; `pon-0921` 0 null minutes; `cet-0924` exactly 120; every chunk at most 150,000 bytes gzip and at least 900 chunks | verify 38 od 38: series 6.721, hourly 113, routes-5min 206.977 redaka, bikes 1.345 × 202; svi focus i mentions id-ovi; 12 mjesta; 8 tabli; komadi 922, najveći 32.449 B gz | prošlo |
| SN-18 | Ugovor, ruta i katalog | `npx vitest run test/snimka` and `npx vitest run --project workers test/snimka test/open` | green: v1 and v2 prefixes, v3 declines, csv and geojson types with `immutable`, the alias 302 with its headers, 404 for an unknown name, HEAD, `.pb` and `..` refused; five datasets in the catalogue and the Arhiva card | test/snimka 128 jedinica zeleno; workers test/snimka + test/open 123 od 123 (v1 i v2, v3 odbija, csv i geojson, alias 302, katalog 5 skupova) | prošlo |
| SN-19 | Logika stranice | `npx vitest run test/app/snimka-*.test.ts` | green, including the live-state diff at under 2 ms for 150 routes and 2,525 stops, the director, the subject round trip, the panel deck, the heatmap means, the live card states (timeout and malformed JSON included) and facts that never read 0 for null | test/app/snimka-*.test.ts zeleno (integrirano 1.356 jedinica); živa mreža + razlika 0,5 ms po uzorku | prošlo |
| SN-20 | Instrument u pregledniku | `E2E_PORT=<port> npx playwright test e2e/snimka-stage.spec.ts` | green: `data-sn-alive` 2 at Mon 07:45 and at least 3 at Tue 12:00; at 1 h/s `data-sn-drawn` 0 and `data-sn-alive` above 0; the chapter linija-228 moves `data-center` east; a line click sets `&linija=` and expands Linije; Escape twice returns to the overview; the feed lists items in time order; the phone deck snaps and the page does not overflow at 360 px | snimka-stage.spec 21 od 21 (V3); četiri snimka specifikacije integrirano 44 od 44 | prošlo |
| SN-21 | Dosje u pregledniku | `E2E_PORT=<port> npx playwright test e2e/snimka-report.spec.ts` | green: five morning pictures loaded, downloads listed from the manifest, live card numbers on the normal stub and "nije dostupno" on the down stub; axe clean in both themes at 390 and 1366 px, with and without an expanded panel | snimka-report.spec 12 od 12 (V5); integrirano 44 od 44 | prošlo |
| SN-22 | Proračuni prijenosa | `npx vitest run test/app/budget.test.ts` | entry graph under 200,000 bytes gzip, open-map graph under 620,000; `minimap.ts` and `live-network.ts` not on the entry graph | ulazni graf 51.895 B gz, graf s kartom 518.545 B gz; minimap.ts i live-network.ts izvan ulaznog grafa; budget 15 od 15 | prošlo |
| SN-23 | Tekst i dokumenti | `npx vitest run test/app/snimka-strings.test.ts test/app/copy-guards.test.ts test/docs`, `npm run check:izvori` | green; no em dash, no `zid`, no `simul`; "štrajk" only in `narration.*`, `sources.*` and `events.json` | strings 471 listova, copy-guards i test/docs zeleno; check:izvori 48 URL-ova odgovara | prošlo |
| SN-24 | Produkcija | `curl -sI https://zagreb.aningfilm.hr/api/snimka/v2/manifest.json`, `curl -sI https://zagreb.aningfilm.hr/api/snimka/v2/exports/latest/series.csv`, `curl -s https://zagreb.aningfilm.hr/open/catalog.json` and a read-only browser pass | 200 with the manifest's cache headers; the alias answers 302 to a hashed path that answers 200 `text/csv`; the catalogue lists five datasets; the page plays on the real dataset in both themes at 1366 and 390 px | 2. 10. 2026. nakon SN2 (e47c1dc9): v2 manifest 200, cache-control public, max-age=60, s-maxage=300, CORS *; exports/latest/series.csv 302 na series.c9750d8d6463b04a.csv, zatim 200 text/csv immutable s content-disposition; /open/catalog.json 5 skupova (snimka-2026-09; rubna predmemorija jednog sata još nosi stari odgovor); v1 manifest 200; stranica se učitava s novim sklopovima (snimka-DVtteeUn.js), instrument iscrtan, bez pogrešaka stranice | prošlo |
| SN-25 | Tri ispravljene brojke | `npx vitest run test/app/snimka-reckoning.test.ts test/app/snimka-alternatives.test.ts` | upozorenja tijekom štrajka = 0 (najviše po minuti u prozoru štrajka; petak 2. 10. imenovan zasebno); linije = 8 na pravoj datoteci linija od pon 03:30 do sri 18:00; naslov duhova „7 umjesto 2” samo iz minuta štrajka; poredak `emptyHoursVsThu` | na čekanju | na čekanju |
| SN-26 | Roj običnog dana i BAJS (sonde) | `E2E_PORT=<port> npx playwright test e2e/snimka-map.spec.ts` | pon 07:45 `data-sn-ghosts` > 300 i `data-sn-drawn` = 2; uto 12:00 `data-sn-glyphs` = pills; čet 07:45 pri 600× = dots; `data-sn-bajs` pokazuje anomalije > 0 u pon 09:00 i 0 u čet 09:00; nema `data-sn-alive` ni čipa zatvorenih ulica; pri 1 h/s samo BAJS | na čekanju | na čekanju |
| SN-27 | Pet čipova i ploče | `E2E_PORT=<port> npx playwright test e2e/snimka-stage.spec.ts e2e/snimka-voices.spec.ts` | navigacija ima pet čipova i nema gumba s pitanjima; tri lica ploča, Enter širi na mjestu bez promjene redoslijeda, „Zatvori” zatvara; red na telefonu počinje na `scrollLeft 0` s Mrežom prvom; Objave imaju trenutačnu stavku i popis s naslovom poglavlja, klik traži vrijeme, filtar „Samo linija 228” i „Prikaži sve”; podnaslov se mijenja najviše jednom u 2,5 s tijekom 10 s samopokretanja; raspon trake je preko trake flote; vrh instrumenta je najmanje 61 px ispod vrha prozora nakon traženja iz pločice | na čekanju | na čekanju |
| SN-28 | Nijedan sadržaj odrezan pri 390 | `E2E_PORT=<port> npx playwright test e2e/snimka-report.spec.ts` | nema vodoravnog preljeva pri 360 i 390 px i `scrollWidth ≤ clientWidth` za svaki `[data-sn-mount]`; axe čist u obje teme pri 390 i 1366 px s raširenom pločom; Zaslon pokazuje dva retka i tablicu od pet redaka; Podaci i izvori tri glavna preuzimanja i `<details>` sa šest; vrpca I danas oba retka na normalnom stubu i „nije dostupno” na srušenom | na čekanju | na čekanju |
| SN-29 | Podaci i izgradnja | `node scripts/snimka/build.mjs --stage verify`, `node scripts/snimka/upload.mjs --only-changed --dry-run`, `npx vitest run test/snimka test/open` | verify 38 od 38 s unosom `court` u atribuciji manifesta; prijenos šalje promijenjene objekte i manifest zadnji; katalog ima pet skupova, arhivski skup devet datoteka | na čekanju | na čekanju |
| SN-30 | Produkcija | `curl -s https://zagreb.aningfilm.hr/api/snimka/v2/manifest.json`, `curl -s https://zagreb.aningfilm.hr/open/catalog.json` i prolaz preglednikom samo čitanjem (`review.local/snimka/observe-SN3/`) | manifest s atribucijom suda i ZET-ovom rečenicom doslovno; katalog s pet skupova i devet datoteka arhive; stranica se učitava s novim sklopovima; roj, BAJS sloj, pet čipova i Objave vide se u obje teme pri 1366 i 390 px; nijedan sadržaj odrezan | na čekanju | na čekanju |

### Drugi prolaz snimke, 2. listopada 2026.

Redci SN-15 do SN-24 dolaze iz odjeljka 14.5 u `docs/snimka-2026-10.md` (drugi prolaz: skup v2, instrument, preuzimanja i katalog) i imaju isti oblik i ista pravila kao SN-1 do SN-14: naredbe i pragovi preuzeti su bez promjene, a „Izmjereno” i „Ocjena” pune se nakon objave, iz zapisa u `review.local/snimka/run/` i iz izvještaja traka u `review.local/snimka/run/reports/v2/`. Redak SN-24 traži produkciju i izvodi se samo čitanjem, nakon objave. Redak SN-14 (adresa `/api/snimka/v1/`) ostaje kakav jest, a v1 se poslužuje još tjedan dana nakon objave.

### Treći prolaz snimke, 2. listopada 2026. navečer

Redci SN-25 do SN-30 dolaze iz odjeljka 15.4 u `docs/snimka-2026-10.md` (treći prolaz: čišćenje stranice, roj običnog dana, BAJS sloj, pet čipova, tri ispravljene brojke) i imaju isti oblik i ista pravila kao prethodni: naredbe i pragovi preuzeti su bez promjene, a „Izmjereno” i „Ocjena” pune se nakon objave, iz zapisa u `review.local/snimka/run/` i iz izvještaja traka u `review.local/snimka/run/reports/v3/`. Redak SN-30 traži produkciju i izvodi se samo čitanjem, nakon objave.

Ručne provjere koje ne može dokazati preglednik (tri iz drugog prolaza, dvije iz trećeg); rezultat se upisuje s uređajem, preglednikom i datumom, a prazna ćelija znači da provjera još nije provedena.

| # | Provjera | Uređaj | Preglednik | Datum | Rezultat |
|---|---|---|---|---|---|
| R-SN1 | Pet jutara (pon do pet u 07:45) učitano u pravom pregledniku: slike zaslona vide se u prikazu, nijedna nije prazna, rečenice odgovaraju | Chromium na produkciji 2. 10. 2026. | pet slika complete, 1280 px široke, od prvog čitanja; tri izračunane rečenice stižu unutar 12 s | prošlo | rečenice ostalih dana učitavaju se naknadno (kratki kostur) |
| R-SN2 | Deset minuta pasivnog igranja u načinu cijelog zaslona na 1920 px: podnaslov ne treperi, popis glasova se ne preplavi, karta sama prelazi na mjesto događaja | | | | |
| R-SN3 | Vlasnikovo čitanje novih hrvatskih tekstova drugog prolaza i odabranih datoteka (`review.local/snimka/run/checkpoints/read-through-v2.md`): rečenice stranice, četiri nova događaja, imena mjesta, tekstovi kataloga | | | | |
| R-SN4 | Vlasnikovih deset pasivnih minuta u načinu cijelog zaslona na 1920 px s običnim danom uključenim: podnaslov se ne mijenja češće od svake 2,5 s, kamera ne skače, BAJS se čita kao prelijevanje od pune do prazne bez brojeva pri 10 min/s, roj običnog dana vidi se ispod vozila | | | | |
| R-SN5 | Vlasnikovo čitanje svih tekstova trećeg prolaza (`review.local/snimka/run/checkpoints/read-through-v3.md`): tekstovi stranice po ključu, tekstovi događaja, atribucija i napomene manifesta | | | | |
