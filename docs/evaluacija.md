# Kaj ima? · vodič za evaluaciju

Prototip i dokumenti dio su prijave Gradu Zagrebu. Evaluacijska adresa je od
14. rujna 2026. javno dostupna, bez prijave; razvoj građanske usluge i pilot
slijede samo uz financiranje. Nema zasebnog javnog lansiranja.

## Stvarni scenarij na dva uređaja

1. Otvoriti evaluacijsku adresu na prijenosniku ili zaslonu i proći evaluacijsku
   prijavu. Odabrati otvaranje gradskog zaslona, četvrt i stvarno stajalište.
2. Zaslon dobiva vlastitu, privremenu postavu za 24 sata. Podaci su stvarni.
   Kôd na zaslonu jednokratan je i rotira svakih 30 sekundi.
3. Na telefonu otvoriti istu evaluacijsku adresu i prijaviti se u evaluacijsko
   okruženje prije skeniranja. Skenirati aktualni QR kod ili upisati prikazani
   kôd. Ista Wi-Fi mreža dopuštena je.
4. Potvrditi ulazak. Telefon dobiva redovnu desetominutnu sesiju. Provjeriti
   svih sedam područja, odabrati liniju/stajalište ili stavku i pratiti kako se
   kontekst prenosi na zaslon.
5. Putem „Podijeli grad” dati drugom telefonu pet minuta. Taj telefon ne može
   nastaviti lanac dijeljenja.
6. Pri završetku sesije provjeriti najavu, zaustavljanje osvježavanja i
   zadržavanje čitljive snimke. Izvoz sačuva izvor i datum.

Za radnu površinu nije potreban drugi fizički uređaj: u drugoj kartici
preglednika otvoriti unos koda i upisati kôd s prve kartice. To je redovno
uparivanje, ne posebna demonstracija. Sama postava zaslona ne otključava sesiju.

## Što provjeravati

- **Sada:** informacije iz više područja odmah su vidljive, a vrijeme sesije
  ne zauzima središte sučelja.
- **Promet:** pronaći liniju i stajalište, odabrati vozilo, promijeniti mjerilo,
  pratiti vozilo, razumjeti zatvaranje. Kašnjenje linije nije vrijeme dolaska.
- **Vrijeme:** usporediti opažanje i dnevnu prognozu, vjetar i sunce. Grafika
  ne prikazuje satne vrijednosti koje izvor nije objavio.
- **Događanja:** odabrati datum/kategoriju, pročitati detalj, otvoriti izvornik
  i spremiti pouzdano datiran događaj. Kvartovska obavijest bez datuma ostaje
  bez datuma.
- **Grad:** razlikovati fazu radova i navedeni iznos od potrošnje; pročitati
  podatke o sjednici i pronaći akt u najnovijem broju glasnika.
- **Vijesti:** razlikovati HRT i Radio Sljeme te vidjeti stvarni datum objave.
- **Sigurnost:** doći do broja i ljekarne, provjeriti upozorenja i zborna mjesta,
  otvoriti `/hitno` bez JavaScripta. Nedostupan izvor ne znači da nema upozorenja.

## Granice prototipa

Koriste se postojeći moduli podataka. Kvaliteta zraka, arhivska građa, HŽ,
putni planer i dolasci po stajalištu pripadaju predloženom financiranom
razdoblju, ne glume dovršene mogućnosti. Službeni glasnik prikazuje dostupne
podatke i izvornike akata, ne izmišljeni puni tekst ili pravni sažetak.

Testirani preglednici, snimke zaslona, rezultati automatiziranih testova i
preostala ograničenja navode se u završnoj predaji. Fizička proba QR koda s
udaljenosti i testovi na stvarnom iPhoneu/Androidu ne smiju se zamijeniti
tvrdnjom da je automatizirani Chromium test dokaz istog.
