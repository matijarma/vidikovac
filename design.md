# VIDIKOVAC — MODROTISAK · dizajn-predaja za implementaciju
v2.0 · 12. rujna 2026. · Ovaj dokument NADOMJEŠTA §3 (Boje) i §8 (Motivi) iz `VIDIKOVAC-DIZAJN-SUSTAV.md`; sve ostalo iz v1.0 (glas i ton, prostor, pokret, pristupačnost, anatomija komponenti) i dalje vrijedi osim gdje je ovdje izričito promijenjeno. Referentni mockup: `Vidikovac.dc.html` (kiosk 1080p + /d + obje teme).

## 0 · Koncept u tri rečenice

1. **Modrotisak**: identitet je hrvatski modrotisak — indigo platno s krem otiskom. Tamna tema (zadana) = indigo podloga + krem tinta; svijetla tema = **isto platno, drugo lice**: krem podloga + indigo tinta. Nikad "dark mode kao izvedenica" — dvije ravnopravne strane iste bale.
2. **Panorama kao živa grafika**: svaka površina nosi programski crtanu zagrebačku panoramu (Medvednica + Sljemenski toranj, silueta grada s katedralom, jedna pruga pod gradom) na kojoj je **jedna točka = jedno vozilo ZET-a, sada** (živi podatak iz `zet-rt`).
3. **Fun + formal**: strogi galerijski okvir (linije, kataloška numeracija 01/02/03, mono legende "SL. 1 — …") nosi duhovitost u sadržaju legendi. Meandar (Knifer) je funkcionalni brojač vremena: na kiosku prazni se svakih 30 s (kod), na telefonu kroz 10 minuta (sesija).

## 1 · Tokeni — zamijeniti vrijednosti u `app/src/ui/tokens.css`

Imena `--tone-*` ostaju ista (testovi i komponente ih već koriste); mijenjaju se samo vrijednosti. `color-scheme` ostaje kako jest.

### Noć (zadana, `:root, [data-theme=dark]`)
```css
--tone-surface-canvas:#16226b;   /* indigo platno */
--tone-surface-1:#0f1a52;        /* ploča/panel (dublji indigo) */
--tone-surface-2:#0b1440;        /* rub, podnožje, hover */
--tone-surface-3:#1d2f8a;        /* utori, prekidači */
--tone-text-primary:#f2ead8;     /* krem tinta */
--tone-text-muted:#c3cdf5;       /* sekundarno (≈7:1) */
--tone-text-subtle:#a3aed8;      /* atribucija (≈5.6:1) */
--tone-action-brand:#f2ead8;     /* primarna akcija = krem */
--tone-action-brand-hover:#ffffff;
--tone-action-brand-fg:#16226b;
--tone-label:#9db4ff;            /* NOVO: kataloški brojevi, tihe oznake (≈5.5:1) */
--tone-state-success:#7fd6a8; --tone-state-warning:#f2c078; --tone-state-danger:#ff9d9d;
--tone-stroke:rgba(242,234,216,.22); --tone-stroke-strong:rgba(242,234,216,.45);
```

### Dan (`[data-theme=light]`)
```css
--tone-surface-canvas:#f2ead8;
--tone-surface-1:#faf5e9;
--tone-surface-2:#e9dfc6;
--tone-surface-3:#ded2b2;
--tone-text-primary:#16226b;
--tone-text-muted:#4553a8;       /* ≈6.3:1 */
--tone-text-subtle:#5d6890;
--tone-action-brand:#16226b;
--tone-action-brand-hover:#0b1440;
--tone-action-brand-fg:#f2ead8;
--tone-label:#3a49b0;
--tone-state-success:#1e6f47; --tone-state-warning:#8a5800; --tone-state-danger:#b3271e;
--tone-stroke:rgba(22,34,107,.24); --tone-stroke-strong:rgba(22,34,107,.5);
```

Pravila:
- **Nebo-gradijent iz v1.0 se briše** — podloga je ravna boja (platno). Nema staklenih efekata ni blur-ova osim scrima dijaloga.
- Jedan naglasak = boja tinte (krem na indigu / indigo na kremu). `--tone-label` je jedina dopuštena treća nijansa (blijedi kobalt) — za kataloške brojeve, tihe VERZAL oznake i poveznice u podnožju.
- Nijanse slojeva iz v1.0 (§3, tablica sloj→boja) se NE koriste u modrotisak izdanju; sloj se raspoznaje potcrtom aktivnog taba u boji tinte.
- DHMZ upozorenja i dalje imenuju boje riječima; state boje samo za ikonu/obrub Toasta i Alerta.

## 2 · Tipografija (nepromijenjeno iz v1.0, s dopunama)

- Space Grotesk 700 naslovi (tracking −0.02 do −0.025em), Manrope tekst, JetBrains Mono za: kodove, vremena, brojke, **sve VERZAL oznake i legende** (tracking .04–.08em), kataloške brojeve.
- Novo pravilo: **legenda ("SL. n — …")** = JetBrains Mono, VERZAL, muted boja; kiosk 19px, telefon 10px. Legenda je jedino mjesto za duhovitost — sadržaj formalan po obliku, živ po tekstu ("JEDNA TOČKA = JEDNO VOZILO ZET-a").
- Kataloška numeracija panela: `01 ·`, `02 ·` … mono, `--tone-label`.

## 3 · Motivi (zamjenjuje §8 v1.0)

### 3.1 Panorama (novo — potpis brenda)
Programski crtana na `<canvas>`, boja = `--tone-text-primary`, uvijek puna širina, bez okvira. Visine: kiosk 264px (1080p), telefon 92px, landing hero ~180px. Redoslijed slojeva:
1. Medvednica: poligonalna silueta, alpha .30
2. Sljemenski toranj na grebenu: uski stup + **elipsasti vidikovac-pod + šira baza — NIKAD vodoravna prečka (čita se kao križ)**
3. Silueta grada na baznoj liniji (alpha 1): generirani blokovi + katedrala (dva tornja s trokutastim kapama + lađa) na ~38 % širine + jedan vitki neboder na ~60 %
4. Bazna linija (puna crta)
5. **Jedna pruga** ispod grada (alpha .28) s perlama: `count` točaka, alpha .95 — **jedna točka = jedno vozilo iz `zet-rt` (vehicle:*)**. Jedna linija, nikad više redova (mreža točaka čita se kao groblje/snijeg — provjereno).

Referentna implementacija (prilagoditi u `app/src/ui/panorama.ts`, crtati na 2× gustoći, ponoviti na resize i na svježem `zet-rt` snapshotu):

```js
export function drawPanorama(c, { fg, count }) {
  const W = c.offsetWidth * 2, H = c.offsetHeight * 2;
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  let seed = 2026;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  const a = (al) => { ctx.globalAlpha = al; ctx.fillStyle = fg; ctx.strokeStyle = fg; };
  a(0.3); ctx.beginPath(); ctx.moveTo(0, H * 0.66);
  [[0,.42],[.10,.32],[.20,.25],[.30,.31],[.44,.26],[.58,.34],[.72,.28],[.86,.35],[1,.32]]
    .forEach((p) => ctx.lineTo(W * p[0], H * p[1]));
  ctx.lineTo(W, H * 0.66); ctx.closePath(); ctx.fill();
  a(0.55);
  const tx = W * 0.20, tw = Math.max(2.4, W * 0.0032);
  ctx.fillRect(tx - tw / 2, H * 0.045, tw, H * 0.205);
  ctx.beginPath(); ctx.ellipse(tx, H * 0.115, tw * 1.9, H * 0.022, 0, 0, 7); ctx.fill();
  ctx.fillRect(tx - tw, H * 0.19, tw * 2, H * 0.06);
  a(1);
  const base = H * 0.68;
  let x = W * 0.02, cathedralDone = false, towerDone = false;
  while (x < W * 0.97) {
    const px = x / W;
    if (!cathedralDone && px >= 0.36) {
      const sw = W * 0.011, gap = W * 0.017, shh = H * 0.28, sph = H * 0.15;
      ctx.fillRect(x - W * 0.012, base - H * 0.11, W * 0.062, H * 0.11);
      [0, 1].forEach((k) => {
        const sx = x + k * (sw + gap);
        ctx.fillRect(sx, base - shh, sw, shh);
        ctx.beginPath(); ctx.moveTo(sx - sw * 0.4, base - shh);
        ctx.lineTo(sx + sw / 2, base - shh - sph); ctx.lineTo(sx + sw * 1.4, base - shh);
        ctx.closePath(); ctx.fill();
      });
      x += sw * 2 + gap + W * 0.022; cathedralDone = true; continue;
    }
    if (!towerDone && px >= 0.60) { ctx.fillRect(x, base - H * 0.34, W * 0.017, H * 0.34); x += W * 0.022; towerDone = true; continue; }
    const bw = W * (0.016 + rnd() * 0.028), bh = H * (0.06 + rnd() * 0.15);
    ctx.fillRect(x, base - bh, bw, bh); x += bw + W * 0.0045;
  }
  ctx.fillRect(0, base, W, Math.max(1.5, H * 0.012));
  const ry = base + H * 0.10;
  a(0.28); ctx.lineWidth = Math.max(1, H * 0.008);
  ctx.beginPath(); ctx.moveTo(0, ry); ctx.lineTo(W, ry); ctx.stroke();
  a(0.95);
  const r = Math.max(1.4, H * 0.016);
  for (let i = 0; i < count; i++) {
    const xx = W * (0.008 + 0.984 * ((i + rnd() * 0.6) / count));
    ctx.beginPath(); ctx.arc(xx, ry, r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
```
Uz panoramu OBVEZNA legenda: `SL. 1 — ZAGREBAČKA PANORAMA: MEDVEDNICA I GRAD · NA PRUZI JEDNA TOČKA = JEDNO VOZILO ZET-a · {count} U POKRETU, {HH:mm}` (na telefonu skraćeno ili izostavljeno). Dostupnost: `role="img"` + `aria-label` s istim tekstom. Bez snapshota: nacrtati bez perli, legenda "učitavanje podataka".

### 3.2 Meandar (zamjenjuje CodeRing i SessionRing sweep)
Debela pravokutna vijuga (Kniferov kvadratni val), stroke = 30 % visine trake. Puna traka = puni interval; prazni se **linearno s desna** (clip). Dvije uloge:
- **Kiosk, kod (30 s)**: `app/src/kiosk.ts` — zamjenjuje `.code-ring` sweep; visina 72px pod naslovom ili u kartici koda; legenda "SL. 3 — MEANDAR KODA · ISPRAZNI SE SVAKIH 30 s, PA SE IZDA NOVI KOD".
- **Telefon /d, sesija (10 min)**: `app/src/dashboard.ts` — zamjenjuje SVG `session-ring`; visina 30–34px pod retkom "do HH:mm"; legenda "SL. 1 — MEANDAR SESIJE · ISPRAZNI SE DO {HH:mm}". Odbrojavanje ostaje tekstualno uz njega ("· još 9:12", mono, `--tone-label`).

```js
export function drawMeander(c, { ink, fill, pct }) {
  const w = c.offsetWidth * 2, h = c.offsetHeight * 2;
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const lw = Math.round(h * 0.3), half = lw / 2, top = half, bot = h - half, step = bot - top;
  const path = new Path2D();
  let x = half, atTop = true;
  path.moveTo(x, bot); path.lineTo(x, top);
  while (x < w - step) { x += step; path.lineTo(x, atTop ? top : bot); path.lineTo(x, atTop ? bot : top); atTop = !atTop; }
  const draw = (style, clipW) => {
    ctx.save();
    if (clipW != null) { ctx.beginPath(); ctx.rect(0, 0, clipW, h); ctx.clip(); }
    ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.lineJoin = 'miter'; ctx.miterLimit = 4;
    ctx.stroke(path); ctx.restore();
  };
  draw(ink, null); draw(fill, w * pct);
}
```
`ink` = `--tone-stroke` (trag), `fill` = `--tone-text-primary`. Osvježavanje: kiosk 1 s korak (linearno, `--ease-time`); **smanjeni pokret**: pct kvantizirati na 10 koraka (zamjenjuje "10 segmenata" iz v1.0) — `transitionend` ugovor iz testova ne ovisi o canvasu, provjeriti `test/app/rotation.test.ts` i `kiosk.test.ts` da ciljaju novu klasu/testid (zadržati `data-testid="code-ring"` i `session-ring` na canvas elementima da testovi prežive).

### 3.3 Ostalo
- Obzor-linija iz v1.0 (gradijent 56px) se briše. Odjeljci se dijele punim linijama 1–2px u boji tinte (2px za "tvrde" granice: pod headerom, nad katalogom, pod tablistom).
- Svježina ●■◆ ostaje (v1.0 §8), boja = tinta; "● ŽIVO" na Ruci mono 10px VERZAL.
- QR: uvijek tamni moduli na krem pločici; u Noći QR pločica sjedi u okviru `4px solid` tinte na `--tone-surface-1`, legenda "SL. 2 — OTISAK ZA KAMERU".

## 4 · Komponente — izmjene po datotekama

| Datoteka | Izmjena |
|---|---|
| `app/src/ui/tokens.css` | vrijednosti iz §1; dodati `--tone-label`; izbaciti nebo-gradijent |
| `app/src/ui/panorama.ts` (novo) | §3.1; poziva se iz kioska (teaser), landinga i /d headera |
| `app/src/ui/meander.ts` (novo) | §3.2 |
| `app/src/ui/panel.css` + `panels/panel.ts` | **Paneli nisu kartice.** Na Ruci: kataloški red — mono broj `01` (label boja) + sadržaj, donja linija `--tone-stroke`; bez pozadine, bez radijusa, bez sjene. Na Stolu/kiosku: isti red u mreži. Zaglavlje reda: naziv 13px muted + svježina desno; brojka Space Grotesk 700 29–34px; podnožje (izvor · licenca · izvornik) 11px subtle |
| `app/src/dashboard.ts` + `dashboard.css` | header: "OTKLJUČANO · {label}" mono VERZAL 11 + "PODIJELI GRAD" desno (label boja); "do HH:mm" SG 700 32 + "· još m:ss" uz njega; meandar sesije ispod (§3.2); tablist: mono VERZAL 11 tabovi, aktivni = tekst tinta + potcrta 3px tinta, ostali muted; ukloniti pilule |
| `app/src/kiosk.ts` + `kiosk.css` | raspored iz mockupa: header (wordmark · datum · sat, donja linija 2px) → panorama + legenda → mreža: naslov-poziv (SG 700, druga rečenica u `--tone-label`) + meandar koda | desno kartica koda (okvir 4px, QR pločica, kod mono 52–56 tracking .14em, crtica 45 %) → kataloški red 01/02/03 (brojke 48px) → sigurnosna traka: `--tone-surface-2` podloga, "/hitno" kao krem pilula s indigo tekstom (Noć) odn. obrnuto (Dan) |
| `app/src/scan.ts` + `scan.css` | krem/indigo obrazac iz mockupa: naslov SG 32, primarni gumb = tinta podloga + platno tekst (52px), "ili" separator s linijama, CodeInput 52px mono tracking .14em s okvirom `--tone-stroke-strong`, natuknica 13 muted, sekundarni "Otključaj" ghost; kartica /hitno na `--tone-surface-1` |
| `app/index.html` | inline stil uskladiti s §1 (landing dobiva panoramu ~180px pod naslovom + legendu; ostalo tipografski kao sada) |
| `app/src/ui/toast.css`, `dialog.css` | boje kroz tokene se povlače same; dijalog radijus 22 i sjena ostaju; scrim `rgba(4,8,32,.62)` (Noć) / `rgba(22,34,107,.4)` (Dan) |
| `test/app/contrast.test.ts` | ažurirati parove: (#f2ead8,#16226b), (#c3cdf5,#16226b), (#9db4ff,#16226b), (#f2ead8,#0f1a52), (#16226b,#f2ead8), (#4553a8,#f2ead8), (#3a49b0,#f2ead8) — svi ≥4.5:1 osim #9db4ff/#f2c078 koje su za VERZAL oznake ≥12px i velike brojke (≥3:1 dopušteno po v1.0 samo za naslovne veličine — oznake drže ~5.5:1, prolaze) |

## 5 · Što se NE dira

- Sav TypeScript tok podataka, testid-ovi, ARIA obrasci, roving tabindex, i18n ključevi, hrvatska pluralizacija, formati vremena.
- Prostorna skala, radijusi (osim gdje panel gubi karticu), z-osi, trajanja i easing iz v1.0.
- Pravilo kontrasta 4.5:1, dodir 44/52px, fokus prsten 2px (boja fokusa = tinta, sjaj `rgba(157,180,255,.35)` Noć / `rgba(22,34,107,.25)` Dan).
- "Po Suncu" logika u `theme.ts` — samo sada prebacuje dva lica platna.

## 6 · Redoslijed rada (za agenta)

1. `tokens.css` (§1) → pokreni `npm test` (contrast test će pasti — ažuriraj parove iz §4).
2. `panorama.ts` + `meander.ts` (§3) s unit testovima po uzoru na postojeće canvas-free testove (provjeri da modul ne dira DOM globalno; sve ovisnosti injektirane kao drugdje u repou).
3. Kiosk (§4) → `npm run e2e:a11y` za /kiosk/.
4. Dashboard /d → pazi na `session-ring`/`code-ring` testove.
5. Scan /s, landing, /hitno, statične stranice.
6. Vizualna provjera obje teme na 1080p i 390px; smanjeni pokret (kvantizirani meandar).
