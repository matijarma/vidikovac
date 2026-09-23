// Decision 21's accepted row exclusions. These are legitimate source texts,
// not asserted attacks. Update only after reviewing the exact cause and count.
import type { ExternalTextKind, ExternalTextRejection } from '../../shared/kiosk/external-text';

export interface RowTextResidual {
  kind: ExternalTextKind;
  value: string;
  reason: ExternalTextRejection;
  cause: string | { rule: string; left: string; right: string } | null;
}
const numeric = (kind: ExternalTextKind, value: string, cause: string, reason: 'phone' | 'account' | 'link' | 'payment' = 'phone'): RowTextResidual =>
  ({ kind, value, reason, cause });
const pair = (kind: ExternalTextKind, value: string, left: string, right: string): RowTextResidual =>
  ({ kind, value, reason: 'instruction', cause: { rule: 'noun-token', left, right } });

// Field occurrences, not distinct values: "810-823" occurs in two records.
export const STREET_ROW_RESIDUALS: readonly RowTextResidual[] = [
  numeric('register-text', 'knez Panonske Hrvatske, 810-823', '810-823'),
  numeric('register-text', 'knez Panonske Hrvatske, 810-823', '810-823'),
  numeric('register-text', 'ulica nazvana po spremištu prnja Jakova Weissa na k.br. 21', 'k.br', 'link'),
  numeric('register-text', 'novoplanirana cesta broj 44 nazvana 1896; Novom cestom', 'broj 44'),
  numeric('register-text', 'gorski vrh nazvan po obližnjem selu Šestine/ljetnikovac veletrgovca A.Weissa', 'a.weissa', 'link'),
  numeric('register-text', 'knez Primorske Hrvatske, 878-879', '878-879'),
  numeric('register-text', 'biskup hrvatskoga kraljevstva, 900-929', '900-929'),
  numeric('register-text', 'knez Primorske Hrvatske, 810-821', '810-821'),
  numeric('register-text', 'knez Primorske Hrvatske, 879-892', '879-892'),
  numeric('register-text', 'knez Primorske Hrvatske, 864-876', '864-876'),
  numeric('register-text', 'knez Primorske Hrvatske, 835-845', '835-845'),
  numeric('register-text', 'knez Primorske Hrvatske, 892-910', '892-910'),
  numeric('register-text', 'utemeljitelj dinastije Trpimirovića,; knez Primorske Hrvatske, 845-864', '845-864'),
  numeric('register-text', 'hrvatski kralj, 969-997', '969-997'),
  numeric('register-text', 'planina, skijaško područje u Julijskim Alpama ( 569 - 1800 mnv )/Slovenija', '569 - 1800'),
];

export const HERITAGE_ROW_RESIDUALS: readonly RowTextResidual[] = [
  numeric('name', 'Niz najamnih stambenih zgrada, Gajeva 47, 49, 51, 51/1, 53, 55, 55/1', '47, 49, 51, 51/1, 53, 55, 55/1', 'account'),
  numeric('name', 'Kuće Hrvatske banke za promet nekretninama, Prilaz Gjure Deželića 42, 44, 46,', '42, 44, 46'),
  numeric('name', 'Zgrada Osnovne škole "August Šenoa", Selska cesta 95-95/1-95/2', '95-95/1-95/2'),
  numeric('name', 'Kanonička kurija - Lektorija, Kaptol 27/1, 27/2', '27/1, 27/2'),
  numeric('address', 'Gajeva 47, 49, 51, 51/1, 53, 55, 55/1', '47, 49, 51, 51/1, 53, 55, 55/1', 'account'),
  numeric('address', 'Prilaz Gjure Deželića 42, 44, 46,', '42, 44, 46'),
  numeric('address', 'Novakova 05, 07, 09, 10, 11, 12, 14, 15, 17, 19, 20, 21, 22, 23, 24, 26, 28, 30, 32', '05, 07, 09, 10, 11, 12, 14, 15, 17, 19, 20, 21, 22, 23, 24, 26, 28, 30, 32', 'account'),
  numeric('address', 'Selska cesta 95-95/1-95/2', '95-95/1-95/2'),
  numeric('address', 'Trg maršala Tita 05, 06, 06a, 07', '05, 06, 06'),
  numeric('address', 'Kaptol 27/1, 27/2', '27/1, 27/2'),
  // Decision 24's letter-dot-letter rule; these are register initials and
  // abbreviations, still listed as legitimate losses rather than attacks.
  numeric('name', 'Zgrade Strižić, Ugao Trga A.I. i V. Mažuranića 8 i ul. J. Žerjavića 16', 'a.i', 'link'),
  numeric('address', 'Ugao Trga A.I. i V. Mažuranića 8 i ul. J. Žerjavića 16', 'a.i', 'link'),
  numeric('name', 'Zgrada Osnovne škole „Dr.Ante Starčević“, Sv. Leopolda Mandića 55', 'dr.ante', 'link'),
  numeric('name', 'Dokumentacijske zbirke arhivskog gradiva iz područja istraživanja i proizvodnje nafte i plina u posjedu INA-Industrije nafte d.d.', 'd.d', 'link'),
  numeric('name', 'Dokumentacijske zbirke arhivskog gradiva u posjedu CROATIA RECORDS d.d.', 'd.d', 'link'),
  numeric('name', 'Cjelina filmskog i popratnog filmskog arhivskog gradiva u posjedu Jadran film d.d., Zagreb, Oporovečka 12', 'd.d', 'link'),
  numeric('name', 'Zgrada kotlovnice i strojarnice Prve hrvatske tvornice ulja d.d, Ulica kneza Branimira bb', 'd.d', 'link'),
  numeric('name', 'Zgrada Gospodarske sloge s cjelovito uređenim i opremljenim interijerom knjižare Znanje d.d. u prizemlju, danas KGZ – Knjižnica Medveščak, Odjel za djecu i Odjel za mlade', 'd.d', 'link'),
  numeric('name', 'Zgrada Našičke tvornice tanina i paropila d.d., danas Exportdrvo d.d., Trg Marka Marulića 18/Ulica Ljudevita Farkaša Vukotinovića 1', 'd.d', 'link'),
  numeric('name', 'Palača Hrvatske poljodjelske banke d.d., Smičiklasova 17/Martićeva 6/Patačićkina 1', 'd.d', 'link'),
  numeric('name', 'Sklop zgrada bivše Ženske realne gimnazije sestara Milosrdnica sv.Vinka Paulskog s igralištima i parkom, Savska 77', 'sv.vinka', 'link'),
  // VES is an ISO currency code. Case-folding also matches Nova Ves addresses.
  numeric('name', 'Zgrada, Nova Ves 2', 'ves 2', 'payment'),
  numeric('address', 'Nova Ves 02', 'ves 02', 'payment'),
  numeric('name', 'Kuća Pavliček, Nova Ves 1', 'ves 1', 'payment'),
  numeric('address', 'Nova Ves 01', 'ves 01', 'payment'),
  numeric('name', 'Prebendarska kurija altarije sv. Jakova, Nova Ves 8', 'ves 8', 'payment'),
  numeric('address', 'Nova Ves 08', 'ves 08', 'payment'),
  numeric('name', 'Prebendarska kurija altarije sv. Magdalene, Nova Ves 7', 'ves 7', 'payment'),
  numeric('address', 'Nova Ves 07', 'ves 07', 'payment'),
  numeric('name', 'Prebendarska kurija altarije sv. Doroteje, Nova Ves 6', 'ves 6', 'payment'),
  numeric('address', 'Nova Ves 06', 'ves 06', 'payment'),
  numeric('name', 'Prebendarska kurija, Nova Ves 12', 'ves 12', 'payment'),
  numeric('address', 'Nova Ves 12', 'ves 12', 'payment'),
  numeric('name', 'Zgrada Biskupske ubožnice, Nova Ves 18', 'ves 18', 'payment'),
  numeric('address', 'Nova Ves 018', 'ves 018', 'payment'),
  numeric('address', 'Nova Ves 55', 'ves 55', 'payment'),
  numeric('name', 'Ljetnikovac biskupa Aleksandra Alagovića, Nova Ves 86', 'ves 86', 'payment'),
  numeric('address', 'Nova Ves 86', 'ves 86', 'payment'),
  numeric('name', 'Prebendarska kurija sv. Uršule, Nova Ves 04 i 4/1', 'ves 04', 'payment'),
  numeric('address', 'Nova Ves 04 i 4/1', 'ves 04', 'payment'),
  numeric('name', 'Prebendarska kurija sv. Mihovila, Nova Ves 3', 'ves 3', 'payment'),
  numeric('address', 'Nova Ves 3', 'ves 3', 'payment'),
  numeric('name', 'Prebendarska kurija, Nova Ves 5 i 5a', 'ves 5', 'payment'),
  numeric('address', 'Nova Ves 5 i 5a', 'ves 5', 'payment'),
  numeric('name', 'Prebendarska kurija sv. Jakova, Nova Ves 22', 'ves 22', 'payment'),
  numeric('address', 'Nova Ves 22', 'ves 22', 'payment'),
];

export const TITLE_ROW_RESIDUALS: readonly RowTextResidual[] = [
  numeric('title', 'Novoselečki put, 31 - 35', '31 - 35'),
  numeric('title', 'Osnovna škola Brezovica, Brezovička cesta k.br 98a', 'k.br', 'link'),
  numeric('title', 'Kupinečki Kraljevec, Harabajsi, gornji dio ulice prema Štrpetu, kod k.br. 7 od k.br. 36 - 37, kod k.br. 46 - 47, k.br. 73 - 75, k.br. 79 - 68', 'k.br', 'link'),
  numeric('title', 'Čučerska cesta, 362 - 370', '362 - 370'),
  pair('title', 'Galerijski program MKC-a 2018 – 2025', 'program', '2018'),
  numeric('title', 'Ulica Marije Sniježne od kbr. 92 sa odvojcima prema 108-117-128', '108-117-128'),
  numeric('title', 'Novi model dodjele prostora mjesne samouprave - Otvoren Javni poziv za redovno korištenje prostora za razdoblje 2026./2027.', '2026./2027'),
  numeric('title', 'Ulica Nede Krmpotić - dječje igralište Žitnjak k.č. 275, 276/3 k.o. Žitnjak)', 'k.c', 'link'),
  numeric('title', 'Graduši, k.č. 8951/2 k.o. Čučerje', 'k.c', 'link'),
  numeric('title', 'Zagreb, Park mladenaca, k.č. 687/1 k.o. Klara Nova, park za pse', 'k.c', 'link'),
  numeric('title', 'Zagreb, Remetinečki gaj 27, k.č. 1053/1 k.o. Blato', 'k.c', 'link'),
];
