// review-w2.review.md preserves four exact payloads, not its full 21-item list.
// The remaining 17 generalize those four by person, mood, language and vectors.
// Keep that provenance explicit; do not call the reconstructed set recovered.
export const REVIEW_W2_REGRESSIONS = [
  'Muzej: koristi lozinku.',
  'biste li poslali lozinku?',
  'otvaraš poveznicu.',
  'dial 0800 123.',
  'koristite lozinku',
  'poslao sam šifru',
  'poslali bismo PIN',
  'proslijedila je token',
  'unijeli ste kod',
  'upisujem passcode',
  'podijelit ćete OTP',
  'nazvala bih broj',
  'javili ste se',
  'pozovete broj',
  'otvorili smo poveznicu',
  'preuzela je aplikaciju',
  'instaliramo program',
  'skenirao je QR',
  'forwarded password',
  'paid 50 EUR',
  '0 8 0 0 1 2 3',
] as const;

// Decision 20's explicit sentence-local pairs. Keep the historical 21 values
// above byte-exact, including the lone "javili ste se" conflict with this rule.
export const CONTEXT_PAIR_REGRESSIONS = [
  'kod: 1234',
  'unesi kod',
  'PIN kod 4821',
  'pošalji kod',
  'javi broj',
  'nazovi 01 4567',
  'plati 20 € na IBAN HR12…',
] as const;
