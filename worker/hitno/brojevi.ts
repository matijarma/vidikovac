// Emergency numbers shown on /hitno.
//
// SOURCE, read 11 Sept 2026: Ravnateljstvo civilne zaštite, section "Pozivi za
// žurnu pomoć" on https://civilna-zastita.gov.hr/ lists 112 (jedinstveni broj
// za hitne službe), 192 (policija), 193 (vatrogasci), 194 (hitna pomoć), 195
// (traganje i spašavanje na moru) and 1987 (pomoć na cestama). 195 is left out
// because it is not a Zagreb number.
//
// VERIFY against that page before every release that touches this file. A wrong
// digit on a safety page is the one mistake this project may not make.
export interface EmergencyNumber {
  number: string;
  label: string;
}

export const EMERGENCY_NUMBERS: readonly EmergencyNumber[] = [
  { number: '112', label: 'jedinstveni europski broj za hitne službe' },
  { number: '192', label: 'policija' },
  { number: '193', label: 'vatrogasci' },
  { number: '194', label: 'hitna medicinska pomoć' },
  { number: '1987', label: 'pomoć na cesti (HAK)' },
];

export const EMERGENCY_NUMBERS_SOURCE = {
  text: 'Ravnateljstvo civilne zaštite, Pozivi za žurnu pomoć',
  url: 'https://civilna-zastita.gov.hr/',
} as const;
