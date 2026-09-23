// The committed street register's names that contain a word spelled like an ISO 4217 code
// ("Nova Ves": VES). Only these, exactly as the register writes them, may carry such a word
// in a row's name or address before a house number (external-text.ts maskRegisterStreet).
// A data pin: test/app/external-text.test.ts derives the list from app/public/data/streets-geo.json
// and fails on any name added or missing here.
export const CODE_WORD_STREETS: readonly string[] = [
  'Jurja ves', 'Jurja ves I. odvojak', 'Jurja ves II. odvojak', 'Jurja ves III. odvojak',
  'Lepa Ves', 'Nad lipom', 'Nad tunelom', 'Nova Ves', 'Ulica crkvena ves',
];
