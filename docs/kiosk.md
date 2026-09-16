# Kaj ima? · zaslon, postavljanje i provjera

Važeće upute za prototip od 13. rujna 2026. Zamjenjuju starije upute s
panoramom, meandrom, rasterskom kartom i zabranom iste mreže.
Tehničko ime `vidikovac`, domena i ključevi pohrane ostaju nepromijenjeni.
Adresa je javna od 14. rujna 2026.; Cloudflare Access štiti samo operaterske
rute `/api/admin/*` i `/stats`.

## Postavljanje stvarnog zaslona

1. Na računalu ili zaslonu otvoriti https://zagreb.aningfilm.hr i na početnoj
   stranici odabrati „Otvori gradski zaslon” (stranica `/kiosk/`).
2. Odabrati gradsku četvrt, zatim stvarno ZET-ovo stajalište. Zadana postava
   je Donji grad i Trg bana J. Jelačića (`106_1`).
3. Potvrditi stvaranje. `POST /api/screens` vraća redovnu postavu zaslona
   koja vrijedi 24 sata. Postava sama ne daje otključanu sesiju.
4. Telefonom skenirati aktualni QR ili utipkati kod na `/s/`. Potvrditi
   „Otključaj”.
5. Telefon dobiva deset minuta i vodi povezani zaslon. Za provjeru radne
   površine istu stvar napraviti u drugoj kartici preglednika.

Isti Wi-Fi je dopušten. Ne treba isključivati Wi-Fi ili trošiti mobilne podatke.
Kod je jednokratan, prikazuje se kao dvije skupine po četiri znaka i mijenja
svakih 30 sekundi. Istekli ili iskorišteni kod zamijeniti aktualnim sa zaslona.

Stvaranje je ograničeno na pet postava u kliznom satu po mreži s koje zahtjev
dolazi (ključ je HMAC prefiksa adrese, adresa se ne pohranjuje) i trideset ukupno. Osvježavanje već postavljenog zaslona koristi postojeće
vjerodajnice; ne stvara novu postavu. Nakon isteka ili opoziva nova se postava
pokreće izričitom radnjom, ne automatskom petljom.

## Što zaslon prikazuje

Nepovezan zaslon je gradska naslovnica za svoje stajalište: pet ploča na
jednoj slici, bez rotacije prizora i bez odbrojavanja. Gore lijevo
„Večeras u gradu”: današnja događanja po početku (ono što tek počinje, pa
ono što traje), zatim sutrašnja s oznakom „sutra”, svako s vremenom,
naslovom, vrstom, mjestom i izvorom; kad večer prođe, ploča se zove „Sutra u
gradu”. Ispod nje donji red: „Promet” s linijama stajališta (bedž, oba kraja
linije, riječ stanja i vozila u blizini), od 20 sati redak „Zadnji polazak”
po rasporedu ZET-a (nikad kao procjena dolaska) i najnovija ZET-ova
obavijest; karta stajališta razapeta na 1,5 km širine, sjever gore, s
prugama, vozilima, zatvaranjima i obrisom kvarta; „Oko stajališta” sa
zatvaranjima do 1,5 km po udaljenosti i radovima u kvartu. Desni stupac:
„Sutra” s DHMZ-ovom prognozom za idući dan kao brojkom i današnjim rasponom
pod njom, „Grad” sa sljedećom sjednicom Skupštine, brojem Službenog
glasnika s njegovim aktima i kvartovskim novostima, te stalna pozivnica na
dnu: QR uz poziv i uputu, kod preko cijele širine. Redovi koje ploča ne
drži cijele skrivaju se od dna, nikad se ne režu; naslov reda ide u najviše
dva retka. Svaka ploča nosi navod svojih izvora. Zaglavlje nosi sat i, kad
DHMZ odgovara, vrijeme kao stanje uz sat, nikad kao pločicu. Sigurnosna
traka nosi presudu i tri stavke, bez odbrojavanja. Rasporedi za 1920 × 1080,
1366 × 768 i okomiti totem namjerno su različiti; QR u svima mora biti
najmanje 240 CSS piksela. Dežurna ljekarna na karti nosi prsten i svoju
adresu; kad leži unutar 150 m od stajališta zaslona, adresa se s karte
ispušta (ležala bi preko imena stajališta), a prsten ostaje i sigurnosna je
traka i dalje imenuje u cijelosti.

Radovi u tijeku broje se za gradsku četvrt stajališta kad je poznata i
ploča to kaže („Radovi u kvartu”); dok četvrt nije poznata ili je izvor
tek uveden, broje cijeli grad i kažu to izričito („Radovi u gradu”).
Adresa `/kiosk/` više ne prima dodatak `?prizor=`: nema više odabira
prizora jer postoji samo jedan. Aplikacija i dalje poštuje sustavnu
postavku smanjenog pokreta preglednika, ali sada zaustavlja samo glatki
prijelaz pri pomicanju vozila na karti; podaci se i dalje osvježavaju kao
i inače.

Povezan zaslon preuzima javni izbor s telefona: područje, liniju, stajalište
ili stavku. Sedam područja ima raspored za gledanje s udaljenosti, ne
obrezanu kopiju telefonske stranice. Tekst pretrage i privatne koordinate
ne prenose se na zaslon.

Nova osoba koja skenira preuzima prikaz zaslona, dok prethodnoj osobi njezina
sesija ostaje do izvornog isteka. „Podijeli grad” daje drugoj osobi vlastitih
pet minuta u zasebnoj sesiji koja se ne može dalje dijeliti.

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

## Razvoj i automatska provjera

Lokalni Worker mora imati `APP_ENV=test` i izričite tajne iz `.dev.vars`.
`E2E_ADMIN_BYPASS` vrijedi samo u tom okruženju, ne ovisi o umirovljenoj
postavci `NETWORK_CHECK`. Ne postavljati razvojni način na produkcijskom Workeru.

```sh
npm run typecheck
npm test
npm run e2e
node scripts/review-experience.mjs
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
| Izvor je zastario ili nedostupan | Zadnja dobra kopija nije trenutačna potvrda; provjeriti izvor i mogućnost ponovnog dohvata. |
| Karta ne radi | Koristiti pretragu i popis ili `?lagano=1`; provjeriti lokalni R2 arhiv pri razvoju. |

Isporuka ide isključivo kroz provjereni `git push` i postojeći Cloudflare Build.
Ne koristi se `wrangler deploy`; Access na operaterskim rutama i privatnost repozitorija ostaju očuvani.
