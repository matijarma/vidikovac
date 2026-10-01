// Every Croatian string of /snimka/, verbatim from docs/snimka-2026-10.md
// section 11, nested by the dot path of its key (SN.badge.counts). The page is
// Croatian only, so there is no catalogue and no locale: the strings live
// here, in one object, for the owner's read-through. `{name}` is a
// placeholder for fill(). "štrajk" stands only under narration.* and
// sources.* (test/app/snimka-strings.test.ts holds the rules).
import type { Speed } from '../../../shared/snimka';

export const SN = {
  page: {
    title: 'Kaj ima? · Snimka',
    description: 'Snimka triju dana bez tramvaja i autobusa u Zagrebu, od 27. rujna do 1. listopada 2026., iz podataka aplikacije Kaj ima?',
    name: 'Snimka',
  },
  nav: {
    summary: 'Ukratko',
    stage: 'Snimka',
    screen: 'Zaslon',
    strip: 'Tijek',
    reckoning: 'Što se vidjelo',
    sources: 'Izvori',
  },
  hero: {
    eyebrow: 'Snimka · 27. rujna do 1. listopada 2026.',
    title: 'Tri dana bez tramvaja',
  },
  narration: {
    lede1: 'Radnici ZET-a i Zagrebačkog holdinga stupili su u štrajk u ponedjeljak 28. rujna u 03:30. Županijski sud u Zagrebu u srijedu 30. rujna proglasio je oba štrajka nezakonitima, a iste su se večeri tramvaji i autobusi vratili na ulice.',
    lede2: 'Ova je stranica snimka tih dana iz podataka koje je aplikacija tada imala: vozila u pokretu, bicikli na stanicama, zatvorene ulice i rečenice s javnog zaslona. Zaslon nije znao za štrajk; vidio je samo da vozila nema.',
  },
  kpi: {
    silent: 'sati gotovo bez vozila',
    silentSub: 'od {from} do {to}',
    peak: 'vozila u ponedjeljak u 07:45',
    peakSub: 'običan četvrtak u isto doba: {normal}',
    bikes: 'bicikala manje na stanicama',
    bikesSub: 's {from} na {to}; praznih stanica do {empty} od {stations}',
    return: 'minuta povratka',
    returnSub: 'srijeda, od {from} do {to}',
  },
  stage: {
    /** New for the read-through: the stage section's heading and lede (the brief names no string for them). */
    title: 'Grad na jednom satu',
    lede: 'Vozila na karti, stanje usluge, obavijesti ZET-a i naslovi iz medija, sve na istom satu. Pokreni, zaustavi ili povuci klizač na bilo koji trenutak.',
    mapLabel: 'Karta grada sa snimljenim vozilima',
    laganoNote: 'Lagani prikaz je bez karte; tijek, zaslon i naslovi su ispod.',
    reducedNote: 'Smanjeno kretanje je uključeno: snimka se ne pokreće sama.',
    scrubber: 'Trenutak snimke',
    valueText: '{day} u {time}',
    paused: 'Zaustavljeno: {day} u {time}.',
    playing: 'Snimka teče, {speed}.',
    end: 'Kraj snimke: {day} u {time}.',
  },
  controls: {
    play: 'Pokreni',
    pause: 'Zaustavi',
    prev: 'Prethodno poglavlje',
    next: 'Sljedeće poglavlje',
    chapters: 'Poglavlja',
    speed: 'Brzina',
  },
  speed: {
    1: 'stvarno vrijeme',
    60: '1 min/s',
    600: '10 min/s',
    3600: '1 h/s',
  } satisfies Record<Speed, string>,
  speedAria: {
    1: 'u stvarnom vremenu',
    60: 'minuta snimke u sekundi',
    600: 'deset minuta snimke u sekundi',
    3600: 'sat snimke u sekundi',
  } satisfies Record<Speed, string>,
  layers: {
    label: 'Slojevi',
    vehicles: 'Vozila',
    compare: 'Običan dan',
    bikes: 'BAJS',
    closures: 'Zatvorene ulice',
    noVehiclesAtSpeed: 'Pri brzini od sata u sekundi vozila se ne crtaju; brojke su u stanju usluge.',
    compareNote: 'Običan dan je četvrtak 24. rujna u isto doba dana.',
  },
  badge: {
    label: 'Stanje usluge',
    normal: 'Uobičajeno',
    reduced: 'Smanjeno',
    silent: 'Gotovo bez vozila',
    unknown: 'Nepoznato',
    loading: 'Učitavanje snimke',
    missing: 'Bez snimke',
    counts: 'u pokretu {seen}, po voznom redu oko {expected}',
    countsNoExpected: 'u pokretu {seen}',
    holds: 'traje {duration}',
    retroShort: 'naknadno',
    retroNote: 'Aplikacija objavljuje stanje usluge od {liveFrom}; ranije je stanje izračunano naknadno, istim pravilima, iz snimljenih podataka.',
  },
  feed: {
    frozen: 'ZET-ovi podaci nisu se mijenjali od {time}.',
    empty: 'ZET šalje podatke bez ijednog vozila.',
  },
  zet: {
    title: 'ZET javlja',
    none: 'Još nema obavijesti.',
    source: 'Izvor: ZET',
  },
  news: {
    title: 'Iz medija',
    none: 'U zadnja tri sata nema odabranog naslova.',
    meta: '{outlet} · {time}',
    newTab: '(otvara se u novoj kartici)',
  },
  marker: {
    title: 'Događaj',
  },
  screen: {
    title: 'Što je pisalo na zaslonu',
    lede: 'Javni zaslon na Trgu bana J. Jelačića: rečenica u zaglavlju i popis U blizini, iz zapisa svakih 20 sekundi.',
    nearby: 'U blizini',
    place: 'Trg bana J. Jelačića',
    boardNote: 'Između zapisa zaslona: sljedeći polasci s Trga bana J. Jelačića iz voznog reda koji je aplikacija tada imala.',
    captureCaption: 'Snimka zaslona, {day} u {time}',
    noCapture: 'Za ovo doba nema snimke zaslona.',
    quartetTitle: 'Isti zaslon, isto vrijeme, četiri jutra',
    quartetLede: 'Ponedjeljak, utorak, srijeda i četvrtak u 07:45.',
    quartet: {
      mon: 'Polasci iz voznog reda, izrečeni kao činjenica.',
      tue: 'Isto, dok se ZET-ovi podaci ne mijenjaju.',
      wed: 'Odstupanje izrečeno brojkama.',
      thu: 'Uobičajeno jutro.',
    },
    // New for the read-through (lane S3): the miniature's name, the board between runs without departures.
    miniLabel: 'Umanjeni prikaz javnog zaslona',
    boardNone: 'U voznom redu nema sljedećih polazaka.',
  },
  strip: {
    title: 'Tijek',
    lede: 'Tri i pol dana na jednoj osi. Crta prati sat; klik ili povlačenje premješta snimku.',
    fleet: 'Vozila u pokretu',
    fleetSeen: 'u pokretu',
    fleetExpected: 'po voznom redu',
    fleetCompare: 'običan dan',
    state: 'Stanje usluge',
    stateRetro: 'izračunano naknadno',
    stateNone: 'bez procjene',
    bikes: 'Bicikli na stanicama',
    bikesEmpty: 'Prazne stanice',
    feed: 'ZET-ovi podaci',
    feedEmpty: 'bez vozila',
    feedFrozen: 'ne mijenjaju se',
    product: 'Broj na zaslonu i stvarni broj',
    productScreen: 'zaslon je rekao',
    productFeed: 'vozila s položajem',
    news: 'Medijski naslovi po satu',
    readout: '{day} u {time}: {values}',
    table: 'Brojevi po satu',
    noValue: 'bez podatka',
    // New for the read-through (lane S3): the plots' name, the first column of every table.
    plotsLabel: 'Tijek na jednoj osi; strelice lijevo i desno pomiču snimku za deset minuta, sa Shiftom za sat.',
    hour: 'Sat',
  },
  reckoning: {
    title: 'Što se vidjelo',
    lede: 'Brojevi izračunati iz ove snimke. Ispod svakog piše kako.',
    silent: 'Koliko dugo gotovo bez vozila',
    silentMethod: 'Minute u stanju „gotovo bez vozila”, zbrojene po danima, iz stanja usluge izračunanog nad snimljenim podacima.',
    peak: 'Četiri jutra u 07:45',
    peakMethod: 'Vozila u pokretu u 07:45 svakog dana i običnog četvrtka 24. rujna u isto doba.',
    bikes: 'Bicikli kao zamjena',
    bikesMethod: 'Najmanji zbroj bicikala i najveći broj praznih stanica po danu, iz podataka nextbikea svake minute.',
    ghosts: 'Broj koji nije bio točan',
    ghostsLede: 'U ponedjeljak je zaslon brojio vozila kojih nije bilo: ZET je u ponoć vozilima upisao vrijeme dan unaprijed.',
    ghostsMethod: 'Razlika između broja koji je aplikacija objavila i broja vozila s položajem u ZET-ovim podacima, po minutama.',
    return: 'Povratak',
    returnMethod: 'Od prve minute s najmanje deset vozila u pokretu u srijedu navečer do prve minute uobičajenog stanja.',
    feed: 'ZET-ovi podaci',
    feedMethod: 'Minute u kojima ZET nije slao nijedno vozilo i minute u kojima se ZET-ovi podaci nisu mijenjali.',
    sentences: 'Što je zaslon govorio',
    sentencesMethod: 'Rečenice zaglavlja po vrsti, iz zapisa zaslona svakih 20 sekundi.',
    // New for the read-through (lane S3): the labels inside the cards.
    total: 'ukupno',
    span: 'od {from} do {to}',
    none: 'U snimci nema takvih minuta.',
    peakCompare: 'čet 24. 9., običan dan',
    day: 'Dan',
    bikesMin: 'najmanje bicikala',
    bikesEmptyMax: 'najviše praznih stanica',
    ghostsMax: 'Najveća razlika',
    ghostsMaxValue: '{count} više nego s položajem, {day} u {time}',
    ghostsMinutes: 'Minute s razlikom',
    ghostsSpan: 'Razdoblje',
    returnFrom: 'Prvih deset vozila u pokretu',
    returnTo: 'Prva minuta uobičajenog stanja',
    feedEmpty: 'ZET ne šalje nijedno vozilo',
    feedFrozen: 'ZET-ovi podaci se ne mijenjaju',
    feedLongest: 'najdulje {duration}, od {from}',
    liveRows: 'Redovi s polaskom uživo',
    liveRowsValue: '{live} od {rows} redova s polaskom',
    families: {
      'departure-timetable': 'Polazak po voznom redu',
      'departure-live': 'Polazak uživo',
      'first-last': 'Prvi ili zadnji polazak',
      service: 'Stanje usluge',
      outage: 'Bez ZET-ovih podataka',
      rail: 'Vlak',
      bikes: 'Bicikli',
      closure: 'Zatvorena ulica',
      event: 'Događanje',
      weather: 'Vrijeme',
      solar: 'Izlazak ili zalazak sunca',
      notice: 'Obavijest ZET-a',
      other: 'Ostalo',
    },
  },
  sources: {
    title: 'Izvori i zasluge',
    zet: 'Položaji vozila: ZET, javni GTFS-RT, izvedeni modelom kretanja aplikacije iz snimljenih podataka; sirovi podaci ZET-a ovdje se ne objavljuju. Obavijesti ZET-a: zet.hr.',
    nextbike: 'Bicikli: nextbike (BAJS), GBFS, CC0 1.0.',
    city: 'Zatvorene ulice: Grad Zagreb, data.zagreb.hr, Otvorena dozvola.',
    dhmz: 'Temperatura i vrijeme: DHMZ, postaja Zagreb-Maksimir, Otvorena dozvola.',
    news: 'Naslovi: Jutarnji list, Večernji list i N1. Svaki naslov vodi na izvorni članak; ovdje se prenose samo naslovi.',
    court: 'Presude: Županijski sud u Zagrebu, 30. rujna 2026., prema izvještajima medija i obavijesti ZET-a.',
    strike: 'Riječ štrajk stoji samo u tekstu ove stranice. Zaslon u snimci nikada je ne ispisuje: aplikacija zna stanje voznog parka, ne i njegov uzrok.',
    map: 'Karta: © OpenStreetMap contributors · Protomaps.',
    dataset: 'Opis skupa podataka',
    statistika: 'Statistika',
    prijava: 'Prijava projekta',
  },
  error: {
    load: 'Snimka se trenutačno ne može učitati.',
    retry: 'Pokušaj ponovno',
  },
  noscript: 'Snimka treba JavaScript. Izvori i opis skupa podataka nalaze se ispod.',
  // New for the read-through (the brief has no string for these):
  time: {
    /** duration() under one minute, where "0 min" would read as a count. */
    underMinute: 'manje od minute',
  },
  attribution: {
    /** The heading over the manifest's footnotes (gaps and caveats) under the attribution list. */
    notes: 'Napomene uz snimku',
  },
} as const;

export type SnimkaStrings = typeof SN;

// In tests and in development a placeholder nobody filled is a bug worth a throw; in production
// the text goes out as it is, a brace being better than a blank page.
const STRICT = ((): boolean => {
  try { return import.meta.env.MODE === 'test' || Boolean(import.meta.env.DEV); } catch { return false; }
})();

/** Replaces every `{name}` of `vars` in the template, as fill() in app/src/kiosk/strings.ts does. */
export function fill(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) out = out.split(`{${key}}`).join(String(value));
  if (STRICT) {
    const left = /\{([A-Za-z]+)\}/.exec(out);
    if (left) throw new Error(`snimka strings: placeholder {${left[1]}} left unfilled in "${template}"`);
  }
  return out;
}

/** Every leaf of SN with its dot path, for the guards. */
export function leaves(node: unknown = SN, prefix = ''): [key: string, text: string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}
