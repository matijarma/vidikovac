// Every Croatian string of /snimka/, nested by the dot path of its key (SN.badge.counts): docs/snimka-2026-10.md
// section 11, the v2 plan's Appendix B and, since 2 October 2026 (evening), the v3 plan's Appendix A
// (~/.claude/plans/look-at-the-page-generic-crown.md). The page is Croatian only, so there is no catalogue and no
// locale: the strings live here, in one object, for the owner's read-through. `{name}` is a placeholder for fill().
// "štrajk" stands only under narration.* and sources.* (test/app/snimka-strings.test.ts holds the rules). A key
// marked `v3: delete after W<n>` is dead in v3 but still imported by a module lane W<n> rebuilds; the orchestrator
// deletes it once that lane lands.
//
// Plural forms: an array of three (one, few, many: 1 sat, 3 sata, 5 sati), picked by plural() from format.ts. Where
// the number leads, the forms omit it and count() prepends it; where text comes before the number, the forms carry
// {n} (or the placeholder the comment names) and go through fill().
//
// Vocabulary (plan §4 R7, one word per concept; a new string uses these words and no others):
// - snimka: the recording of the days (never a screenshot); a screenshot of the screen is "izgled zaslona".
// - zaslon, javni zaslon: the public screen on Trg bana Jelačića (that name, never "Trg bana J. Jelačića").
// - "na zaslonu je pisalo": what the screen showed (never "zaslon je rekao/govorio"); zapis: the observed record.
// - "po današnjim pravilima" (mark "izračun"): the sentence computed now; "izračunano naknadno", never bare "naknadno".
// - aplikacija: the app ("Kaj ima?" only as a name, in credits and the lede).
// - običan dan: the normal day (never "obično"); for bikes the normal day is "čet 1. 10." and is always named so.
// - "po voznom redu {n}": the timetable figure, exact, without "oko" (the screen's own quoted sentences keep theirs).
// - u pokretu: moving vehicles (never "viđena").
// - states: Uobičajeno · Smanjeno · Gotovo bez vozila · Bez procjene; missing data: "bez podatka" (never "Nepoznato", never 0).
// - a stalled feed: "ZET-ovi podaci ne mijenjaju se" (the event: zastoj; never "stoje").
// - the feed column: Objave; the panels: pokazatelji; open: detalji; close: Zatvori.
// - a page section: odjeljak „…”; a step of the recording: poglavlje (never "koraci").
// - preuzimanja, skup, datoteka; redak (retka, redaka), never "red/redova".
// - "u stvarnom vremenu" for real-time data; "uživo" only on the I danas band.
// - stanica BAJS-a (bikes), stajalište (trams and buses); Grad: the administration; građani: the people.
import type { Speed } from '../../../shared/snimka';

export const SN = {
  page: {
    title: 'Kaj ima? · Snimka',
    description: 'Snimka Zagreba od 27. rujna do 2. listopada 2026., s tri dana bez tramvaja i autobusa, iz podataka aplikacije Kaj ima?: što se događalo, što je pisalo na zaslonu i koji su podaci iz toga nastali.',
    name: 'Snimka',
  },
  nav: {
    snimka: 'Snimka',
    pokazuje: 'Što snimka pokazuje',
    screen: 'Zaslon',
    strip: 'Tijek',
    data: 'Podaci i izvori',
    /** v3: delete after W4b (report.ts names the question chips' sections with it) */
    alternatives: 'Zamjene',
    /** v3: delete after W4b (report.ts) */
    reckoning: 'Što se vidjelo',
    /** v3: delete after W4b (report.ts) */
    open: 'Otvoreni podaci',
  },
  hero: {
    eyebrow: 'Snimka · od 27. rujna do 2. listopada 2026.',
    title: 'Tri dana bez tramvaja',
  },
  narration: {
    lede: 'Radnici ZET-a i Zagrebačkog holdinga štrajkali su od ponedjeljka 28. rujna u 03:30; u srijedu je Županijski sud štrajk proglasio nezakonitim i iste su se večeri tramvaji i autobusi vratili. Ovo je snimka tih dana iz podataka koje je aplikacija Kaj ima? tada imala, minutu po minutu: vozila, bicikli, obavijesti i ono što je pisalo na zaslonu na Trgu bana Jelačića.',
    /** The hero's one instruction line; the entry swaps in howToReduced under prefers-reduced-motion. */
    howTo: 'Snimka teče deset minuta u sekundi. Zaustavi je ili povuci crtu ispod karte; svaka brojka uspoređuje taj trenutak s običnim danom.',
    howToReduced: 'Pokreni snimku ili povuci crtu ispod karte; svaka brojka uspoređuje taj trenutak s običnim danom.',
    /** v3: delete after W4b (report.ts upgradeQuestions; the chips left the HTML) */
    q1: 'Što sam mogao umjesto tramvaja?',
    /** v3: delete after W4b */
    q2: 'Koliko je štrajk bio potpun?',
    /** v3: delete after W4b */
    q3: 'Što je grad mogao znati u svakoj minuti?',
    /** v3: delete after W4b */
    q4: 'Odakle brojevi i kako ih provjeriti?',
  },
  /** v3: delete after W4b (report.ts upgradeQuestions) */
  questions: {
    label: 'Ulazi u snimku',
    goes: 'Otvara poglavlje {chapter}; odgovor je u odjeljku {section}.',
    section: 'Odgovor u odjeljku',
  },
  kpi: {
    /** Forms after the figure (count() prepends it): "63 sata gotovo bez vozila". */
    silent: ['sat gotovo bez vozila', 'sata gotovo bez vozila', 'sati gotovo bez vozila'],
    silentSub: 'od {from} do {to}',
    /** Forms after the figure, picked by the figure: "126 od 200 stanica BAJS-a prazno". */
    bikes: ['od {stations} stanica BAJS-a prazna', 'od {stations} stanica BAJS-a prazne', 'od {stations} stanica BAJS-a prazno'],
    bikesSub: '{day} u {time} · čet 1. 10. u isto doba: {normal}',
    /** Forms after the figure: "114 minuta od prvih vozila do uobičajenog stanja". */
    return: ['minuta od prvih vozila do uobičajenog stanja', 'minute od prvih vozila do uobičajenog stanja', 'minuta od prvih vozila do uobičajenog stanja'],
    returnSub: 'u srijedu 30. 9. od {from} do {to}',
    /** A tile's seek button: the tile moves the instrument to its moment. */
    show: 'Pokaži u snimci',
    /** v3: delete after W4a (the "2 vozila" tile goes) */
    peak: ['vozilo u ponedjeljak u 07:45', 'vozila u ponedjeljak u 07:45', 'vozila u ponedjeljak u 07:45'],
    /** v3: delete after W4a */
    peakSub: 'običan četvrtak u isto doba: {normal}',
    /** v3: delete after W4a */
    peakDaySub: '{day}, običan dan u isto doba: {normal}',
    /** v3: delete after W4a (the alerts tile goes: it summed alert-minutes) */
    alerts: 'upozorenja u ZET-ovim podacima',
    /** v3: delete after W4a */
    alertsSub: '{alerts} upozorenja i {cancelled} otkazanih vožnji u {hours} sati snimke',
  },
  stage: {
    title: 'Snimka grada',
    lede: 'Karta, stanje usluge, objave i poglavlja teku zajedno, minutu po minutu. Pusti snimku da teče ili odaberi objavu, poglavlje ili liniju.',
    mapLabel: 'Karta grada sa snimljenim vozilima',
    laganoNote: 'U laganom prikazu nema karte; tijek, zaslon i naslovi su ispod.',
    reducedNote: 'Na uređaju je uključeno smanjeno kretanje, pa se snimka ne pokreće sama.',
    scrubber: 'Trenutak snimke',
    valueText: '{day} u {time}',
    paused: 'Pauzirano: {day} u {time}.',
    playing: 'Snimka teče, {speed}.',
    end: 'Kraj snimke: {day} u {time}.',
  },
  controls: {
    play: 'Pokreni',
    pause: 'Pauziraj',
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
    60: 'jedna minuta snimke u sekundi',
    600: 'deset minuta snimke u sekundi',
    3600: 'jedan sat snimke u sekundi',
  } satisfies Record<Speed, string>,
  panel: {
    vehicles: 'Vozila',
    network: 'Mreža',
    bikes: 'Bicikli',
    collapse: 'Zatvori',
    deeper: 'Više u odjeljku „{section}”',
    deckLabel: 'Pokazatelji',
    /** v3: delete after W2 (Stanje merges into Vozila) */
    state: 'Stanje',
    /** v3: delete after W2 (Linije merges into Mreža) */
    lines: 'Linije',
    /** v3: delete after W2 and W4a (Vrijeme leaves the deck and the strip) */
    weather: 'Vrijeme',
    /** v3: delete after W3 (Poglavlja leaves the deck; agenda.ts) */
    agenda: 'Poglavlja',
    /** v3: delete after W2 (one close button, "Zatvori") */
    back: 'Natrag na pregled',
  },
  readout: {
    moving: 'u pokretu',
    /** v3: delete after W2 (readout.normalDay replaces it) */
    normal: 'običan dan',
    normalDay: 'običan dan',
    normalDaySub: 'običan dan ({day}) u isto doba: {n}',
    expected: 'po voznom redu',
    /** The two-bar glyph's accessible name. */
    bar2Aria: 'sada {now}, običan dan {normal}',
    bikesForms: ['bicikl', 'bicikla', 'bicikala'],
    emptyForms: ['prazna stanica', 'prazne stanice', 'praznih stanica'],
    /** Forms after the figure (count() prepends it): "84 praznih stanica · čet 1. 10.: 43". */
    bikesEmptyVs: ['prazna stanica · čet 1. 10.: {normal}', 'prazne stanice · čet 1. 10.: {normal}', 'praznih stanica · čet 1. 10.: {normal}'],
    bikesVs: 'bicikala {n} · čet 1. 10.: {normal}',
    stations: 'Prazne sada, a u četvrtak 1. 10. nisu bile',
    stationsBikes: 'Broj bicikala',
    weatherClause: 'Sva tri dana suho, od 8 do 25 °C (DHMZ, Maksimir).',
    /** v3: delete after W2 (the weather clause replaces the weather face) */
    weather: '{temp} °C, {words}',
    /** v3: delete after W2 */
    weatherTempOnly: '{temp} °C',
    weatherNone: 'bez podatka DHMZ-a',
    dataPath: 'u ZET-ovim podacima {entities} vozila: u spremištu {depot}, stoji izvan spremišta {parked}, u pokretu {seen}; na zaslonu {published}',
    /** v3: delete after W2 (Mreža's captions carry the counts: twins.count) */
    linesCount: '{alive} od {scheduled} linija po voznom redu ima vozilo',
    // The state rules in words (worker/twin/service.ts); in v3 they move to the dossier card.
    rules: {
      title: 'Kako aplikacija određuje stanje usluge',
      reduced: '„Smanjeno”: u pokretu je manje od polovice vozila po voznom redu, ili su tramvaji ili autobusi zasebno ispod 40 % svojeg voznog reda, pet minuta zaredom.',
      silent: '„Gotovo bez vozila”: u pokretu su najviše dva vozila ili desetina voznog reda, deset minuta zaredom.',
      lift: 'Iz stanja „gotovo bez vozila” izlazi se kad je u pokretu barem četvrtina voznog reda tri minute zaredom.',
      normal: '„Uobičajeno”: u pokretu je barem 70 % voznog reda, i to barem 60 % tramvaja i 60 % autobusa, pet minuta zaredom.',
      hold: '„Bez procjene”: kad je po voznom redu manje od 20 vozila ili kad se ZET-ovi podaci ne mijenjaju.',
    },
    rail: 'Vlakova nema na karti: snimka bilježi samo ZET-ova vozila.',
    dataPathTitle: 'Od ZET-ovih podataka do zaslona',
    vehicles: 'Vozila u pokretu i po voznom redu',
    weatherSource: 'DHMZ, Zagreb-Maksimir, po satu',
    loading: 'Učitava se.',
    failed: 'Ovaj se dio snimke trenutačno ne može učitati.',
  },
  layers: {
    label: 'Slojevi',
    vehicles: 'Vozila',
    compare: 'Običan dan',
    bikes: 'Bicikli',
    compareAria: 'Usporedi s običnim danom',
    compareWhich: 'Običan dan je {day} u isto doba.',
    compareGap: 'Običan dan: bez zapisa za ovo doba.',
    compareSunday: 'Nedjelja nema usporedbe.',
    bikesLegend: 'Bicikli: tamnije je punije; crveni rub znači prazniju stanicu nego u četvrtak 1. 10. u isto doba.',
    bikesMissing: 'Bicikli: bez podataka do 22:05.',
    noVehiclesAtSpeed: 'Pri satu u sekundi karta pokazuje samo bicikle; vozila se vide pri 10 min/s i sporije.',
    /** v3: delete after W1 (the camera toggle becomes director.toggle in the control stack) */
    follow: 'Karta prati snimku',
    /** v3: delete after W1 (Zatvorene ulice leave the stage) */
    closures: 'Zatvorene ulice',
    /** v3: delete after W1 (no chip group labels) */
    sources: 'Izvori',
    /** v3: delete after W1 */
    derived: 'Kaj ima? izvodi',
    /** v3: delete after W1 (Živa mreža goes) */
    live: 'Živa mreža',
    /** v3: delete after W1 and W2 */
    liveNote: 'Linija svijetli dok je na njoj u zadnjih 15 minuta bilo vozilo; siva je linija po voznom redu bez vozila; tanka je linija izvan voznog reda.',
  },
  legend: {
    ghost: 'vozilo na običan dan',
    /** v3: delete after W1 and W2 (stage legend, Mreža depth and minimap legend) */
    alive: 'linija s vozilom',
    /** v3: delete after W1 and W2 */
    dead: 'po voznom redu, bez vozila',
    /** v3: delete after W1 and W2 */
    quiet: 'izvan voznog reda',
  },
  twins: {
    title: 'Dvije mreže u istom trenutku',
    now: '{day}',
    normal: '{day}, isto doba',
    count: 'linije s vozilom: {alive} od {scheduled}',
  },
  camera: {
    /** The edge marker of a vehicle outside the network frame. */
    offFrame: ['→ {n} vozilo izvan kadra', '→ {n} vozila izvan kadra', '→ {n} vozila izvan kadra'],
  },
  timeline: {
    label: 'Vremenska crta snimke',
    chapters: 'Poglavlja',
    marks: 'ZET i sud',
    chapterList: 'Popis poglavlja',
    next: 'Sljedeće: {time} · {title}',
    goTo: 'Idi na: {title}',
    retro: 'izračunano naknadno',
    rug: 'ZET ne šalje podatke ili se ne osvježavaju',
    /** v3: delete after W3 (the ZET/court marker row: timeline.marks) */
    notices: 'Obavijesti i presude',
    /** v3: delete after W3 (the press lane goes) */
    press: 'Mediji',
  },
  director: {
    toggle: 'Karta prati događaje',
    note: 'Dok snimka teče, karta sama prelazi na mjesto događaja. Kad pomakneš kartu ili odabereš liniju, prestaje to raditi; ponovno počinje sa sljedećim poglavljem ili ovim gumbom.',
    resume: 'Karta neka prati događaje',
  },
  subject: {
    label: 'Odabrano',
    line: 'Linija {short}',
    station: 'Stanica BAJS-a {name}',
    stop: 'Stajalište {name}',
    now: 'sada u pokretu {seen}, po voznom redu {expected}',
    lineVsNormal: 'Linija {short}: sada {seen} vozila, običan dan {normal} u isto doba',
    mini: 'Vozila na liniji kroz snimku',
    bikesNow: 'bicikli sada: {n} od {capacity} mjesta',
    clear: 'Ukloni odabir',
    hint: 'Odaberi liniju ili stanicu na karti ili redak u tablici linija.',
  },
  present: {
    /** The fullscreen icon button's accessible name. */
    enter: 'Cijeli zaslon',
    exit: 'Izađi iz cijelog zaslona',
    hint: 'Tipka F uključuje cijeli zaslon, Escape ga isključuje; gumbi se skrivaju nakon tri sekunde bez pomicanja.',
    unsupported: 'Preglednik ne podržava cijeli zaslon.',
  },
  subtitle: {
    label: 'Što piše na zaslonu',
    observed: 'Na zaslonu je pisalo',
    replayed: 'Po današnjim pravilima pisalo bi',
    markObserved: 'zapis',
    markReplayed: 'izračun',
    observedNote: 'Zapis javnog zaslona na Trgu bana Jelačića u toj minuti.',
    replayedNote: 'Rečenicu je naknadno izračunala današnja inačica aplikacije iz podataka te minute.',
    more: 'Što je pisalo na zaslonu →',
    /** v3: delete after W3 (the subtitle never flashes "none"; the last line stays dimmed) */
    none: 'Za ovu minutu nema rečenice.',
  },
  voices: {
    title: 'Objave',
    empty: 'Do ovog trenutka nema objava.',
    kind: {
      zet: 'ZET',
      court: 'Sud',
      press: 'Mediji',
      chapter: 'Poglavlje',
      /** v3: delete after W3 (the app's own items leave the list) */
      companion: 'Aplikacija',
      /** v3: delete after W3 (recording-internal events leave the list; chapters are kind.chapter) */
      event: 'Snimka',
    },
    atThatMinute: 'U toj minuti',
    atPublish: 'U minuti objave',
    seek: 'Idi na {time}',
    meta: '{outlet} · {time}',
    /** By plural of the folded count; {count} carries the "+" ("+2 slična naslova"). */
    moreForms: ['{count} sličan naslov', '{count} slična naslova', '{count} sličnih naslova'],
    filtered: 'Samo {subject} · skriveno {n}',
    clear: 'Prikaži sve',
    /** v3: delete after W3 */
    lede: 'ZET, sud, mediji i sama aplikacija, redom kako su se oglašavali.',
    /** v3: delete after W3 (no "Starije" cap) */
    older: 'Starije',
    /** v3: delete after W3 (voices.filtered carries the count) */
    hiddenForms: ['{count} stavka bez te teme', '{count} stavke bez te teme', '{count} stavki bez te teme'],
    /** v3: delete after W3 and W4a (beat pills go; the press links use alternatives.beat) */
    beat: {
      najava: 'Najava',
      pocetak: 'Početak',
      'prvo-jutro': 'Prvo jutro',
      'jedan-tramvaj': 'Jedan tramvaj',
      'linija-228': 'Linija 228',
      'sud-privremeno': 'Sud, privremeno',
      presuda: 'Presuda',
      povratak: 'Povratak',
      bajs: 'BAJS',
      taksi: 'Taksi',
      volonteri: 'Volonteri',
      skole: 'Škole',
      'drugi-dan': 'Drugi dan',
      'treci-dan': 'Treći dan',
      holding: 'Holding',
      guzve: 'Gužve',
      pregovori: 'Pregovori',
      vlak: 'Vlak',
      nakon: 'Nakon',
    },
  },
  facts: {
    seen: 'u pokretu {n}',
    expected: 'po voznom redu {n}',
    state: 'stanje: {state}',
    /** Forms after the figure (count() prepends it). */
    bikes: ['bicikl', 'bicikla', 'bicikala'],
    /** Forms after the figure (count() prepends it). */
    bikesEmpty: ['prazna stanica', 'prazne stanice', 'praznih stanica'],
    temp: '{n} °C',
    feedEmpty: 'u ZET-ovim podacima nema vozila',
    feedFrozen: 'ZET-ovi podaci ne mijenjaju se',
    route: 'linija {route}: {seen} od {expected} vozila',
    /** facts.route when more vehicles ran than the timetable had. */
    routeOver: 'linija {route}: {seen} vozila (po voznom redu {expected})',
    routeNone: 'linija {route}: nijedno vozilo',
    station: '{name}: {bikes}',
    stationEmpty: '{name}: prazna',
    none: 'bez podatka',
    /** v3: delete after W1 (the closures chip goes) */
    closures: 'zatvorenih ulica {n}',
  },
  agenda: {
    title: 'Poglavlja',
    lede: 'Ključni trenuci snimke; klik premješta snimku na taj trenutak.',
    current: 'Trenutno poglavlje',
    open: 'Otvori poglavlje',
    keys: 'Strelice biraju poglavlje, Enter ga otvara.',
  },
  badge: {
    label: 'Stanje usluge',
    normal: 'Uobičajeno',
    reduced: 'Smanjeno',
    silent: 'Gotovo bez vozila',
    unknown: 'Bez procjene',
    counts: 'u pokretu {seen}, po voznom redu {expected}',
    countsNoExpected: 'u pokretu {seen}',
    holds: 'traje {duration}',
    retroShort: 'izračunano naknadno',
    retroNote: 'Aplikacija objavljuje stanje usluge od {liveFrom}; ranije je stanje izračunano naknadno, istim pravilima, iz snimljenih podataka.',
  },
  zet: {
    source: 'Izvor: ZET',
  },
  news: {
    newTab: '(otvara se u novoj kartici)',
  },
  screen: {
    title: 'Što je pisalo na zaslonu',
    lede: 'Zaslon aplikacije na Trgu bana Jelačića nije znao zašto vozila nema; vidio je samo da ih nema. Ispod je što je na njemu pisalo i što bi pisalo po današnjim pravilima u istoj minuti.',
    wrote: 'Na zaslonu je pisalo:',
    wouldWrite: 'Po današnjim pravilima pisalo bi:',
    notRecorded: 'U ovoj minuti zaslon nije snimljen.',
    nearby: 'U blizini',
    place: 'Trg bana Jelačića',
    boardNote: 'Između zapisa zaslona: sljedeći polasci s Trga bana Jelačića iz voznog reda koji je aplikacija tada imala.',
    captureCaption: 'Izgled zaslona, {day} u {time}',
    captureOpen: 'Fotografija zaslona',
    morningsTitle: 'Pet jutara u 07:45',
    morningsLede: 'Isti zaslon u isto doba, od ponedjeljka do petka.',
    colDay: 'Dan',
    colMoving: 'U pokretu (običan dan)',
    colWrote: 'Na zaslonu je pisalo',
    colWould: 'Po današnjim pravilima',
    mornings: {
      mon: 'Zaslon najavljuje polaske po voznom redu kao da voze.',
      tue: 'ZET-ovi podaci ne mijenjaju se; zaslon i dalje najavljuje polaske.',
      wed: 'Zaslon brojkama kaže koliko vozila nedostaje.',
      thu: 'Uobičajeno jutro.',
      fri: 'Opet uobičajeno jutro.',
    },
    miniLabel: 'Umanjeni prikaz javnog zaslona',
    boardNone: 'U voznom redu nema sljedećih polazaka.',
    replayedNote: 'Ovako bi pisalo na zaslonu da je nadogradnja od 29. rujna postojala od početka.',
    noReplayed: 'Za ovu minutu nema izračunane rečenice.',
    /** v3: delete after W4b (screen.notRecorded replaces it) */
    noCapture: 'Za ovo doba nema izgleda zaslona.',
    /** v3: delete after W4b (screen.morningsTitle) */
    quartetTitle: 'Isti zaslon, isti trenutak, pet jutara',
    /** v3: delete after W4b (screen.morningsLede) */
    quartetLede: 'Od ponedjeljka do petka u 07:45: zapis zaslona gdje postoji i rečenica današnjih pravila.',
    /** v3: delete after W4b (screen.mornings) */
    quartet: {
      mon: 'Polasci iz voznog reda, izrečeni kao činjenica.',
      tue: 'Isto, dok se ZET-ovi podaci ne mijenjaju.',
      wed: 'Odstupanje izrečeno brojkama.',
      thu: 'Uobičajeno jutro.',
      fri: 'Drugo uobičajeno jutro.',
    },
    /** v3: delete after W4b (the source toggle goes) */
    sourceLabel: 'Izvor rečenice',
    /** v3: delete after W4b */
    sourceObserved: 'Zapis',
    /** v3: delete after W4b */
    sourceReplayed: 'Današnja pravila',
  },
  strip: {
    title: 'Tijek',
    lede: 'Gotovo pet dana na jednoj osi, prema običnom danu. Okomita crta pokazuje trenutak snimke; klikni ili povuci po grafu da je premjestiš.',
    fleet: 'Vozila u pokretu',
    fleetNormal: 'običan dan',
    /** The state tint's two words: silent, reduced. */
    fleetTint: ['gotovo bez vozila', 'smanjeno'],
    fleetSeen: 'u pokretu',
    fleetExpected: 'po voznom redu',
    bikesEmpty: 'Prazne stanice BAJS-a',
    bikesRef: 'čet 1. 10., isto doba',
    /** Appendix A wrote "svaki dan štrajka više"; the strike word stays in narration and sources only (S-3). */
    bikesHeadline: 'iz dana u dan više: {mon} · {tue} · {wed} (čet 1. 10.: {thu})',
    tableCaption: '{title}: brojevi po satu',
    feed: 'ZET-ovi podaci',
    feedEmpty: 'bez vozila',
    feedFrozen: 'ne mijenjaju se',
    productScreen: 'na zaslonu',
    readout: '{day} u {time}: {values}',
    table: 'Brojevi po satu',
    noValue: 'bez podatka',
    plotsLabel: 'Tijek na jednoj osi; strelice lijevo i desno pomiču snimku za deset minuta, sa Shiftom za sat.',
    hour: 'Sat',
    stateRetro: 'izračunano naknadno',
    stateNone: 'bez procjene',
    /** v3: delete after W4a (strip.fleetNormal) */
    fleetCompare: 'običan dan',
    /** v3: delete after W4a and W2 (the state band goes) */
    state: 'Stanje usluge',
    /** v3: delete after W4a and W2 (strip.bikesEmpty is the one bikes chart) */
    bikes: 'Bicikli na stanicama',
    /** v3: delete after W4a (ZET lanes go to the downloads) */
    feedDepot: 'u spremištu',
    /** v3: delete after W4a */
    feedFuture: 'vrijeme unaprijed',
    /** v3: delete after W4a (headlines per hour go) */
    news: 'Medijski naslovi po satu',
    /** v3: delete after W4a (the ghost columns become a card) */
    ghosts: 'Vozila koja je zaslon brojio, a nisu imala položaj',
    /** v3: delete after W4a (heatmap.title) */
    lines: 'Sve linije, svaki sat',
    /** v3: delete after W4a (heatmap.lede) */
    linesLede: 'Udio vozila prema voznom redu po liniji i satu: tramvaji pa autobusi.',
    /** v3: delete after W4a (heatmap.otherBuses) */
    linesOtherBuses: 'Ostale autobusne linije ({n}), zajedno',
    /** v3: delete after W4a (heatmap.allBuses) */
    linesAll: 'Prikaži sve autobusne linije',
    /** v3: delete after W4a (heatmap.cell) */
    linesCell: 'linija {short}, {day} u {hour}: {seen} od {expected}',
    /** v3: delete after W4a (heatmap.none) */
    linesNone: 'ne vozi po voznom redu',
    /** v3: delete after W2 and W4a (the tram/bus sub-plots go) */
    tram: 'Tramvaji',
    /** v3: delete after W2 and W4a */
    bus: 'Autobusi',
    /** v3: delete after W2 and W4a (temperature goes) */
    weather: 'Temperatura i vrijeme',
  },
  heatmap: {
    title: 'Sve linije, svaki sat',
    lede: 'Koliko je vozila od voznog reda vozilo, po liniji i satu: tramvaji pa autobusi.',
    rampLabel: 'udio voznog reda',
    ramp: ['nijedno vozilo', 'do 25 %', '25 do 50 %', '50 do 75 %', 'više od 75 %'],
    none: 'u to doba ne vozi',
    missing: 'bez podatka',
    cell: 'linija {short}, {day} u {time}: {seen} od {expected} vozila',
    otherBuses: 'Ostale autobusne linije ({n}), zajedno',
    allBuses: 'Prikaži sve autobusne linije',
    route: 'Linija',
  },
  reckoning: {
    title: 'Što snimka pokazuje',
    lede: 'Šest činjenica iz snimke; ispod svake piše kako je izračunana.',
    silent: 'Tri dana gotovo bez vozila',
    silentMethod: 'Minute u stanju „gotovo bez vozila”, po danima, iz stanja usluge izračunanog iz snimljenih podataka.',
    mornings: 'Pet jutara u 07:45',
    morningsMethod: 'Vozila u pokretu i prazne stanice BAJS-a u 07:45, uz obične dane 21. i 24. 9. (za bicikle 1. 10.).',
    lines: 'Što je vozilo',
    /** Forms picked by {total} (od 154 linije, od 155 linija). */
    linesValueForms: ['{n} od {total} linije; {single} od njih jednim vozilom', '{n} od {total} linije; {single} od njih jednim vozilom', '{n} od {total} linija; {single} od njih jednim vozilom'],
    linesMethod: 'Linije s barem jednim vozilom u pokretu od pon 03:30 do sri 18:00, u barem jednom petominutnom razdoblju.',
    linesModes: 'pon: 1 do 2 tramvaja; uto i sri: 3 do 4 autobusa linije 228',
    ghosts: 'Broj koji nije bio točan',
    ghostsValue: '{shown} umjesto {real}',
    ghostsLede: 'U ponedjeljak je zaslon cijeli dan pisao 6 do 7 vozila, a položaj su imala 0 do 2.',
    ghostsMethod: 'Broj na zaslonu prema broju vozila s položajem u ZET-ovim podacima, samo od pon 28. 9. u 03:30 do sri 30. 9. u 20:16 i samo kad je razlika barem dva vozila.',
    zet: 'Što je ZET javio u podacima',
    zetAlerts: 'Od pon 28. 9. u 03:30 do sri 30. 9. u 20:16: 0 upozorenja i 0 otkazanih vožnji',
    zetEmpty: '{d} ZET nije slao nijedno vozilo ({from} do {to})',
    zetFrozen: '{d} podaci se nisu osvježavali',
    zetFriday: 'U petak 2. 10. od 06:54 do 11:21 u podacima je stajalo do {n} upozorenja s otkazanim vožnjama.',
    zetMethod: 'Upozorenja, otkazane vožnje i minute bez vozila ili bez osvježavanja u ZET-ovim podacima.',
    return: 'Povratak',
    returnMethod: 'Od prvih deset vozila u pokretu do prve minute u kojoj je promet ocijenjen kao uobičajen, posebno za tramvaje i autobuse.',
    returnModes: 'autobusi: 10 u 18:23, pola voznog reda u 19:18; tramvaji: 18:48 i 19:49; linije 31 do 34 tek oko 23:20',
    total: 'ukupno',
    span: 'od {from} do {to}',
    none: 'U snimci nema takvih minuta.',
    day: 'Dan',
    normalDay: '{day}, običan dan',
    returnFrom: 'Prvih deset vozila u pokretu',
    returnTo: 'Prva minuta uobičajenog stanja',
    feedEmpty: 'ZET ne šalje nijedno vozilo',
    feedFrozen: 'ZET-ovi podaci ne mijenjaju se',
    feedLongest: 'najdulje {duration}, od {from}',
    ghostsMax: 'Najveća razlika',
    ghostsMaxValue: '{count} više nego s položajem, {day} u {time}',
    ghostsMinutes: 'Minute s razlikom',
    /** v3: delete after W4a (reckoning.mornings) */
    peak: 'Pet jutara u 07:45',
    /** v3: delete after W4a (reckoning.morningsMethod) */
    peakMethod: 'Vozila u pokretu u 07:45 svakog dana i običnog četvrtka 24. rujna u isto doba.',
    /** v3: delete after W4a */
    peakCompare: 'čet 24. 9., običan dan',
    /** v3: delete after W4a */
    peakFive: 'Jutra u 07:45',
    /** v3: delete after W4a */
    peakFiveMethod: 'Vozila u pokretu u 07:45 svakog jutra snimke i dvaju običnih dana u isto doba: ponedjeljka 21. i četvrtka 24. rujna.',
    /** v3: delete after W4a ("Bicikli kao zamjena" goes) */
    bikes: 'Bicikli kao zamjena',
    /** v3: delete after W4a */
    bikesMethod: 'Najmanji zbroj bicikala i najveći broj praznih stanica po danu, iz podataka nextbikea svake minute.',
    /** v3: delete after W4a */
    bikesMin: 'najmanje bicikala',
    /** v3: delete after W4a */
    bikesEmptyMax: 'najviše praznih stanica',
    /** v3: delete after W4a */
    bikesDrained: 'bicikala manje na stanicama, od najvećeg zbroja do najmanjeg',
    /** v3: delete after W4a (reckoning.zet) */
    feed: 'ZET-ovi podaci',
    /** v3: delete after W4a (reckoning.zetMethod) */
    feedMethod: 'Minute u kojima ZET nije slao nijedno vozilo i minute u kojima se ZET-ovi podaci nisu mijenjali.',
    /** v3: delete after W4a ("Što je zaslon govorio" goes) */
    sentences: 'Što je zaslon govorio',
    /** v3: delete after W4a */
    sentencesMethod: 'Rečenice zaglavlja po vrsti, iz zapisa zaslona svakih 20 sekundi.',
    /** v3: delete after W4a (reckoning.linesValueForms) */
    linesValue: '{count} od {total} linija',
    /** v3: delete after W4a */
    linesMonday: 'U ponedjeljak 28. rujna',
    /** v3: delete after W4a */
    linesNone: 'nijedna',
    /** v3: delete after W4a (reckoning.zet) */
    alerts: 'Što je ZET rekao u podacima',
    /** v3: delete after W4a (reckoning.zetMethod) */
    alertsMethod: 'Upozorenja i otkazane vožnje u ZET-ovim podacima u stvarnom vremenu, zbrojeni po minutama snimke.',
    /** v3: delete after W4a (reckoning.zetAlerts) */
    alertsValue: '{alerts} upozorenja, {cancelled} otkazanih vožnji',
    /** v3: delete after W4a */
    liveRows: 'Redovi s polaskom uživo',
    /** v3: delete after W4a */
    liveRowsValue: '{live} od {rows} redova s polaskom',
    /** v3: delete after W4a */
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
  alternatives: {
    title: 'Čime se moglo umjesto tramvaja',
    lede: 'Bicikli, jedina linija koja je vozila i što su mediji zabilježili o taksijima i prijevozu.',
    bikes: 'Stanice koje su bile prazne, a u četvrtak nisu',
    bikesMethod: 'Sati bez bicikla od 6 do 20 h u ponedjeljak, umanjeni za iste sate u četvrtak 1. 10.; prvih deset. Iz podataka BAJS-a (nextbike).',
    station: 'Stanica BAJS-a',
    emptyMon: 'Prazna u pon (h)',
    emptyThu: 'U čet 1. 10. (h)',
    showOnMap: 'Pokaži na karti',
    showOnMapNamed: '{action}: {name}',
    line228: 'Linija 228 Borongaj – Rebro',
    line228Lede: 'Od utorka u 10 h vozila je koliko i vozni red; jedina takva linija tih dana.',
    line228Notice: 'Obavijest ZET-a',
    line228Hour: 'Sat',
    line228Seen: 'najviše vozila u pokretu',
    line228Expected: 'po voznom redu',
    line228Value: '{n} u pokretu',
    line228Summary: 'Najviše {n} vozila linije 228 u pokretu u jednom satu.',
    press: 'Što su mediji zabilježili',
    pressMeta: '{outlet} · {time}',
    pressNone: 'Za ove teme nema odabranog naslova.',
    bikesNone: 'U ponedjeljak se nijedna stanica nije ispraznila nakon 05:00.',
    /** The three press beats of the block, by the news file's beat id. */
    beat: {
      taksi: 'Taksi i prijevoz',
      volonteri: 'Volonteri',
      bajs: 'BAJS',
    },
    /** v3: delete after W4a */
    pressLede: 'Taksi, volonteri, škole i gužve: naslovi s poveznicom na izvorni članak.',
    /** v3: delete after W4a (the ranking by empty hours) */
    emptyFrom: 'Prazna od',
    /** v3: delete after W4a */
    bikesAtFive: 'Bicikala u 05:00',
    /** v3: delete after W4a (alternatives.line228Lede) */
    line228Method: 'Vozila linije 228 u pokretu po satu od utorka 29. rujna, iz snimljenih položaja po liniji; obavijest ZET-a 10166.',
    /** v3: delete after W4a (the rail card goes) */
    rail: 'Vlak u zaglavlju zaslona',
    /** v3: delete after W4a */
    railMethod: 'Rečenice zaglavlja o vlaku po danu, iz zapisa zaslona. Vlakovi su se na zaslonu pojavili s nadogradnjom od 29. rujna; snimka ne govori o prometu vlakova, samo o zaslonu.',
    /** v3: delete after W4a */
    railValue: '{count} rečenica o vlaku',
    /** v3: delete after W4a */
    railNone: 'U zapisima zaslona nema rečenice o vlaku.',
  },
  live: {
    title: 'I danas',
    kicker: 'uživo',
    lede: 'Isti podaci koje prati snimka, ali sada.',
    /** {vehicles} is count(n, live.vehicleForms); {state} one of live.state. */
    now: 'Sada, u {time}: u pokretu {vehicles}, po voznom redu {expected}. {state}',
    vehicleForms: ['vozilo', 'vozila', 'vozila'],
    state: {
      morning: 'Uobičajeno jutro.',
      day: 'Uobičajen dan.',
      evening: 'Uobičajena večer.',
      night: 'Uobičajena noć.',
      reduced: 'Smanjeno.',
      silent: 'Gotovo bez vozila.',
      unknown: 'Bez procjene.',
    },
    then: 'U ponedjeljak 28. 9. u {time}: u pokretu {n}.',
    thenMissing: 'U ponedjeljak 28. 9. u {time}: bez podatka.',
    unavailable: 'Trenutačno stanje nije dostupno.',
    /** Shown only when the reading is older than five minutes. */
    age: 'Stanje od prije {age}.',
    app: 'Aplikacija uživo →',
    stats: 'Statistika usluge →',
    /** v3: delete after W4b (the method line moves to Podaci i izvori: sources.live) */
    method: 'Jedno čitanje javnog sažetka aplikacije kad se ova kartica pojavi; ništa se ne broji i ne šalje.',
  },
  data: {
    title: 'Podaci i izvori',
  },
  open: {
    title: 'Otvoreni podaci iz snimke',
    lede: 'Ono što ZET i Grad ne objavljuju, a iz njihovih otvorenih podataka može se izračunati. Sve se može preuzeti, s izvorom i licencom.',
    s1: 'ZET objavljuje položaje vozila, ali ne i koliko ih od voznog reda zaista vozi; snimka to izračunava za svaku minutu i za svaku liniju.',
    s2: 'Za BAJS: koliko je bicikala bilo na svakoj stanici svakih pet minuta, pa se vidi koje su se stanice prve ispraznile.',
    s3: 'Za ZET-ove podatke: kad nisu stizali ili se nisu mijenjali, da se razlikuje „vozila nema” od „podatak ne stiže”.',
    downloads: 'Preuzimanja',
    download: '{title} ({format}, {size})',
    file: {
      series: 'Stanje usluge i vozila po minuti',
      routes: 'Vozila po liniji svakih pet minuta',
      bikes: 'Bicikli po stanici svakih pet minuta',
    },
    others: 'Ostale datoteke ({n})',
    cite: 'Kako navesti: „Kaj ima? · Snimka, zagreb.aningfilm.hr/snimka/”, Otvorena dozvola.',
    catalog: 'Katalog (DCAT-AP): /open/catalog.json',
    /** The commit and the pipeline brief are links; reproBrief is the brief link's text. */
    repro: 'Ponovljivo: npm run build:snimka iz inačice koda {commit}',
    reproBrief: 'opis izrade skupa',
    notIncluded: 'Nema u preuzimanjima: teksta članaka ni ZET-ovih obavijesti (samo poveznice), sirovih ZET-ovih podataka ni ikakvih brojeva o ljudima.',
    closuresNote: '29 zatvora s krajem 30. 9. nestalo je iz skupa u uto 21:25: čišćenje skupa, ne promjena na ulici.',
    format: {
      csv: 'CSV',
      json: 'JSON',
      geojson: 'GeoJSON',
    },
    latest: 'Stalna poveznica',
    latestNamed: 'Stalna poveznica: {title}',
    rowForms: ['redak', 'retka', 'redaka'],
    catalogEntry: 'Skup u popisu otvorenih podataka',
    commit: 'Inačica koda {commit}',
    /** v3: delete after W4b (the signals table goes) */
    signal: 'Podatak',
    /** v3: delete after W4b */
    signalSource: 'Iz čega',
    /** v3: delete after W4b */
    signalCadence: 'Korak',
    /** v3: delete after W4b */
    signalUse: 'Kome koristi',
    /** v3: delete after W4b */
    row: {
      state: 'Stanje usluge po minuti',
      stateUse: 'Gradu i ZET-u: kad je promet odstupao i koliko',
      fleet: 'Vozila u pokretu i po voznom redu, po liniji',
      fleetUse: 'ZET-u i medijima: koje su linije vozile',
      feed: 'Pouzdanost ZET-ovih podataka: prazni i zamrznuti okviri, vremena iz budućnosti, upozorenja',
      feedUse: 'ZET-u i timu za otvorene podatke',
      bikes: 'Bicikli po stanici svakih pet minuta',
      bikesUse: 'Gradu i nextbikeu: gdje je zamjena nestala prva',
      closures: 'Zatvorene ulice po inačici skupa, s pomicanjem kraja',
      closuresUse: 'Gradu: koji krajevi radova nisu stvarni',
      voice: 'Rečenice zaslona, zapisane i izračunane',
      voiceUse: 'Svima: što je grad mogao pročitati',
    },
    /** v3: delete after W4b */
    cadence: {
      minute: 'svaku minutu',
      five: 'svakih pet minuta',
      change: 'pri svakoj promjeni',
    },
    /** v3: delete after W4b */
    source: {
      zet: 'ZET, GTFS-RT',
      nextbike: 'nextbike, GBFS',
      city: 'Grad Zagreb, data.zagreb.hr',
      kajima: 'Kaj ima?',
    },
    /** v3: delete after W4b (open.cite) */
    licence: 'Otvorena dozvola, uz navođenje izvora',
    /** v3: delete after W4b (one link per file) */
    catalogLink: 'Katalog otvorenih podataka',
    /** v3: delete after W4b (open.repro) */
    reproText: 'Skup je izgrađen iz snimki naredbom npm run build:snimka na inačici koda {commit}; ugovor podataka i opis cjevovoda su u docs/snimka-2026-10.md, a sažetak svake datoteke u manifestu.',
    /** v3: delete after W4b (open.reproBrief) */
    brief: 'Opis cjevovoda',
    /** v3: delete after W4b (the promise sentence goes) */
    promise: 'Prijava Gradu obećava otvorene podatke u oba smjera: Grad daje, a Kaj ima? vraća ono što izvede. Ovo je prvi takav skup.',
  },
  sources: {
    title: 'Izvori i licence',
    lede: 'Odakle je što u snimci i pod kojom licencom.',
    strike: 'Zaslon sam ne govori o štrajku: riječ se na njemu pojavljuje samo u naslovima ZET-ovih obavijesti, koje prenosi doslovno. Aplikacija zna stanje voznog parka, ne i njegov uzrok.',
    voice: 'Rečenice „po današnjim pravilima” izračunane su naknadno i tako su označene; zapis je ono što je na zaslonu doista pisalo.',
    live: 'Kartica „I danas” jedina na stranici čita podatke uživo: javni sažetak aplikacije, jednom, kad dođeš do nje.',
    open: 'ZET-ov navod izvora prenesen je doslovno, na engleskom.',
    dataset: 'Opis skupa podataka',
    statistika: 'Statistika',
    prijava: 'Prijava projekta',
    catalog: 'Svi otvoreni podaci Kaj ima?',
  },
  size: {
    kb: '{n} kB',
    mb: '{n} MB',
  },
  error: {
    load: 'Snimka se trenutačno ne može učitati.',
    retry: 'Pokušaj ponovno',
  },
  noscript: 'Za snimku je potreban JavaScript. Izvori i opis skupa podataka nalaze se ispod.',
  time: {
    /** duration() under one minute, where "0 min" would read as a count. */
    underMinute: 'manje od minute',
  },
  attribution: {
    /** The heading over the manifest's notes (gaps and caveats), with their count. */
    notes: 'Napomene uz podatke ({n})',
    /** The separate link to a source's home. */
    source: 'izvor',
    /** The label over ZET's English attribution sentence, quoted verbatim. */
    verbatim: 'atribucija doslovno',
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

/** Every leaf of SN with its dot path, for the guards; an array of forms counts as one leaf per form. */
export function leaves(node: unknown = SN, prefix = ''): [key: string, text: string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${prefix}.${i}`));
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}
