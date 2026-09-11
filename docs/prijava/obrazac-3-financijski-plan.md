# Obrazac 3. Financijski plan i izračun troškova

Prijavitelj: Aning Film d.o.o. · Projekt: Vidikovac. Zagreb, povezan. · Svi iznosi su u eurima **bez PDV-a**. Ukupno zatraženo: **20.000,00 EUR**.

| Redak | Stavka | Izračun | Iznos (EUR) |
|---|---|---|---|
| 1. Troškovi zaposlenih | Matija Radeljak, voditelj projekta i glavni razvoj (ugovor o radu, direktor). Ukupno 500 sati. | 500 h × 12,60 EUR/h | 6.300,00 |
| 2. Troškovi vanjskih suradnika | Drugi razvojni inženjer, integracije izvora podataka i testovi: 150 h × 40,00 = 6.000,00. Revizija pristupačnosti i testiranje s korisnicima s invaliditetom (dvije revizije): 50 h × 45,00 = 2.250,00. UX i motion dizajn: 40 h × 40,00 = 1.600,00. Pravni i privacy pregled (izjave, licenca skupa za Grad): 8 h × 80,00 = 640,00. Instalacija četiri zaslona: 4 × 150,00 = 600,00. | 6.000 + 2.250 + 1.600 + 640 + 600 | 11.090,00 |
| 3. Troškovi promidžbe | Postprodukcija demo videa i titlovi (hr, en); tiskani stalci i upute za osoblje prostora; prezentacija na ZGBit susretu; javno predstavljanje u pilot kafiću. Najmanje 5 % odobrenog iznosa: ovdje 6,0 %. | paušal po stavkama | 1.200,00 |
| 4. Troškovi licenci i druge nematerijalne imovine | Cloudflare Workers Paid 12 mjeseci (5 USD/mj.) s korištenjem Durable Objects i R2; domena i alati. | 12 × oko 5 USD + korištenje + domena | 320,00 |
| 5. Troškovi opreme i druge materijalne imovine | Četiri pilot zaslona (Raspberry Pi 5 2 GB, zaslon, nosač, napajanje) 4 × 245,00 = 980,00; rezervni Raspberry Pi 65,00; kabeli i sitni materijal 45,00. | 980 + 65 + 45 | 1.090,00 |
| **Ukupno** | | | **20.000,00** |

Zbroj: 6.300,00 + 11.090,00 + 1.200,00 + 320,00 + 1.090,00 = 20.000,00 EUR bez PDV-a. Prijavitelj je u sustavu PDV-a i PDV nije trošak projekta.

## Obrazloženje satnice u retku 1

Prijavitelj je društvo s ograničenom odgovornošću u kojem je direktor jedini zaposlenik na ugovoru o radu, s bruto plaćom (bruto 1) od oko 1.550,00 EUR mjesečno. Satnica se računa metodom koja se koristi u projektima financiranima iz europskih fondova: **godišnji trošak rada podijeljen s 1.720 produktivnih sati**. Godišnji trošak rada je bruto 2, to jest bruto 1 uvećan za doprinos za zdravstveno osiguranje na plaću (16,5 %): 1.550,00 × 1,165 × 12 = 21.669,00 EUR; 21.669,00 / 1.720 = **12,60 EUR po satu**. Broj sati (500) je procjena voditelja za deset mjeseci provedbe uz paralelno vođenje tvrtke i potvrđuje se evidencijom radnog vremena po projektu. Iznos se prije predaje provjerava prema obračunu plaće za kolovoz 2026.

**Alternativa ako Grad primjenjuje formulu bruto / 155:** 1.550,00 / 155 = **10,00 EUR po satu**; redak 1 tada iznosi 500 × 10,00 = **5.000,00 EUR**, a razlika od 1.300,00 EUR premješta se u sate drugog razvojnog inženjera (dodatnih 32,5 h × 40,00), pa redak 2 iznosi **12.390,00 EUR**. Ostali redci se ne mijenjaju; ukupno ostaje 20.000,00 EUR bez PDV-a. Prijavitelj prihvaća bilo koju od dvije metode; upit o metodi poslan je na otvoreni.podaci@zagreb.hr 11. 9. 2026.

## Obrazloženje ostalih redaka

**Redak 2.** Drugi razvojni inženjer preuzima integracije žutih izvora (HAK, HEP, VIO, AZO WFS, HŽPP, BAJS, kultura) i pisanje testova za svaki parser, čime voditelj ostaje na protokolu, zaslonima i izvještajima. Revizija pristupačnosti se provodi dvaput (mjesec 2 i mjesec 9) s korisnicima s invaliditetom i rezultira dvjema inačicama izjave o pristupačnosti. UX i motion dizajn pokriva raspored za kiosk, prsten QR koda, stanja skenera i prijelaz u zamrznuti prikaz. Pravni i privacy pregled potvrđuje izjavu o privatnosti, licencu skupa podataka za Grad i tekstove atribucija. Instalacija zaslona uključuje montažu, mrežu i puštanje u rad na četiri lokacije.

**Redak 3.** Promidžba je ono što projektu daje javnost: 90-sekundni video s titlovima za ZGBit, društvene mreže i stranicu projekta; tiskane upute na svakom zaslonu ("Skeniraj kod s telefona na mobilnim podacima"); jedno javno predstavljanje u pilot kafiću s pozivom Gradskom uredu i medijima. Iznos od 1.200,00 EUR je 6,0 % od 20.000,00 EUR; ako se odobri manji iznos, promidžba ostaje najmanje 5 % odobrenog iznosa.

**Redak 4.** Cloudflare Workers Paid je jedini stalni trošak rada sustava; Durable Objects, KV i R2 unutar uključenih kvota ili s malim prekoračenjem; domena aningfilm.hr već postoji. Nakon projekta trošak ostaje ispod 100 EUR godišnje, što je temelj održivosti.

**Redak 5.** Četiri zaslona su pilot: kafić, prostor udruge, jedna lokacija koju odabere Grad (gradska četvrt, knjižnica ili ZET stanica) i jedna rezervna lokacija. Raspberry Pi 5 je odabran zbog cijene, potrošnje i podrške za Chromium u kiosk načinu; zasloni su standardni HDMI. Oprema ostaje u vlasništvu prijavitelja i u funkciji projekta najmanje do kraja Programa (31. 12. 2027.).

## Napomene

- Projekt nije i neće biti financiran iz drugih javnih izvora (Prilog 5.).
- Potpora je de minimis prema Uredbi (EU) 2023/2831; Aning Film d.o.o. i KompMajstor čine jednog poduzetnika i zajednički su ispod praga od 300.000 EUR u tri fiskalne godine (Prilozi 7.a i 7.b).
- Vlastito sufinanciranje nije propisano; plan je financiran u cijelosti iz potpore. Ako Grad zatraži udio, prijavitelj ga pokriva iz retka 1 (sati iznad 500 koje ne fakturira).
