// Decision 21's accepted row exclusions. These are legitimate source texts,
// not asserted attacks. Update only after reviewing the exact cause and count.
import type { ExternalTextKind, ExternalTextRejection } from '../../shared/kiosk/external-text';

export interface RowTextResidual {
  kind: ExternalTextKind;
  value: string;
  reason: ExternalTextRejection;
  cause: string | { rule: string; left: string; right: string } | null;
}
const numeric = (kind: ExternalTextKind, value: string, cause: string, reason: 'phone' | 'account' = 'phone'): RowTextResidual =>
  ({ kind, value, reason, cause });
const pair = (kind: ExternalTextKind, value: string, left: string, right: string): RowTextResidual =>
  ({ kind, value, reason: 'instruction', cause: { rule: 'noun-token', left, right } });

// Field occurrences, not distinct values: "810-823" occurs in two records.
export const STREET_ROW_RESIDUALS: readonly RowTextResidual[] = [
  numeric('register-text', 'knez Panonske Hrvatske, 810-823', '810-823'),
  numeric('register-text', 'knez Panonske Hrvatske, 810-823', '810-823'),
  pair('register-text', 'planina u Dinarskom gorju između prijevoja Dubci kod Brela i Saranač kod Gornjih Igrana (Sveti Jure 1762 mnv)/Dalmacija', 'kod', '1762'),
  pair('register-text', 'dvorac iz 1546 kod Zaprešića', 'kod', '1546'),
  pair('register-text', 'planina u Dinarskom gorju (1182 mnv) kod Ogulina/Lika', 'kod', '1182'),
  pair('register-text', 'srednjovjekovni bosanski utvrđeni grad knezova Babonića iz 1286, nad rijekom Unom kod Cazina/Bosna i Hercegovina', 'kod', '1286'),
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
];

export const TITLE_ROW_RESIDUALS: readonly RowTextResidual[] = [
  numeric('title', 'Čučerska cesta, 362 - 370', '362 - 370'),
  pair('title', 'Galerijski program MKC-a 2018 – 2025', 'program', '2018'),
  numeric('title', 'Ulica Marije Sniježne od kbr. 92 sa odvojcima prema 108-117-128', '108-117-128'),
  numeric('title', 'Novi model dodjele prostora mjesne samouprave - Otvoren Javni poziv za redovno korištenje prostora za razdoblje 2026./2027.', '2026./2027'),
  numeric('title', 'Ulica Nede Krmpotić - dječje igralište Žitnjak k.č. 275, 276/3 k.o. Žitnjak)', '275, 276/3'),
];
