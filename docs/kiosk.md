# Kaj ima? · zaslon, postavljanje i provjera

Upute za redizajnirani prototip od 17. rujna 2026. Zamjenjuju prethodne
rasporede i automatsko preuzimanje prikaza pri skeniranju.
Tehničko ime `vidikovac`, domena i ključevi pohrane ostaju nepromijenjeni.
Adresa je javna od 14. rujna 2026.; Cloudflare Access štiti samo operaterske
rute `/api/admin/*` i `/stats`.

## Postavljanje stvarnog zaslona

1. Na računalu ili zaslonu otvoriti https://zagreb.aningfilm.hr i na početnoj
   stranici odabrati „Otvori gradski zaslon” (stranica `/kiosk/`).
2. Pritisnuti **Pokreni zaslon**. To je cijelo postavljanje: nema gradske
   četvrti, nema stajališta i nema parametara u adresi. `POST /api/screens` s
   praznim tijelom vraća redovnu postavu zaslona koja vrijedi 24 sata i
   pokazuje cijeli grad (područje `zagreb`, bez stajališta). Postava sama ne
   daje otključanu sesiju.
3. Područje i stajalište biraju se poslije, na samom zaslonu: zupčanik u
   zaglavlju otvara **Postavke** (zatvara se tipkom Esc, gumbom ili nakon 90
   sekundi bez dodira). Četiri odjeljka: *Područje* (Cijeli grad ili jedna od
   17 gradskih četvrti), *Stajalište* (pretraga po imenu ili „Bez
   stajališta”), *Tema* i *Zaslon* (do kada vrijedi i „Zaboravi zaslon” s
   potvrdom). **Spremi** šalje jednu poruku `screen-set` preko postojeće veze
   zaslona; Durable Object provjerava stajalište i područje, pamti ih i
   odgovara redovnim okvirom s kodovima, koji zaslon ponovno kadrira. Ploča
   čeka taj odgovor: zatvara se kad stigne, a odbijenicu ili prebrzo ponovno
   spremanje kaže rečenicom i ostaje otvorena. Ako odgovor ne stigne u osam
   sekundi, gumb se vraća uz istu obavijest; odgovor koji ipak stigne poslije
   svejedno ponovno kadrira zaslon. Postavke se ne otvaraju dok traje
   otključana sesija.
   Odabir kadrira i kartu pozivnice: *Cijeli grad* (područje `zagreb`, kao i
   zaslon bez ijednog područja) otvara prozor cijeloga grada, jedna gradska
   četvrt sjeda na svoje sjedište dok joj ne stigne obris, a odabrano
   stajalište nadjačava oboje i drži svoj ulični kadar. Zaglavlje čita isti
   odgovor: naziv stajališta, inače naziv četvrti, a za cijeli grad ništa.
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
skeniranja. U vodoravnom rasporedu lokalna karta i odvojena ploča linija
zauzimaju lijevi dio; vrijeme i dnevna prognoza, sljedeća događanja,
obližnja zatvaranja, gradske informacije i pozivnica desni.
Karta nema ploču linija preko sebe. Brojevi vozila prorjeđuju se pri
preklapanju, a položaji ostaju označeni točkama.

Zaglavlje nosi mjesto, datum i vrijeme. Sigurnosna traka uvijek ostaje
vidljiva i imenuje stanje izvora, upozorenje kada postoji i dežurnu
ljekarnu. Izvori, datum događanja i vrijeme opažanja nisu zamjenjivi.
„Zadnji polazak” navodi raspored ZET-a, ne procjenu dolaska.

Broj stavki bira se prema korisnosti i raspoloživom prostoru. Popunjena
ploča ne smije postati prazna samo da bi se uklonilo prelijevanje teksta.
Rasporedi za 1920 × 1080, 1366 × 768 i okomiti totem namjerno su
različiti; QR na tim zaslonima ostaje najmanje 240 CSS piksela.
Dežurna ljekarna na karti nosi prsten i adresu. Blizu stajališta zaslona
prsten ostaje, a sigurnosna traka nosi puni naziv.

Radovi u tijeku broje se za cijeli grad i ploča to kaže izričito
(„Radovi u gradu”); nema odabira gradske četvrti.
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
  stajalište. Kašnjenje je medijan po liniji, ne kašnjenje izabranog vozila.
- Nedostajući ili neupotrebljivo velik medijan ne prikazuje se kao „na vrijeme”
  niti se skraćuje na izmišljenu vrijednost. Sirovi izvor ostaje neizmijenjen.
- Prekid izvora zaustavlja procijenjeno kretanje. Posljednji podaci mogu ostati
  vidljivi uz oznaku zastarjelosti.
- Prognoza prikazuje stvarne dnevne vrijednosti, ne izmišljeni satni niz.
- Nedatirane obavijesti nisu današnja događanja; trajanje izložbe nije novo
  otvorenje svakog dana.
- Podaci o ljekarni ne znače jamstvo da je ona trenutačno najbliža korisniku.
  Aplikacija ne traži korisnikovu geolokaciju.
- Kvaliteta zraka, arhivska građa, HŽ i dolasci po stajalištu nisu
  implementirane integracije ovog prototipa.
- Zadnji polazak je polazak po rasporedu ZET-a, nikad dolazak.

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
s nazivima od najmanje 24 CSS px. Bez prepoznatog stajališta pokazuje cijelu
mrežu bez sitnih naziva. Shema nije interaktivna na zaslonu i zanemaruje
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
| Pojavljuje se postavljanje | Nema valjane lokalne postave; odabrati četvrt i stajalište. |
| Stvaranje je odbijeno | Kod 429 znači dosegnuto ograničenje po mreži ili ukupno; slijediti navedeno vrijeme ponovnog pokušaja. Kod 403 znači zahtjev s druge domene. |
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
