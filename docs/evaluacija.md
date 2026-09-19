# Kaj ima? · vodič za evaluaciju

Prototip i dokumenti dio su prijave Gradu Zagrebu. Evaluacijska adresa je od
14. rujna 2026. javno dostupna, bez prijave; razvoj građanske usluge i pilot
slijede samo uz financiranje. Nema zasebnog javnog lansiranja.

## Stvarni scenarij na dva uređaja

1. Otvoriti https://zagreb.aningfilm.hr na prijenosniku ili zaslonu. Odabrati
   otvaranje gradskog zaslona, četvrt i stvarno stajalište.
2. Zaslon dobiva vlastitu, privremenu postavu za 24 sata. Podaci su stvarni.
   Kôd na zaslonu jednokratan je i rotira svakih 30 sekundi.
3. Telefonom skenirati aktualni QR kod ili na `/s/` upisati prikazani kôd.
   Ista Wi-Fi mreža dopuštena je.
4. Potvrditi ulazak. Telefon dobiva redovnu desetominutnu sesiju. Provjeriti
   svih šest područja, odabrati liniju/stajalište ili stavku i pratiti kako se
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
  pratiti vozilo, razumjeti zatvaranje. Kašnjenje linije nije vrijeme dolaska;
  dolasci na odabranom stajalištu jesu procjena i moraju biti tako označeni.
- **Vrijeme:** usporediti opažanje i dnevnu prognozu, vjetar i sunce. Grafika
  ne prikazuje satne vrijednosti koje izvor nije objavio.
- **Događanja:** odabrati datum/kategoriju, pročitati detalj, otvoriti izvornik
  i spremiti pouzdano datiran događaj. Kvartovska obavijest bez datuma ostaje
  bez datuma.
- **Grad:** razlikovati fazu radova i navedeni iznos od potrošnje; pročitati
  podatke o sjednici i pronaći akt u najnovijem broju glasnika.
- **Sigurnost:** doći do broja i ljekarne, provjeriti upozorenja i zborna mjesta,
  otvoriti `/hitno` bez JavaScripta. Nedostupan izvor ne znači da nema upozorenja.

## Granice prototipa

Koriste se postojeći moduli podataka. Kvaliteta zraka, arhivska građa, HŽ i
putni planer pripadaju predloženom financiranom razdoblju, ne glume dovršene
mogućnosti. Dolasci po stajalištu od 19. rujna 2026. postoje, ali kao procjena
i tako označena: polazak kojemu je pronađeno praćeno vozilo prikazuje se kao
„za N min”, računato iz voznog reda i kašnjenja koje ZET objavljuje za to
vozilo, a svi ostali polasci zadržavaju vrijeme po voznom redu. Bez praćenog
vozila nema odbrojavanja, a HŽ-ove ploče ostaju samo vozni red. Službeni glasnik prikazuje dostupne
podatke i izvornike akata, ne izmišljeni puni tekst ili pravni sažetak.

Testirani preglednici, snimke zaslona, rezultati automatiziranih testova i
preostala ograničenja navode se u završnoj predaji. Fizička proba QR koda s
udaljenosti i testovi na stvarnom iPhoneu/Androidu ne smiju se zamijeniti
tvrdnjom da je automatizirani Chromium test dokaz istog.
