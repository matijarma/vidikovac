# Vidikovac (radni naziv) — Zagreb, povezan.

Pogled na Zagreb u stvarnom vremenu, izgrađen isključivo na otvorenim podacima, koji se otključava na deset minuta skeniranjem rotirajućeg QR koda s javnog zaslona ili s telefona druge osobe. Plaća se pažnjom i prisutnošću, ne novcem. Sigurnosni sloj (upozorenja DHMZ-a, potresi, zatvorene prometnice, dežurne ljekarne, zborna mjesta civilne zaštite) otvoren je svima bez skeniranja, a javni zasloni su čitljivi i bez telefona.

Prototip: https://zagreb.aningfilm.hr · Prijava na Javni poziv Grada Zagreba za financiranje projekata korištenja otvorenih podataka 2026.

*English: a real-time, accessible "god's view" of Zagreb built only on open data, unlocked for ten minutes by scanning a rotating QR code on a public screen or on another person's phone. Emergency information is always open; public screens are always readable; anonymous, identifier-free usage counts go to the City under a closed licence. Code AGPL-3.0-or-later.*

## Tri površine, sedam slojeva

Ruka (telefon, otključan), Prozor (javni zaslon, bez dodira, uvijek čitljiv), Stol (radna površina). Slojevi: Grad sada, U pokretu, Zrak i nebo, Sigurnost (otvoren), Uprava i pravo, Kultura i sjećanje, Vijesti. Svaki panel nosi oznaku svježine (Živo, Danas, Referenca) i atribuciju izvora.

## Pokretanje

```sh
npm install
cp .dev.vars.example .dev.vars        # lokalne vrijednosti; NETWORK_CHECK=off za razvoj
npm run gtfs:routes                   # jednom: imena ZET linija u app/src/data/zet-routes.json
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

Deploy je `git push` na `main` (Cloudflare Workers Builds gradi `npm run build` i postavlja Worker). `wrangler deploy` se ne koristi. Tajne: `npx wrangler secret put SESSION_SECRET`, `npx wrangler secret put NET_KEY_SECRET`. Ostale runtime varijable žive u Cloudflare nadzornoj ploči (`keep_vars`).

## Struktura

```
worker/        Worker: index.ts (usmjerivač), routes/, feed/ (moduli izvora), do/ (BeaconDO, RoomDO, IndexDO, MetricsDO), protocol.ts
app/           statičke stranice (vite): index, hitno, s, d, kiosk, izvori, privatnost, pristupacnost, open; src/ui, src/layers
e2e/           Playwright: pairing.spec.ts, a11y.spec.ts
scripts/       gtfs-routes.mjs, check-plan-links.mjs, lighthouse-a11y.mjs
docs/          izvori.md, kiosk.md, arhitektura.md, privatnost.md, pristupacnost.md, video/, prijava/ (tekst prijave)
video/         Remotion: naslovna i završna kartica demo videa
test/          vitest; test/fixtures su spremljeni živi uzorci svakog izvora
```

## Dokumenti

- Dizajn i odluke: `docs/superpowers/specs/2026-09-11-vidikovac-design.md`
- Arhitektura: `docs/arhitektura.md` · Javni zasloni: `docs/kiosk.md` · Izvori i licence: `docs/izvori.md`
- Prijava (hrvatski): `docs/prijava/prijedlog-projekta.md`, `obrazac-3-financijski-plan.md`, `plan-provedbe.md`, `rizici-i-odgovori.md`

## Licenca

Kod: AGPL-3.0-or-later (`LICENSE`); Gradu Zagrebu nudi se isti kod i pod EUPL-1.2. Izvedeni podaci na `/open`: Otvorena dozvola. Podaci trećih strana pod uvjetima navedenima u `docs/izvori.md`; ZET: "Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669".

Copyright (C) 2026 Aning Film d.o.o. / Matija Radeljak
