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
  i kad je kopija zastarjela; Večeras su redovi s tankim crtama, sljedeći s
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
dvanaest minuta nakon objave; to je prvi pogled, a ne mjerenje od 24 h koje redci traže.

| Provjera | Kako | Rezultat |
|---|---|---|
| Objava | Workers Builds na `git push` u `main` | uspješno: gradnja `9b37f978`, inačica `225e2715`, objavljena 04:28 UTC; `/api/health` odgovara `{"ok":true}` |
| Blizanac otkucava | `/stats`: `twin_tick` po ishodu (`ok`, `unchanged`, `error`, `stale_index`) i startu (`cold`/`warm`) nakon 24 h; udio hladnih startova govori koliko se objekt izbacuje između alarma | prvih 12 min: 117 otkucaja, 65 `ok` i 52 `unchanged`, 0 `error`, 0 `stale_index`; 1 hladan i 116 toplih, dakle objekt ostaje u memoriji i lanac alarma ne prekida se. **Mjerenje od 24 h još predstoji.** |
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

### Redci ocjenjivača i simulacija klijenta (F7)

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
duljine tramvaja (35 m, `HEADWAY_M` iz `shared/motion/laws.ts`; bliži par nema redoslijed koji
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
  planira po vlastitoj geometriji umjesto po tuđoj, pa se svi redci pomiču za pola postotka do
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
  isti u svim redcima: sedam planova koji su vozili 1,5 do 2,7 km oko ugla koji tramvaj ne vozi
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
datoteke `shared/motion/order.ts`. Svi redci koji mjere blizanca zato moraju biti — i jesu —
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
  redci su identični do znamenke; p50 raste jer u istom procesu, između otkucaja, sada radi skuplja
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

## Javni zaslon Prozor (16. 9. 2026.)

Plan `C:/Users/MatijaRadeljak/.claude/plans/observe-the-layout-and-valiant-fiddle.md`, grana i
radna stabla `kiosk-prozor` / `kp-P1`…`kp-P4`, odluke i tumačenja u
`.superpowers/sdd/2026-09-16-kiosk-prozor/rulings.md` (R-KP1 do R-KP23). Val A gradi u
četiri usporedna radna stabla; ovaj odjeljak opisuje protokol provjere koji vlasnik čita nakon
spajanja (val B) -- brojke i snimke iz vala A same po sebi nisu dovoljne jer ni jedno radno
stablo samo ne vidi cijeli sastavljen zaslon. Rezultati ispod izmjereni su u valu B (16. 9. 2026.,
grana `kiosk-prozor`, izvještaj `task-WB-report.md`); redci označeni „proizvodnja” popunjavaju se
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
| 390 × 844 | telefon, koji je nekad dobivao zid |

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
nudi zadnji polazak kao treću, koju na 1080p zidu ta dvoredna vrijednost skriva, dok je
1920 × 1200 i telefon pokazuju. Zamrznuti sat (`page.clock`) ostavlja vozila bez svježih
očitanja, pa ih kadar nakon 20 h ne crta -- artefakt alata, ne zaslona. Iznad nacrtanih veličina
imena ulica prelaze osam (9 na 2560, 15 na 4K): razmak imena (R-KP17) izmjeren je na nacrtanom
polju, a veće polje nosi više imena.

### Provjera na 3 metre

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
naslovi izjava (PROMET, ZATVORENO), kontekstni redci, imena ulica i atribucija ne natječu se s
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
pokazuje preko zidnog (`labelPadding` u `kiosk/mapview.ts`, 48 umjesto 24 pločastih piksela na
totemu, 24 na zidu), čime je vlastito slaganje profila prije pločica vozila palo na 3 imena uz
zidnih 6--8 (mjereno 16. 9. 2026.). Razmak sidara (`symbol-spacing`) nije poluga za taj broj: MapLibre
sidri svaku cestu jednom po pločici bez obzira na razmak (360, 473, 745 i 1100 dali su isto 7--8
imena na totemu).

**Rezultat (val B):** `gate.sh unit` -- `UNIT STAGES PASSED` (`gate-logs/gate-20260916-171723.log`:
typecheck, vitest 179 datoteka / 2534 testova u oba projekta, build). `e2e/kiosk-layout.spec.ts`
16 testova: okvir na 1920 × 1080 drži 2 cijele izjave uz dvorednu prometnu vrijednost i 3 uz
jednoredne, na 1366 × 768 po 2 (granice 1 / 2), na 1080 × 1920 3 i 3; redci oznaka prometa 2 / 1 /
2; `data-major-labels` (prvi otisak pri `ready`, tj. slaganje profila prije pločica vozila / nakon
jednog ciklusa dohvata, popravak 1, 19:05): 4--7 / 2 na 1920 × 1080, 4 / 0 na 1366 × 768, 3 / 0 na
1080 × 1920 -- brojka pada kad pločice vozila zauzmu sidra, ne raste (nula je stvarno brojanje);
prije proširenja razmaka sudara totem je sam postavljao 7--9 (jedanput 9 preko granice), zid 6--8.
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
1900 m), otvoreni redci `dogadanja` poredani (sjednice, ZET promet, pa ostatak) i ograničeni
na 20.

**Rezultat (proizvodnja): popunjava kontrolor nakon spajanja na `main`** -- živi `kiosk.css` nosi
`.k-say`, posluženi stil nema sloj `pois`, teaser odgovara pinovima dalje od 1,4 km.
