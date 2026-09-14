# Kaj ima?

Radni prototip gradske informacijske usluge za prijavu na zagrebački poziv za otvorene podatke. Cilj je pretvoriti stvarne gradske podatke u razumljivu kartu, vrijeme, događanja, sigurnost, gradske aktivnosti i vijesti. Dizajn i interakcija dio su funkcionalnosti, ne dodatak tablicama.

Pristup se na vlastitom uređaju otključava na deset minuta skeniranjem koda sa zaslona, odnosno na pet minuta s telefona druge osobe. Ista Wi-Fi mreža radi. Sigurnost je dostupna bez sesije, također bez JavaScripta. Ne postoji posebna demonstracija koja zaobilazi uparivanje.

Prototip: https://zagreb.aningfilm.hr, javno dostupan od 14. rujna 2026. Namijenjen je ocjenjivanju u prijavi Gradu. Javni zasloni u prostorima, pilot i daljnji razvoj ovise o financiranju i partnerstvu s Gradom; bez toga nema zasebnog javnog projekta. Operaterske rute `/api/admin/*` i `/stats` traže Cloudflare Access i svima ostalima odgovaraju 404.

*English: a working Zagreb city-information prototype for the City's open-data funding application. Real screens and rotating codes grant ten-minute sessions, with five-minute one-hop sharing. Safety is sessionless. The prototype is public since 14 September 2026; only the operator routes require Cloudflare Access. A citizen rollout is conditional on City backing.*

## Tri površine, sedam slojeva

Telefon, radna površina i javni zaslon dijele podatke i vizualni jezik, s rasporedima za vlastiti način uporabe. Sedam područja: Sada, Promet, Vrijeme, Sigurnost, Grad, Događanja i Vijesti. Vrijeme opažanja, objave ili događanja odvojeno je od vremena dohvata. Nedostupan izvor nije nula ili potvrda da nema upozorenja.

Tehničko ime repozitorija, Workera, domena i postojeći ključevi pohrane ostaju `vidikovac`. Promjena brenda ne briše postojeće postave.

## Pokretanje

```sh
npm install
cp .dev.vars.example .dev.vars        # izričite lokalne tajne; APP_ENV=test samo lokalno
npm run gtfs:routes                   # jednom: imena ZET linija u app/src/data/zet-routes.json
node scripts/gtfs-stops.mjs            # katalog iz već postojećeg mrežnog artefakta
npm run dev                           # wrangler dev na http://localhost:8787
```

## Testovi

```sh
npm test                              # vitest: unit (node) i workers (@cloudflare/vitest-pool-workers)
npm run e2e                           # Playwright: uparivanje u dva konteksta, istek s 12-sekundnom sesijom
npm run e2e:a11y                      # axe nad /, /hitno, /kiosk/, /s/, /d/ u svijetloj i tamnoj temi
npm run a11y:lighthouse               # Lighthouse pristupačnost (treba pokrenut poslužitelj)
npm run check:izvori                  # sve poveznice iz docs/izvori.md odgovaraju; svi moduli dokumentirani
```

Protiv produkcije: `E2E_NO_WEBSERVER=1 E2E_APP_URL=https://zagreb.aningfilm.hr E2E_KIOSK_URL=<adresa testnog zaslona> npx playwright test` (u PowerShellu `$env:E2E_NO_WEBSERVER='1'; ...`).

## Postavljanje

Deploy je `git push` na `main` (Cloudflare Workers Builds gradi `npm run build` i postavlja Worker). `wrangler deploy` se ne koristi. Potrebna je izričita `SESSION_SECRET`; nema ugrađene razvojne tajne. `NETWORK_CHECK` je umirovljen i ne uključuje razvojni način. `APP_ENV` nepostavljen znači produkcija, a `E2E_ADMIN_BYPASS` djeluje samo kada je `APP_ENV=test`.

R2 spremnik `vidikovac-maps` nosi verzionirani regionalni PMTiles arhiv. Karta, glifovi i spriteovi poslužuju se s iste domene. Gradnja arhiva i podrijetlo navedeni su u `app/public/maps/README.md`. Za lokalni rad spremiti arhiv i u lokalni R2 pomoću `wrangler r2 object put --local`; bez njega ostaje pristupačan alternativni prikaz prijevoza.

`workers_dev` i pregledne adrese onemogućene su. Privremeni zasloni stvaraju se javno na `/kiosk/` (`POST /api/screens`), najviše pet postava po mreži i trideset ukupno u kliznom satu; adresa mreže se ne pohranjuje, ključ je HMAC njezina prefiksa. Njihovo korištenje vodi se kao `evaluation` i ne ulazi u izvoz podataka o korištenju na pilot lokacijama.

## Struktura

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

- Važeći produkt i dizajn: `PRODUCT.md`, `design.md`; provedba i status: `docs/implementation-kaj-ima.md`
- Ranije specifikacije u `docs/superpowers/` su povijesni zapis, ne važeće vizualne upute.
- Arhitektura: `docs/arhitektura.md` · Javni zasloni: `docs/kiosk.md` · Izvori i licence: `docs/izvori.md`
- Prijava (hrvatski): `docs/prijava/prijedlog-projekta.md`, `obrazac-3-financijski-plan.md`, `plan-provedbe.md`, `rizici-i-odgovori.md`

## Licenca

Kod: AGPL-3.0-or-later (`LICENSE`); Gradu Zagrebu nudi se isti kod i pod EUPL-1.2. Izvedeni podaci na `/open`: Otvorena dozvola. Podaci trećih strana pod uvjetima navedenima u `docs/izvori.md`; ZET: "Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669".

Copyright (C) 2026 Aning Film d.o.o. / Matija Radeljak
