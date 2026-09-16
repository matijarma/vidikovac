# Rizici i odgovori na očekivane prigovore Povjerenstva

Osam prigovora koje očekujemo, s odgovorom koji je ugrađen u proizvod, ne obećan.

### 1. "Još jedna ZET aplikacija."

ZET je jedan od izvora u šest područja i ne pokušavamo ga zamijeniti: Promet prikazuje vozila i kašnjenja linija, a za planiranje putovanja upućuje na postojeće aplikacije. Vrijednost je u spoju: upozorenje DHMZ-a, zatvorena prometnica, potres, akt Službenog glasnika i večerašnje događanje na istom mjestu, u istoj minuti, s istim standardom atribucije. Kaj ima? se od aplikacije za jedno područje razlikuje po tom spoju, po javnim zaslonima koje vodi telefon, po otvorenom formatu kroz koji svaki izdavač u gradu objavljuje za sve zaslone i po skupu podataka o potražnji koji se vraća Gradu.

### 2. "Ograničen pristup se ne slaže s uvjetom 'rezultati nenaplatno dostupni javnosti'."

Nitko ništa ne plaća; nema računa, pretplate ni članstva. Sigurnosni sloj `/hitno` otvoren je svima bez uvjeta i bez ograničenja trajanja; javni zaslon je čitljiv bez telefona; kod i izvedeni podaci su otvoreni. Skeniranje ograničava trajanje pogleda na vlastitom uređaju na deset minuta i može se ponoviti odmah; tko nema zaslon u blizini može ga bez prijave sam postaviti na `/kiosk/`. Nudimo ugovorni minimum zaslona na lokacijama koje odabere Grad, kako pristup ne bi ovisio o komercijalnim prostorima. Kratki pogled otključan prisutnošću bit je proizvoda: izlog, ne pretplata.

### 3. "Jedna osoba nosi projekt."

Prototip je uživo prije roka i može se provjeriti u trenutku ocjenjivanja; proizvodi prijavitelja u produkciji (psh.lat, kompmajstor.eu) dokazuju iste primitive. Drugi razvojni inženjer, revizor pristupačnosti, dizajner i pravni pregled su u proračunu po satu, instalater po zaslonu. Kod se predaje i objavljuje pod otvorenom licencom; Grad dobiva ponudu pod EUPL-1.2 i može sustav preuzeti u cijelosti.

### 4. "Izvori su krhki: ZET feed je označen 'samo za testiranje', vrijeme.hr pada, CKAN se mijenja."

Svaki izvor ima ocjenu (zeleno, žuto, crveno), rok dohvata od 6 sekundi, predmemoriju, posljednju dobru kopiju i status na svakom panelu (živo, zastarjelo, nedostupno); stranica nikad nije prazna, a zastarjeli podatak nikad ne izgleda kao svjež. Dostupnost svakog izvora broji se i tromjesečno izvještava Gradskom uredu: prvi sustavni zapis o tome koji gradski izvori kasne ili padaju. Pismo ZET-u o oznaci "samo za testiranje" dio je plana (M2); do tada oznaka stoji uz panel.

### 5. "Kamere, praćenje, privatnost."

Ne upravljamo kamerama i ne prikazujemo tuđe bez dopuštenja. Nema računa, trajnog identifikatora korisnika, kolačića za praćenje, otiska uređaja ni zahtjeva za geolokaciju. IP adresa se ne pohranjuje u izvornom obliku i ne koristi kao obilježje osobe: prolazi kroz ograničivače učestalosti na rubu Cloudflarea, a za satnu kvotu samoposlužnih zaslona čuva se pseudonimizirani sažetak (HMAC) mrežnog prefiksa najviše 60 minuta. Brojači imaju samo dan, sat, događaj i dvije dimenzije iz zatvorenih rječnika; stranica `/privatnost` navodi brojane događaje. Izjava o privatnosti prolazi pravni pregled u M1.

### 6. "Održivost nakon projekta."

Trošak rada sustava nakon projekta je ispod 100 EUR godišnje (jedan plaćeni Cloudflare račun). Zaslone drže prostori koji od njih imaju korist, uz upute i opoziv na daljinu. Kod je otvoren i dokumentiran na hrvatskom; Grad ima ponudu pod EUPL-1.2. Projekt ne stvara ovisnost o osobi, tvrtki ni ugovoru.

### 7. "Stari uređaji su spori, nesigurni i past će za mjesec dana."

Zaslon prikazuje javne podatke i ne drži korisničke podatke, pa stari uređaj nema što izgubiti: jedina pohrana je tajna tog jednog zaslona, koju operater opoziva jednim zahtjevom na daljinu. Brzina je stvar mjerenja, ne vjere: lagani način rada (prijedlog projekta, 1.10) izbacuje kartu, WebGL i animacije i danas učitava zaslon sa 104 kB; mjerila za pilot su objavljena (manje od 200 kB po učitavanju, manje od 300 MB radne memorije, rad na uređaju s 1 GB RAM-a, potrošnja izmjerena po uređaju), a matrica testiranih uređaja navodi i uređaje koji su pali i zašto. Dvije nove postave na Raspberry Pi 5 su referenca i rezerva; na lokaciji koju odabere Grad postavlja se takva nova postava s tekućim sustavom, a donirani uređaji idu u ostale prostore, na gostujuću mrežu odvojenu od poslovne. Prostor može zamijeniti uređaj bez migracije, jer novi uređaj samo otvori istu adresu.

### 8. "Zašto filmska tvrtka?"

Zato što je javni zaslon medij, a ne samo sučelje: tipografija čitljiva s tri metra, ritam izmjene kartica, tema koja prati dnevno svjetlo, karta koja prati stvarna očitanja, kartica potvrde koja se čita u sekundi. To su zanati vizualnog pripovijedanja koje Aning Film radi. Softverska strana nije obećanje: prototip je uživo prije roka, a primitivi rade u produkciji drugih proizvoda prijavitelja.
