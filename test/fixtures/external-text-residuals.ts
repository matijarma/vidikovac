// Decision 21's accepted row exclusions. These are legitimate source texts,
// not asserted attacks. Update only after reviewing the exact cause and count.
import type { ExternalTextKind, ExternalTextRejection } from '../../shared/kiosk/external-text';

export interface RowTextResidual {
  kind: ExternalTextKind;
  value: string;
  reason: ExternalTextRejection;
  cause: string | { rule: string; left: string; right: string } | null;
}
const numeric = (kind: ExternalTextKind, value: string, cause: string, reason: 'phone' | 'account' | 'link' = 'phone'): RowTextResidual =>
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
  numeric('name', 'Stambeno - poslovna zgrada, Tratinska 77-79, Nova cesta 103', '77-79'),
  numeric('address', 'Tratinska 77-79, Nova cesta 103', '77-79'),
  numeric('name', 'Stambeno - poslovna zgrada, Tratinska 71 - 73', '71 - 73'),
  numeric('address', 'Tratinska 71 - 73', '71 - 73'),
  numeric('address', 'Zorkovačka 02 - 04', '02 - 04'),
  numeric('name', 'Dvorac Kušević-Plavšić, Gradska ulica 17-19', '17-19'),
  numeric('address', 'Gradska ulica 17-19', '17-19'),
  numeric('name', 'Kuće Eisner, Petrinjska 50-52', '50-52'),
  numeric('address', 'Petrinjska 50-52', '50-52'),
  numeric('address', 'Prilaz Pavla Pavlovića 01-15 i 18', '01-15'),
  numeric('address', 'Laginjina 07-09', '07-09'),
  numeric('name', 'Zgrada, Vukovarska 56-60', '56-60'),
  numeric('address', 'Ulica grada Vukovara 56-60', '56-60'),
  numeric('address', 'Veprinečka 01-15 i Mošćenička 02-16', '01-15'),
  numeric('name', 'Gradska klaonica i stočna tržnica, Heinzelova 66-68', '66-68'),
  numeric('address', 'Heinzelova 66-68', '66-68'),
  numeric('name', 'Stambeni blok, Grada Vukovara 43-43a', '43-43'),
  numeric('address', 'Grada Vukovara 43-43a', '43-43'),
  numeric('name', 'Kompleks samostana klarisa s kaptolskom kulom "Popov toranj", Opatička 20-22', '20-22'),
  numeric('address', 'Opatička 20-22', '20-22'),
  numeric('name', 'Kompleks Prve hrvatske štedionice - Oktogon, Ilica 5 - Margaretska 1-3 - Bogovićeva 6, Ilica 005 - Margaretska 01-03 - Bogovićeva 06', '01-03'),
  numeric('address', 'Ilica 005 - Margaretska 01-03 - Bogovićeva 06', '01-03'),
  numeric('address', 'Frankopanska 15-17', '15-17'),
  numeric('address', 'Jurišićeva 01-01a', '01-01'),
  numeric('name', 'Kuća Oršić-Divković, Masarykova 21-23', '21-23'),
  numeric('address', 'Masarykova 21-23', '21-23'),
  numeric('address', 'Palmotićeva 031-35', '031-35'),
  numeric('address', 'Trg maršala Tita 09-11', '09-11'),
  numeric('address', 'Katarinin trg 02-03, Ćirilometodska 02, Jezuitski trg 01', '02-03'),
  numeric('name', 'Zgrada Hrvatsko-slavonske zemaljske centralne štedionice,Ilica 25-27/Gundulićeva 2', '25-27'),
  numeric('address', 'Ilica 25-27/Gundulićeva 2', '25-27'),
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
  numeric('title', 'Novoselečki put, 31 - 35', '31 - 35'),
  numeric('title', 'Osnovna škola Brezovica, Brezovička cesta k.br 98a', 'k.br', 'link'),
  numeric('title', 'Kupinečki Kraljevec, Harabajsi, gornji dio ulice prema Štrpetu, kod k.br. 7 od k.br. 36 - 37, kod k.br. 46 - 47, k.br. 73 - 75, k.br. 79 - 68', 'k.br', 'link'),
  numeric('title', 'Čučerska cesta, 362 - 370', '362 - 370'),
  pair('title', 'Galerijski program MKC-a 2018 – 2025', 'program', '2018'),
  numeric('title', 'Ulica Marije Sniježne od kbr. 92 sa odvojcima prema 108-117-128', '108-117-128'),
  numeric('title', 'Novi model dodjele prostora mjesne samouprave - Otvoren Javni poziv za redovno korištenje prostora za razdoblje 2026./2027.', '2026./2027'),
  numeric('title', 'Ulica Nede Krmpotić - dječje igralište Žitnjak k.č. 275, 276/3 k.o. Žitnjak)', '275, 276/3'),
];
