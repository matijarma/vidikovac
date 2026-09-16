# Demo video, 90 sekundi, 1920x1080, 30 fps

Hrvatski govor ili hrvatski titlovi urezani u sliku, engleski titlovi kao zasebna `.srt` datoteka. Snimanje u kafiću u ponedjeljak 14. 9. navečer (zaslon na Wi-Fiju prostora, telefon na mobilnim podacima, jedan iPhone i jedan Android), snimke zaslona u utorak 15. 9. ujutro protiv produkcije. Rez u DaVinci Resolveu; naslovna i završna kartica iz `video/` (Remotion). Video pokazuje samo ono što je gotovo.

| # | Od | Do | s | Kadar | Izvor | Tekst ili titl (hr) |
|---|---|---|---|---|---|---|
| 1 | 0 | 4 | 4 | Naslovna kartica: kicker, naslov, prsten QR-a | Remotion TitleCard | Dobro došli u budućnost. Zagreb, povezan. |
| 2 | 4 | 10 | 6 | Širok kadar kafića, zaslon na zidu u teaseru: sigurnosna traka, kartica vremena, QR u prstenu | Telefon, kafić | Javni zaslon. Čitljiv svima, bez telefona. |
| 3 | 10 | 16 | 6 | Krupni plan: telefon kamerom hvata rotirajući QR; kod ispisan u dvije skupine | Telefon, kafić | Skeniraj. Bez aplikacije, bez računa. |
| 4 | 16 | 22 | 6 | Dvostruki kadar: zaslon i telefon otključavaju se istodobno | Telefon, kafić | Oba uređaja se otključavaju u sekundi. |
| 5 | 22 | 26 | 4 | Krupni plan kartice potvrde na telefonu: "Zaslon: kafić, Donji grad, 10 minuta", gumb Otključaj | Telefon, kafić | Znaš što otključavaš i koliko traje. |
| 6 | 26 | 32 | 6 | Prijatelj skenira kod s telefona prve osobe ("Podijeli grad"), dobiva pet minuta | Telefon, kafić | Podijeli grad: pet minuta za drugu osobu. |
| 7 | 32 | 40 | 8 | Snimka zaslona: sloj Grad sada s upozorenjem DHMZ-a (CAP), vremenom i brojem ZET vozila | Snimka zaslona, /d/ | Sve u stvarnom vremenu, iz otvorenih podataka. |
| 8 | 40 | 48 | 8 | Snimka zaslona: U pokretu, karta sa ZET vozilima i zatvorenim prometnicama | Snimka zaslona, /d/ | ZET uživo. Zatvorene ceste na karti. |
| 9 | 48 | 54 | 6 | Snimka zaslona: Zrak i nebo, potresi EMSC-a i zrak | Snimka zaslona, /d/ | Potresi, zrak, nebo. |
| 10 | 54 | 60 | 6 | Snimka zaslona: Događanja s izvorom uz svaku najavu, izvoz "Kopiraj s izvorom" i ICS | Snimka zaslona, /d/ | Svaki podatak nosi izvor. Sve se može izvesti. |
| 11 | 60 | 68 | 8 | Snimka zaslona: odbrojavanje, upozorenje 60 s, istek: prikaz zamrznut, /hitno ostaje otvoren | Snimka zaslona, /d/ i /hitno | Deset minuta. Zatim se prikaz zamrzne, a sigurnosni sloj ostaje otvoren svima. |
| 12 | 68 | 76 | 8 | Snimka zaslona: /stats brojači bez identifikatora | Snimka zaslona, /stats | Gradu Zagrebu: anonimni zbrojevi po satu i četvrti. Bez IP adresa, bez kolačića. |
| 13 | 76 | 84 | 8 | Zaslon se vraća na teaser, novi QR u prstenu; osoblje briše stol | Telefon, kafić | Zaslon čeka sljedeću osobu. |
| 14 | 84 | 90 | 6 | Završna kartica: adresa, licenca, atribucije | Remotion EndCard | zagreb.aningfilm.hr · AGPL-3.0-or-later · izvori |

## Snimanje i rez

- Telefon vodoravno, 1080p 30 fps, zaključana ekspozicija na zaslonu (zaslon je izvor svjetla). Snimiti svaki kadar dva puta.
- Snimke zaslona: Chrome u prozoru 1920x1080, `chrome --window-size=1920,1080 --force-device-scale-factor=1`, snimanje s OBS-om ili `ffmpeg -f gdigrab`, bez pokazivača gdje nije potreban.
- Titlovi hr urezani (Inter 44 px, podloga 60 % crne); en `.srt` s istim vremenima iz ove tablice.
- Konačni izvoz: `ffmpeg -i rez.mov -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -c:a aac -b:a 160k demo.mp4`. Ako je datoteka ispod 25 MiB, ide u `app/public/demo.mp4` (granica Cloudflare statičkih datoteka je 25 MiB); inače u R2 javni bucket, a `/demo.mp4` preusmjerava.
- Uvijek i neizlistan YouTube upload; poveznica u prijavi i u README-u.
