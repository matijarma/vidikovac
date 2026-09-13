# Kaj ima? · zaslon, postavljanje i održavanje

Zaslon je preglednik na `/kiosk/`. Postava za evaluaciju bira stvarno stajalište i četvrt te stvara privremeni zaslon na 24 sata. Nije poseban prikaz s izmišljenim podacima: isti kod, BeaconDO i RoomDO koriste se za stvarno uparivanje. Prototip ostaje iza evaluacijskog Accessa. Vodič za Povjerenstvo je u `docs/evaluacija.md`.

## Što zaslon radi

- **Bez skeniranja:** lokalna karta i informacije oko odabranog stajališta, vrijeme i ograničeni izbor drugih obavijesti. Poziv za skeniranje i QR imaju stalno mjesto; payload koda rotira svakih 30 sekundi. Kôd je ispisan u dvije skupine (`ABCD-EFGH`). Panorama, meandar i kataloška dekoracija uklonjeni su iz smjera Kaj ima?.
- **Nakon skeniranja:** zaslon pokazuje aktivno područje i odabranu javnu stavku, liniju ili stajalište, u rasporedu za gledanje s udaljenosti. Nova osoba koja skenira dobiva novu sesiju i preuzima prikaz zaslona; prethodna osoba zadržava svoj preostali pogled na telefonu.
- **Nakon deset minuta:** zaslon se vraća na teaser i novi QR kod. Nema hlađenja; ista osoba može odmah ponovno skenirati.

Telefon i zaslon mogu biti na istoj Wi-Fi mreži. Za provjeru radne površine
može se utipkati kôd u drugoj kartici preglednika. Evaluacijski Access treba
otvoriti i na telefonu prije skeniranja kako prijava ne bi potrošila prozor
aktualnog koda.

### Granice dostupnih podataka

Prikazuju se položaji i kašnjenje linije, ne izračun dolaska na stajalište.
Kvaliteta zraka i arhivske slike ostaju plan financiranog razdoblja.
Lokacija ljekarne ne naziva se najbližom bez provjerene geometrije za usporedbu.
Izvor bez odgovora ne prikazuje se kao nula ili potvrda da nema upozorenja.
Sigurnost i „Osnovno” ne zahtijevaju sesiju.

Upute i mjerenja niže za starije izdanje zadržani su kao povijesna podloga za
pilot. Mjerenja novih rasporeda Kaj ima? objavljuju se u završnoj predaji;
ne treba ih poistovjećivati s mjerenjima prethodnog Modrotisak izdanja.

## Osnovno, bez telefona

Skeniranje otključava cijeli grad na vlastitom uređaju osobe koja skenira — ono nikada ne uskraćuje odgovor zaslonu ispred kojeg netko stoji bez telefona. Zato dodirni zaslon nosi vlastiti prikaz "Osnovno": gumb na početku sigurnosne trake, prije `/hitno` pilule koja ostaje krajnja desno, jedini drugi dodirni element na zaključanom zaslonu. Dodir otvara ploču preko istog prostora koji inače zauzima teaser (zaglavlje i sigurnosna traka ostaju vidljivi), sa sljedećim redcima — svaki izostavljen kad njegov izvor ne odgovara ili nema što reći: upozorenje DHMZ-a riječima, broj zatvorenih prometnica s najbližom imenovanom ulicom, sljedeći polasci ZET-a na liniji zaslona, opažanje s Maksimira, i najbliža dežurna ljekarna. Kad ni jedan izvor trenutačno ne odgovara, ploča to iskreno kaže i upućuje na `/hitno`, koji istu sigurnosnu liniju iscrtava na poslužitelju pa ne ovisi o istom dohvatu podataka na uređaju.

Ploča ne otvara sesiju, ne broji unatrag i ne javlja se u nijednu sobu — to je isti sigurnosni sloj koji `/hitno` već nudi na webu, samo dostupan jednim dodirom na samom zaslonu. Devedeset sekundi bez dodira ili tipke unutar ploče vraća zaslon na poziv za skeniranje; to je namjerno kratko, ne kao kazna nego zato da sljedeći prolaznik zatekne poziv na skeniranje, a ne tuđe čitanje. Bilo koji dodir ili tipka unutar ploče produljuje tih devedeset sekundi; `Natrag`, `Escape` ili taj tajmer je zatvaraju i vraćaju fokus na gumb.

## Sklopovlje (preporuka)

| Dio | Napomena |
|---|---|
| Raspberry Pi 5, 2 GB ili više | s hladnjakom; napajanje 27 W (službeno) |
| microSD 32 GB ili SSD preko USB-a | Raspberry Pi OS (64-bit, Bookworm) s radnom površinom |
| Zaslon 24" do 43", HDMI | okomiti ili vodoravni; stranica se prilagođava omjeru |
| Nosač i kabeli | mikro-HDMI na HDMI, produžni kabel napajanja |

Proračun u prijavi računa 245 EUR po novoj postavi (Pi, nosač, napajanje) i 95 EUR po oživljenom doniranom uređaju. Dvije nove postave u pilotu služe kao referenca i rezerva; četiri zaslona rade na doniranim uređajima.

## Stari uređaj kao zaslon (lagani način)

Najbolji zaslon je onaj koji prostor već ima. Ništa se ne instalira: uređaju treba preglednik, struja i mreža. Vidikovac ima lagani način rada bez karte, WebGL-a, `canvas` grafike i web-fontova, pa radi i na uređajima koje proizvođač više ne podržava.

- **Uključivanje:** doda se `?lagano=1` u adresu zaslona (`https://zagreb.aningfilm.hr/kiosk/?lagano=1#<id>.<tajna>`). Bez tog parametra zaslon sam prepozna slab uređaj (1 GB radne memorije ili manje, preglednik bez WebGL-a, ili uključena postavka štednje podataka) i prebaci se; odluka se pamti na uređaju, pa se provjera radi jedanput. `?lagano=0` vraća puni način.
- **Što se mijenja (i u što):** panorama nema `canvas` — ostaje legenda s brojem vozila i vremenom iznad crte od 2 px; meandar odbrojavanja je traka koja se prazni u deset koraka, bez prijelaza; shematska karta tramvaja je popis linija koje su trenutačno u kadru, s brojem vozila i kašnjenjem riječima — ne imenovane stanice, jer mrežni artefakt s njihovom geometrijom (`/data/zet-network.json`) ne učitava se u laganom načinu; puna karta u sloju U pokretu nije prikazana, ni njezin gumb; tipografija je sustavna (Segoe UI, Avenir Next ili što uređaj ima, i sustavni monospace za kod i legende) umjesto tri web-fonta koji sami teže više od cijelog proračuna prijenosa; prijelazi i animacije ne postoje.
- **Što se ne mijenja:** sigurnosna traka, rotacija koda i QR-a, kartice teasera, katalog, prikaz "Osnovno", raspored na 1920 × 1080 (zaglavlje, panorama, pozornica, traka) i sve riječi. Kod je ispisan istom širinom znamenki (tabularne brojke), pa se i na sustavnom fontu čita naglas kao dvije skupine od četiri znaka.
- **Mjerila koja držimo:** manje od 200 kB prijenosa po učitavanju, manje od 300 MB radne memorije, rad na uređaju s 1 GB RAM-a.
- **Izmjereni prijenos (12. rujna 2026., gzip razina 6, produkcijska izgradnja):** `/kiosk/` 57,5 kB (HTML 0,4; JS 50,8 u šest dijelova, od čega shematski popis 23,5 i zajednički temelj 12,5; CSS 6,3), `/d/` 57,1 kB. Web-fontovi, koje puni način učitava zasebno, sami bi dodali 207 do 248 kB (hrvatski tekst vuče `latin` i `latin-ext` podskup svake od tri porodice), zato ih lagani način ne učitava. Mrežni artefakt ZET-a (`/data/zet-network.json`, oko 500 kB) i MapLibre (1,1 MB) nisu u laganom grafu. Brojke provjerava `test/app/budget.test.ts` pri svakom pokretanju testova: gradi aplikaciju, zbraja sve što bi lagani zaslon prenio i pada iznad 200 kB ili čim se lagani graf pozove na fontove, kartu ili artefakt; `e2e/lagano.spec.ts` isto provjerava u pravom pregledniku na 1920 × 1080 (nijedan zahtjev za font, nijedan `canvas`, kod vidljiv bez klizanja).
- **Prikladni uređaji:** prijenosnik iz 2014. ili noviji s bilo kojim ažuriranim preglednikom, tablet iz 2015., Android TV kutija, otpisano uredsko računalo, iPad u načinu "Vođeni pristup", Raspberry Pi 3 ili noviji.
- **Što uređaj ne treba:** račun, trgovinu aplikacija, ažuriranje operacijskog sustava, antivirus. Zaslon ne drži nikakve korisničke podatke; jedino što je na uređaju je tajna tog zaslona, koju voditelj može opozvati jednim klikom.

### Raspored koji stari preglednik zna nacrtati

Stilovi zaslona (`app/src/ui/kiosk.css`) pisani su tako da preglednik iz 2017. dobije isti raspored: ispred svake novije deklaracije stoji starija istog značenja (`100vh` pa `100dvh`; `top`, `bottom` i `height` uz `inset-block`; `grid-gap` uz `gap`), stanje zaslona čita se iz atributa na korijenu (`data-mode`, `data-live`) umjesto iz `:has()`, a svi popisi koje lagani način crta (katalog, redci prikaza "Osnovno", popis linija, sigurnosna traka, zaglavlje) razmaknuti su marginama, a ne `gap`-om u flexboxu, koji preglednici prije 2020. ne poznaju. Veličine se računaju iz širine zaslona u JavaScriptu (`--kiosk-scale`), pa nema upitnika o spremniku.

### Zasebna inačica za ES2017 (kasniji zadatak)

Kod se danas isporučuje kao moderni ES modul. Zasebna inačica prevedena na ES2017 i matrica testiranih uređaja niže su zasebni zadaci plana provedbe (M1b i M3). Da taj zadatak ima od čega krenuti, ovo su mjesta u izvornom kodu aplikacije koja stari preglednik ne razumije i koja prevoditelj ne može sam pokriti, pa trebaju uvjetnu zamjenu (polyfill) ili grananje:

- **Sintaksa koju prevoditelj rješava sam:** opcijsko ulančavanje `?.` i `??` (2020., u gotovo svakoj datoteci), `??=` (`kiosk.ts`, `dashboard.ts`), `import()` (`entries/*.ts` za fontove, `map/city-map.ts` za MapLibre).
- **DOM i platforma bez izravne zamjene iz 2017.:** `Element.replaceChildren` (2020.; `kiosk.ts`, `dashboard.ts`, `scan.ts`, `motion/schematic-host.ts`), `Element.closest` (2015. u Chromeu, ali ne u IE 11; `kiosk.ts`), `<dialog>.showModal` (Firefox tek 2022.; `ui/dialog.ts`), `Promise.allSettled` (2020.; `kiosk.ts`, `dashboard.ts`), `Array.prototype.flatMap` (2019.; `export.ts`, `layers/index.ts`), `navigator.wakeLock` i `requestFullscreen` (već zaštićeni provjerom; `kiosk.ts`), `BarcodeDetector` (samo telefon, već s provjerom podrške; `ui/qrScanner.ts`), `navigator.deviceMemory` i upit `prefers-reduced-data` (samo kao ulaz u prepoznavanje slabog uređaja; nedostatak znači "nije slab", `ui/lagano.ts`), `Intl.PluralRules` (2017./2018.; `i18n/i18n.ts`) i `Intl.DateTimeFormat` s `timeZone` (`format.ts`), `globalThis` (2019., 36 mjesta; prevoditelj ga može zamijeniti sa `window`).
- **CSS izvan `kiosk.css` na laganim putevima:** `aspect-ratio` u `motion/schematic.css` (samo za `canvas` par, koji lagani način ne crta), `color-mix()` kao rezervna vrijednost `var()` u `panel.css`, `layers.css` i `dashboard.css` (tokeni su uvijek definirani, pa se rezerva nikad ne čita), logička svojstva (`inline-size`, `block-size`, `margin-block`, `padding-inline`, `border-block`, 2017.–2018. u Chromeu 57+ i Firefoxu 41+; Safari kasnije), `:focus-visible` (2020.; bez njega stari preglednik prikazuje zadani obrub fokusa).
- **Što lagani put ne dira nikada:** WebGL, `OffscreenCanvas`, `ResizeObserver` (nije u kodu; veličine idu preko `resize` događaja prozora), `IntersectionObserver`, container queries, `:has()`.

### Matrica testiranih uređaja

Popunjava se mjerenjem, a ne procjenom: vrijeme je do prvog ispisa koda, potrošnja se mjeri utičnim mjeračem pri normalnom radu. Uređaj koji padne na testu ostaje u tablici s razlogom.

| Uređaj | Godina | Preglednik | Način | Učitavanje | Potrošnja | Ishod |
|---|---|---|---|---|---|---|
| Raspberry Pi 5 2 GB | 2023. | Chromium 1xx | puni | | | referentna postava |
| [[POPUNITI: donirani prijenosnik]] | | | lagani | | | |
| [[POPUNITI: tablet 2015.]] | | | lagani | | | |
| [[POPUNITI: Android TV kutija]] | | | lagani | | | |
| [[POPUNITI: otpisano uredsko računalo]] | | | lagani | | | |

Tablica se objavljuje i na stranici projekta; mjerenja nastaju u M1b i M3 plana provedbe.

## Prvo postavljanje (Raspberry Pi OS Bookworm)

1. Instaliraj Raspberry Pi OS (64-bit) s radnom površinom pomoću Raspberry Pi Imagera; u postavkama Imagera upiši Wi-Fi mrežu prostora, korisničko ime `kiosk` i uključi SSH.
2. Prvo pokretanje: `sudo apt update && sudo apt full-upgrade -y && sudo apt install -y chromium-browser`.
3. Isključi gašenje zaslona: `sudo raspi-config` → Display Options → Screen Blanking → No. Isključi i uštedu energije na samom zaslonu (izbornik zaslona).
4. Postavi vremensku zonu: `sudo timedatectl set-timezone Europe/Zagreb`. Kiosk rotira kodove po zidnom satu, pa sat mora biti točan (NTP je uključen po zadanom).
5. Stvori skriptu `/home/kiosk/vidikovac-kiosk.sh`:

```sh
#!/bin/sh
# Vidikovac public screen. Chromium in kiosk mode, incognito so nothing of a
# previous session survives a restart except the screen's own credential,
# which the page keeps in localStorage of the incognito profile only for the
# lifetime of this process; the provisioning URL below re-supplies it on
# every start.
URL="$(cat /home/kiosk/vidikovac-kiosk.url)"
while true; do
  chromium-browser \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --incognito \
    --disable-session-crashed-bubble \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --check-for-update-interval=31536000 \
    --autoplay-policy=no-user-gesture-required \
    --ozone-platform=wayland \
    "$URL"
  sleep 5
done
```

   `chmod +x /home/kiosk/vidikovac-kiosk.sh`. Datoteka `/home/kiosk/vidikovac-kiosk.url` sadrži jedan redak: adresu za provizioniranje iz sljedećeg odjeljka. Dopuštenja: `chmod 600 /home/kiosk/vidikovac-kiosk.url`.

6. Automatsko pokretanje (labwc, zadani Wayland kompozitor Bookworma): dodaj redak u `~/.config/labwc/autostart`:

```
/home/kiosk/vidikovac-kiosk.sh &
```

   Ako je sesija još na Wayfireu ili X11, koristi `~/.config/wayfire.ini` (`[autostart]` odjeljak, `kiosk = /home/kiosk/vidikovac-kiosk.sh`) odnosno `~/.config/lxsession/LXDE-pi/autostart` (`@/home/kiosk/vidikovac-kiosk.sh`). Na X11 sakrij pokazivač paketom `unclutter` (`sudo apt install unclutter`, redak `@unclutter -idle 1`); na Waylandu stranica sama skriva pokazivač nakon pet sekundi bez pomaka.

7. Ponovno pokreni (`sudo reboot`). Zaslon mora sam doći do teasera bez dodira miša ili tipkovnice.

## Drugi preglednici

- **Windows ili macOS, Chrome ili Edge:** `chrome --kiosk --noerrdialogs --disable-infobars --incognito "https://zagreb.aningfilm.hr/kiosk/#..."`. Na Windowsu stvori prečac u mapi `shell:startup` s tim argumentima.
- **iPad:** otvori adresu u Safariju, dodaj na početni zaslon, uključi Postavke → Pristupačnost → Vođeni pristup i pokreni ga trostrukim klikom.
- **Bilo koji preglednik, ručno:** otvori adresu i pritisni F11. Prvi dodir ili klik na stranici traži puni zaslon i zabranu gašenja zaslona (Screen Wake Lock), što preglednici dopuštaju samo nakon korisničke radnje.

## Provizioniranje zaslona (jedanput)

1. Voditelj projekta otvara administrativnu stranicu zaštićenu Cloudflare Accessom i upisuje: vrstu prostora (`kafic`, `knjiznica`, `cetvrt`, `udruga`, `zet`, `ostalo`), gradsku četvrt (jedna od 17), oznaku prostora (na primjer "Kavana Velebit") i po želji GTFS oznaku stanice za teaser.
2. Sustav vraća adresu za provizioniranje oblika `https://zagreb.aningfilm.hr/kiosk/#K7Q2M9XZ.tajna`, koja se prikazuje samo jednom. Dio iza `#` nikada ne odlazi poslužitelju u zahtjevu; stranica ga čita lokalno.
3. Adresa se upiše u `/home/kiosk/vidikovac-kiosk.url` (ili u prečac). Pri svakom pokretanju stranica se tajnom predstavlja preko WebSocket veze (`/ws/beacon/<id>`): poslužitelj šalje izazov, zaslon odgovara HMAC potpisom, tri pogrešna odgovora zatvaraju vezu.
4. Ako se zaslon izgubi ili ukrade, voditelj ga označi kao opozvan na istoj administrativnoj stranici: veza se zatvara, kodovi prestaju vrijediti, adresa više ne radi.

## Mrežni zahtjevi

- Izlazni HTTPS (443) prema `zagreb.aningfilm.hr`, uključujući WebSocket (`wss://`) na istom hostu. Ništa ulazno, nema otvaranja portova, nema statičke adrese.
- Promet je malen: teaser osvježava podatke svakih 30 do 300 sekundi, WebSocket miruje između paketa kodova.
- Ako mreža padne, zaslon nastavlja rotirati preostale kodove iz zadnjeg paketa (do deset minuta), prikazuje posljednje poznate podatke s oznakom "zastarjelo" i sam se ponovno spaja s rastućim razmacima.
- Captive portali (prijava klikom na Wi-Fi) ne rade s kioskom; prostor treba dati pristup mreži bez portala ili odvojenu mrežu za zaslon.

## Pravilo iste mreže: što reći gostima

Zaslon zna kojom mrežom izlazi na internet, a poslužitelj uspoređuje mrežu zaslona s mrežom telefona koji skenira. Ako su iste (telefon je na Wi-Fiju istog prostora), skeniranje se odbija s porukom:

> Ovaj zaslon i tvoj telefon dijele istu mrežu. Isključi Wi-Fi i skeniraj mobilnim podacima.

Razlog je jednostavan: otključavanje dokazuje da si tu, pred zaslonom, s vlastitim uređajem, a ne da si samo spojen na isti Wi-Fi iz susjedne zgrade. Ništa se o mreži ne pohranjuje; usporedba se radi u memoriji i odbacuje.

**Osoblju za tisak uz zaslon (Croatian, singular):** "Skeniraj kod s telefona na mobilnim podacima, ne na našem Wi-Fiju. Otvorit će se stranica koja pita želiš li otključati ovaj zaslon na deset minuta. Pritisni Otključaj. Ako ne ide, isključi Wi-Fi na telefonu i probaj ponovno, ili utipkaj kod na zagreb.aningfilm.hr/s."

## Testni zaslon (samo za razvoj i automatske testove)

Na lokalnom `wrangler dev` poslužitelju s `NETWORK_CHECK=off` u `.dev.vars`, Playwright spec `e2e/pairing.spec.ts` sam stvara testni zaslon pozivom `POST /api/admin/beacons` sa zaglavljem `x-e2e-admin-bypass`, čija vrijednost mora biti jednaka varijabli `E2E_ADMIN_BYPASS` iz `.dev.vars` (najmanje 32 znaka; generiraj s `node -e "console.log(require('node:crypto').randomBytes(36).toString('base64url'))"`). U produkciji je `NETWORK_CHECK=enforce`, pa je taj prolaz mrtav bez obzira na varijablu. Za testove protiv produkcije voditelj jednom stvori zaslon "E2E testni zaslon" (vrsta `ostalo`) kroz Access i njegovu adresu za provizioniranje daje testovima kao `E2E_KIOSK_URL`.

## Rješavanje problema

| Simptom | Uzrok i rješenje |
|---|---|
| Zaslon prikazuje "Zaslon nije provizioniran" | `#` dio adrese nedostaje ili je pogrešan; provjeri `vidikovac-kiosk.url`. |
| "Zaslon je opozvan" | Voditelj je opozvao zaslon; treba novo provizioniranje. |
| Kodovi se rotiraju, ali skeniranje kaže "kod je istekao" | Sat uređaja kasni ili ide naprijed; provjeri `timedatectl` i NTP. |
| Gosti vide poruku o istoj mreži | Ispravno ponašanje, vidi pravilo iste mreže. Ako se pojavljuje i s mobilnim podacima, javi voditelju (mogući CGNAT slučaj); privremeni `NETWORK_CHECK=warn` je odluka voditelja. |
| Podaci imaju oznaku "zastarjelo" | Izvor je nedostupan ili je mreža pala; zaslon prikazuje zadnju dobru kopiju i sam se oporavlja. |
| Zaslon se ugasio nakon 10 minuta neaktivnosti | Screen Blanking nije isključen; ponovi korak 3. |
