// The committed street register's names that contain a word spelled like an ISO 4217 code
// ("Nova Ves": VES). A bare "<street> <house number>" in a row's name or address may carry
// such a word (external-text.ts maskRegisterStreet). A data pin: test/app/external-text.test.ts
// derives the list from app/public/data/streets-geo.json and fails on any name added or missing.
export const CODE_WORD_STREETS: readonly string[] = [
  'Jurja ves', 'Jurja ves I. odvojak', 'Jurja ves II. odvojak', 'Jurja ves III. odvojak',
  'Lepa Ves', 'Nad lipom', 'Nad tunelom', 'Nova Ves', 'Ulica crkvena ves',
];

// Decision 41: the only longer names that may carry such a word, byte-exact as the committed
// heritage and street registers write them (the 25 Nova Ves fields). No other text with a
// prefix is ever admitted. Pinned twice: test/fixtures/code-word-fields.txt is derived from the
// registers by test/app/external-text.test.ts ("register fields"), and this list must equal it.
// When a register changes: run that test with -u, review the fixture diff, copy it here.
export const CODE_WORD_FIELDS: readonly string[] = [
  'Zgrada, Nova Ves 2',
  'Nova Ves 02',
  'Kuća Pavliček, Nova Ves 1',
  'Nova Ves 01',
  'Prebendarska kurija altarije sv. Jakova, Nova Ves 8',
  'Nova Ves 08',
  'Prebendarska kurija altarije sv. Magdalene, Nova Ves 7',
  'Nova Ves 07',
  'Prebendarska kurija altarije sv. Doroteje, Nova Ves 6',
  'Nova Ves 06',
  'Prebendarska kurija, Nova Ves 12',
  'Nova Ves 12',
  'Zgrada Biskupske ubožnice, Nova Ves 18',
  'Nova Ves 018',
  'Nova Ves 55',
  'Ljetnikovac biskupa Aleksandra Alagovića, Nova Ves 86',
  'Nova Ves 86',
  'Prebendarska kurija sv. Uršule, Nova Ves 04 i 4/1',
  'Nova Ves 04 i 4/1',
  'Prebendarska kurija sv. Mihovila, Nova Ves 3',
  'Nova Ves 3',
  'Prebendarska kurija, Nova Ves 5 i 5a',
  'Nova Ves 5 i 5a',
  'Prebendarska kurija sv. Jakova, Nova Ves 22',
  'Nova Ves 22',
];
