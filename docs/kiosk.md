# Kaj ima? · zaslon, postavljanje i provjera

Važeće upute za prototip od 13. rujna 2026. Zamjenjuju starije upute s
panoramom, meandrom, rasterskom kartom i zabranom iste mreže.
Tehničko ime `vidikovac`, domena i ključevi pohrane ostaju nepromijenjeni.
Evaluacijski pristup za prijavu Gradu ostaje iza Cloudflare Accessa.

## Stvarni zaslon za evaluaciju

1. Na računalu ili zaslonu otvoriti evaluacijsku adresu i dovršiti Access
   prijavu. Na početnoj stranici odabrati „Otvori gradski zaslon”.
2. Odabrati gradsku četvrt, zatim stvarno ZET-ovo stajalište. Zadana postava
   je Donji grad i Trg bana J. Jelačića (`106_1`).
3. Potvrditi stvaranje. `POST /api/screens` vraća redovnu postavu zaslona
   koja vrijedi 24 sata. Postava sama ne daje otključanu sesiju.
4. Na telefonu unaprijed proći Access prijavu, zatim skenirati aktualni QR
   ili utipkati kod na `/s/`. Potvrditi „Otključaj”.
5. Telefon dobiva deset minuta i vodi povezani zaslon. Za provjeru radne
   površine istu stvar napraviti u drugoj kartici preglednika.

Isti Wi-Fi je dopušten. Ne treba isključivati Wi-Fi ili trošiti mobilne podatke.
Kod je jednokratan, prikazuje se kao dvije skupine po četiri znaka i mijenja
svakih 30 sekundi. Istekli ili iskorišteni kod zamijeniti aktualnim sa zaslona.

Stvaranje je ograničeno na pet postava po evaluacijskom identitetu u kliznom
satu i trideset ukupno. Osvježavanje već postavljenog zaslona koristi postojeće
vjerodajnice; ne stvara novu postavu. Nakon isteka ili opoziva nova se postava
pokreće izričitom radnjom, ne automatskom petljom.

## Što zaslon prikazuje

Nepovezan zaslon ima lokalnu vektorsku kartu, linije odabranog stajališta,
opažanje vremena, ograničen izbor obavijesti, stalno mjesto QR-a i sigurnosnu
traku. Nema panorame ni meandra. Rasporedi za 1920 × 1080 i 1366 × 768
namjerno su različiti; QR u oba mora biti najmanje 240 CSS piksela.

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

„Osnovno” prikazuje dostupna upozorenja, zatvaranja, linije u blizini,
vrijeme i podatke o dežurnoj ljekarni, bez otvaranja sesije. Nedostupni
podaci nisu potvrda da je sve u redu. „Natrag”, Escape ili 90 sekundi bez
aktivnosti vraćaju poziv za skeniranje. Taj se vremenski povratak primjenjuje
samo izvan aktivne povezane sesije.

Sigurnosni `/hitno` također radi bez kratke sesije i bez JavaScripta, unutar
evaluacijskog Accessa.

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
Brisanje podataka preglednika uklanja lokalnu postavu. Za evaluaciju koristiti
običan profil: privatni prozor pri zatvaranju briše i postavu i Access prijavu.

Administrativni API `/api/admin/beacons` služi postavama i opozivu uz
provjerenu Access autorizaciju. Samoposluga `/api/screens` koristi isti
BeaconDO/RoomDO protokol. Nema zasebne demonstracijske sesije.

Za prikaz preko cijelog zaslona upotrijebiti mogućnost preglednika. U postavkama
uređaja osigurati da se zaslon ne gasi tijekom evaluacije. Automatsko pokretanje
na ciljnom Raspberry Pi ili doniranom uređaju provjerava se u pilotu; ova
verzija ne tvrdi da su fizičke postave već testirane.

## Razvoj i automatska provjera

Lokalni Worker mora imati `APP_ENV=test` i izričite tajne iz `.dev.vars`.
`E2E_ADMIN_BYPASS` vrijedi samo u tom okruženju, ne ovisi o umirovljenoj
postavci `NETWORK_CHECK`. Ne postavljati razvojni način na evaluacijskom Workeru.

```sh
npm run typecheck
npm test
npm run e2e
node scripts/review-experience.mjs
```

Playwright ima zaseban lokalni poslužitelj za 12-sekundni test isteka.
Za provjeru zaštićene evaluacijske adrese potrebni su Access pristup i
izričito postavljen testni zaslon, bez slanja vjerodajnica u izvještaje.

Snimke i automatizirani rezultati nisu dokaz da je QR fizički skeniran s nekoliko
metara ili da je aplikacija provjerena na iPhoneu i Androidu. Takva mjerenja
bilježe se zasebno, s uređajem, preglednikom, datumom i opaženim rezultatom.

## Rješavanje problema

| Simptom | Provjera i postupak |
|---|---|
| Pojavljuje se postavljanje | Nema valjane lokalne postave; odabrati četvrt i stajalište. |
| Stvaranje je odbijeno | Provjeriti Access prijavu. Kod 429 znači dosegnuto ograničenje; slijediti navedeno vrijeme ponovnog pokušaja. |
| Postava je istekla ili opozvana | Pokrenuti novu postavu izričito. Ne ponavljati automatski stvaranje. |
| Kod je istekao ili iskorišten | Upisati novi aktualni kod; provjeriti automatsko podešavanje sata uređaja. |
| Telefon ne završava povezivanje | Nakon kratkih ponovnih pokušaja sučelje nudi novi ulazak; upotrijebiti svježi kod. |
| Izvor je zastario ili nedostupan | Zadnja dobra kopija nije trenutačna potvrda; provjeriti izvor i mogućnost ponovnog dohvata. |
| Karta ne radi | Koristiti pretragu i popis ili `?lagano=1`; provjeriti lokalni R2 arhiv pri razvoju. |

Isporuka ide isključivo kroz provjereni `git push` i postojeći Cloudflare Build.
Ne koristi se `wrangler deploy`; Access i privatnost repozitorija ostaju očuvani.
