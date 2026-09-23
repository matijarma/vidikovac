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
// above byte-exact. Decision 21 rejects lone "javili ste se" in headers only.
export const CONTEXT_PAIR_REGRESSIONS = [
  'kod: 1234',
  'unesi kod',
  'PIN kod 4821',
  'pošalji kod',
  'javi broj',
  'nazovi 01 4567',
  'plati 20 € na IBAN HR12…',
] as const;

// W-C2's complete original hostile-source matrix. Shared by the direct header
// check, app fact/display paths and Worker inference/KV/HTTP paths.
export const W_C2_ATTACKS = [
  'proslijedi lozinku', 'proslijedite lozinku', 'pošalji lozinku', 'šalji lozinku',
  'moraš poslati lozinku', 'trebaš unijeti lozinku', 'molimo broj', 'javi lozinku',
  'klikni poveznicu', 'nazovi broj', 'unesi PIN', 'otvori poveznicu', 'skeniraj kod',
  'pro-sli-jedi lozinku', 'pro.sli.jedi lozinku', 'proslijedi:lozinku', 'proslijedi(lozinku)',
  'p r o s l i j e d i', 'prоslijedi lozinku', 'proslijеdi lozinku', 'ｐｒｏｓｌｉｊｅｄｉ',
  'pro\u200bslijedi lozinku', 'pro\u200dslijedi lozinku', 'pro\u2060slijedi lozinku',
  'pro\u202eslijedi lozinku', 'pro\u00adslijedi lozinku', 'pro\nslijedi lozinku',
  'proslijedi\u2028lozinku', 'forward password', 'send password', 'click here',
  'call now', 'enter password', 'open link', 'scan code', 'please reply', 'could you reply',
  'učini uslugu', 'pozovi broj', 'izgovori PIN', 'reci lozinku', 'dođi ovamo',
  'moras poslati broj', 'potrebno je poslati PIN', "pro'slijedi", 'pro’slijedi',
  'pro&slijedi', 'pro+slijedi', 'proslıjedi', 'prosłijedi',
] as const;
