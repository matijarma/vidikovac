# Kaj ima?

Radni prototip gradske informacijske usluge za prijavu na zagrebački poziv za otvorene podatke. Cilj je pretvoriti stvarne gradske podatke u razumljivu kartu, vrijeme, događanja, sigurnost i gradske aktivnosti. Dizajn i interakcija dio su funkcionalnosti, ne dodatak tablicama.

Pristup se na vlastitom uređaju otključava na deset minuta skeniranjem koda sa zaslona, odnosno na pet minuta s telefona druge osobe. Ista Wi-Fi mreža radi. Sigurnost je dostupna bez sesije, također bez JavaScripta. Ne postoji posebna demonstracija koja zaobilazi uparivanje.

Skeniranje ne mijenja javni pregled grada. Prikazivanje odabranog sadržaja zasebna
je radnja kroz kontrolu **Zaslon**, s potvrdom iscrtavanja i izričitom potvrdom
preuzimanja od druge osobe. Privatno pregledavanje ostaje na vlastitom uređaju.

Prototip: https://zagreb.aningfilm.hr, javno dostupan od 14. rujna 2026. Namijenjen je ocjenjivanju u prijavi Gradu. Javni zasloni u prostorima, pilot i daljnji razvoj ovise o financiranju i partnerstvu s Gradom; bez toga nema zasebnog javnog projekta. Operaterske rute `/api/admin/*` i `/stats` traže Cloudflare Access i svima ostalima odgovaraju 404.

*English: a working Zagreb city-information prototype for the City's open-data funding application. Real screens and rotating codes grant ten-minute sessions, with five-minute one-hop sharing. Safety is sessionless. The prototype is public since 14 September 2026; only the operator routes require Cloudflare Access. A citizen rollout is conditional on City backing.*

## Tri površine, šest slojeva

Telefon, radna površina i javni zaslon dijele podatke i vizualni jezik, s rasporedima za vlastiti način uporabe. Šest područja: Sada, Promet, Vrijeme, Sigurnost, Grad i Događanja. Vrijeme opažanja, objave ili događanja odvojeno je od vremena dohvata. Nedostupan izvor nije nula ili potvrda da nema upozorenja.

Tehničko ime repozitorija, Workera, domena i postojeći ključevi pohrane ostaju `vidikovac`. Promjena brenda ne briše postojeće postave.

## Pokretanje

Lokalna nadogradnja od 18. rujna 2026. uvodi Sada, Karta, Događanja i Još
na telefonu. Dodaje gradska mjesta, BAJS, priče ulica, baštinu, zrak,
hidrološki bilten, savjetovanja i vozni red. Status i ograničenja:
`docs/upgrade-city-2026-09-18.md`. To ne znači da je nadogradnja postavljena
na produkciju; postavljanje traži zasebno odobrenje.

```sh
npm install
cp .dev.vars.example .dev.vars        # izričite lokalne tajne; APP_ENV=test samo lokalno
npm run gtfs:routes                   # jednom: imena ZET linija u app/src/data/zet-routes.json
npm run build:network                 # mrežni artefakt v3: graf pruge s čvorovima na križanjima, sintetička staza za svaki tramvajski uzorak, posluženi popis stajališta, graphHash
node scripts/gtfs-stops.mjs            # katalog iz već postojećeg mrežnog artefakta
npm run dev                           # wrangler dev na http://localhost:8787
```

Ručna tablica zadržavanja na stajalištima je `app/public/data/stop-dwell-overrides.json`:
uređuje se izravno, bez koraka gradnje (blizanac je dohvaća s
`/data/stop-dwell-overrides.json`). Oblik retka i pravila su u `docs/kaj-verification.md`,
a imenovane iznimke gradnje mreže u `scripts/gtfs-shapes-overrides.json`.

## Testovi

```sh
npm test                              # vitest: unit (node) i workers (@cloudflare/vitest-pool-workers)
npm run e2e                           # Playwright: uparivanje u dva konteksta, istek s 12-sekundnom sesijom
npm run e2e:a11y                      # axe nad /, /hitno, /kiosk/, /s/, /d/ u svijetloj i tamnoj temi
npm run a11y:lighthouse               # Lighthouse pristupačnost (treba pokrenut poslužitelj)
npm run check:izvori                  # sve poveznice iz docs/izvori.md odgovaraju; svi moduli dokumentirani
npx playwright test e2e/city.spec.ts  # mjesta, događanja, baština, lagani način i privatna prezentacija
```

Protiv produkcije: `E2E_NO_WEBSERVER=1 E2E_APP_URL=https://zagreb.aningfilm.hr E2E_KIOSK_URL=<adresa testnog zaslona> npx playwright test` (u PowerShellu `$env:E2E_NO_WEBSERVER='1'; ...`).

## Postavljanje

Deploy je `git push` na `main` (Cloudflare Workers Builds gradi `npm run build` i postavlja Worker). `wrangler deploy` se ne koristi. Potrebna je izričita `SESSION_SECRET`; nema ugrađene razvojne tajne. `NETWORK_CHECK` je umirovljen i ne uključuje razvojni način. `APP_ENV` nepostavljen znači produkcija, a `E2E_ADMIN_BYPASS` djeluje samo kada je `APP_ENV=test`.

R2 spremnik `vidikovac-maps` nosi verzionirani regionalni PMTiles arhiv. Karta, glifovi i spriteovi poslužuju se s iste domene. Gradnja arhiva i podrijetlo navedeni su u `app/public/maps/README.md`. Za lokalni rad spremiti arhiv i u lokalni R2 pomoću `wrangler r2 object put --local`; bez njega ostaje pristupačan alternativni prikaz prijevoza.

`workers_dev` i pregledne adrese onemogućene su. Privremeni zasloni stvaraju se javno na `/kiosk/` (`POST /api/screens`), najviše pet postava po mreži i trideset ukupno u kliznom satu; adresa mreže se ne pohranjuje, ključ je HMAC njezina prefiksa. Njihovo korištenje vodi se kao `evaluation` i ne ulazi u izvoz podataka o korištenju na pilot lokacijama.

## Struktura

`CatalogueDO` (migracija v3) osvježava referentne izvore redom u R2 pod
`city/v1/`; manifest se objavljuje tek nakon fragmenata. Ugrađeni katalog
`app/public/data/city` pokriva prvi start. `npm run build:city` obnavlja ga
iz lokalno spremljenih resursa, `--fresh` traži novi dohvat, a `--prune`
briše samo ugrađene fragmente koje aktualni manifest više ne koristi.
`npm run build` ne dohvaća izvore. Javne `/api/city/*` rute služe aplikaciji;
katalog nije novi otvoreno licencirani skup pod `/open`.

```
worker/        Worker: index.ts (usmjerivač), routes/, feed/ (moduli izvora), do/ (BeaconDO, RoomDO, IndexDO, MetricsDO), protocol.ts
app/           statičke stranice (vite): index, s, d, kiosk, izvori, privatnost, pristupacnost; src/ui, src/layers, src/kiosk, src/map, src/motion (/hitno i /open/ iscrtava Worker)
e2e/           Playwright: pairing, screen-creation, mobile, kiosk-layout, kiosk-recovery, lagano, motion, map-transfer, experience, a11y, a11y-session
scripts/       gtfs-routes.mjs, gtfs-stops.mjs, gtfs-shapes.mjs, check-plan-links.mjs, lighthouse-a11y.mjs, review-experience.mjs, audit-production.mjs, map-assets.mjs, build-hitno-style.mjs
docs/          izvori.md, kiosk.md, arhitektura.md, evaluacija.md, kaj-verification.md, video/, prijava/ (tekst prijave); stranice /privatnost i /pristupacnost su u app/
video/         Remotion: naslovna i završna kartica demo videa
test/          vitest; test/fixtures su spremljeni živi uzorci svakog izvora
```

## Dokumenti

- Važeći produkt i dizajn: `PRODUCT.md`, `DESIGN.md`; redizajn i provjera: `docs/redesign-2026-09-17.md`. `newdesignsystem.md` i `docs/implementation-kaj-ima.md` su povijest prethodne inačice.
- Ranije specifikacije u `docs/superpowers/` su povijesni zapis, ne važeće vizualne upute.
- Arhitektura: `docs/arhitektura.md` · Javni zasloni: `docs/kiosk.md` · Izvori i licence: `docs/izvori.md`
- Prijava (hrvatski): `docs/prijava/prijedlog-projekta.html` (pisani prijedlog u obliku za zaslon, isti tekst u `prijedlog-projekta.md`), `obrazac-2-2.md` (tekst polja Obrasca 2.2), `obrazac-3-financijski-plan.md`, `plan-provedbe.md`, `rizici-i-odgovori.md`

## Licenca

Izvorni kod: https://github.com/matijarma/vidikovac (javan od 15. rujna 2026.).

Kod: AGPL-3.0-or-later (`LICENSE`); Gradu Zagrebu nudi se isti kod i pod EUPL-1.2. Izvedeni podaci na `/open`: Otvorena dozvola. Podaci trećih strana pod uvjetima navedenima u `docs/izvori.md`; ZET: "Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669".

Copyright (C) 2026 Aning Film d.o.o. / Matija Radeljak
