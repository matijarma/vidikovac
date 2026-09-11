# Javni zaslon (Prozor): postavljanje i održavanje

Javni zaslon je bilo koji preglednik koji drži otvorenu stranicu `/kiosk/` na adresi https://zagreb.aningfilm.hr. Ne treba nikakav poseban softver: preporučeni uređaj je Raspberry Pi 5 s Chromiumom u kiosk načinu, ali jednako radi stari laptop, Windows PC iza televizora ili iPad u načinu "Vođeni pristup". Zaslon nema dodir (ako ga ima, dodir se ne koristi za navigaciju), prikazuje čitljiv javni pregled bez telefona i rotira QR kod koji otključava deset minuta nadzorne ploče.

## Što zaslon radi

- **Bez skeniranja (teaser):** uz donji rub stalno stoji sigurnosna traka (stanje upozorenja DHMZ-a, zatvorene prometnice u blizini, najbliža dežurna ljekarna); iznad nje se svakih 20 sekundi izmjenjuju kartice: vrijeme sada, sljedeći polasci na stanici koju je odabrao vlasnik prostora, zrak na najbližoj postaji, jedan naslov HRT-a, jedna arhivska slika "Zagreb, [godina]" s atribucijom i pozivna kartica ("Skeniraj za 10 minuta pogleda na Zagreb. Plaćaš pažnjom, ne novcem."). QR kod rotira svakih 30 sekundi unutar vidljivog prstena, a kod je ispisan u dvije skupine (`ABCD-EFGH`) da se može pročitati naglas ili utipkati.
- **Nakon skeniranja:** zaslon prikazuje isti sloj koji gleda osoba koja je skenirala (ona upravlja), u rasporedu za velike zaslone, sa sigurnosnom trakom i malim QR kodom "pridruži se" uz rub. Jedan zaslon vodi jedna osoba; sljedeći koji skeniraju dobivaju vlastitu sesiju na telefonu, ali ne upravljaju zaslonom.
- **Nakon deset minuta:** zaslon se vraća na teaser i novi QR kod. Nema hlađenja; ista osoba može odmah ponovno skenirati.

## Sklopovlje (preporuka)

| Dio | Napomena |
|---|---|
| Raspberry Pi 5, 2 GB ili više | s hladnjakom; napajanje 27 W (službeno) |
| microSD 32 GB ili SSD preko USB-a | Raspberry Pi OS (64-bit, Bookworm) s radnom površinom |
| Zaslon 24" do 43", HDMI | okomiti ili vodoravni; stranica se prilagođava omjeru |
| Nosač i kabeli | mikro-HDMI na HDMI, produžni kabel napajanja |

Proračun u prijavi računa 245 EUR po novoj postavi (Pi, nosač, napajanje) i 95 EUR po oživljenom doniranom uređaju. Dvije nove postave u pilotu služe kao referenca i rezerva; četiri zaslona rade na doniranim uređajima.

## Stari uređaj kao zaslon (lagani način)

Najbolji zaslon je onaj koji prostor već ima. Ništa se ne instalira: uređaju treba preglednik, struja i mreža. Vidikovac ima lagani način rada bez karte, WebGL-a i animacija, s kodom prevedenim i za starije preglednike, pa radi i na uređajima koje proizvođač više ne podržava.

- **Uključivanje:** doda se `?lagano=1` u adresu zaslona (`https://zagreb.aningfilm.hr/kiosk/?lagano=1#<id>.<tajna>`). Bez tog parametra zaslon sam prepozna slab uređaj i prebaci se.
- **Što otpada:** karta u sloju U pokretu (zamjenjuje je popis linija i kašnjenja), `canvas` grafike i prijelazi. Sve ostalo, uključujući sigurnosnu traku i rotaciju koda, radi isto.
- **Mjerila koja držimo:** manje od 200 kB prijenosa po učitavanju, manje od 300 MB radne memorije, rad na uređaju s 1 GB RAM-a.
- **Prikladni uređaji:** prijenosnik iz 2014. ili noviji s bilo kojim ažuriranim preglednikom, tablet iz 2015., Android TV kutija, otpisano uredsko računalo, iPad u načinu "Vođeni pristup", Raspberry Pi 3 ili noviji.
- **Što uređaj ne treba:** račun, trgovinu aplikacija, ažuriranje operacijskog sustava, antivirus. Zaslon ne drži nikakve korisničke podatke; jedino što je na uređaju je tajna tog zaslona, koju voditelj može opozvati jednim klikom.

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
