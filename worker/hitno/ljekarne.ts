// On-duty pharmacies. Curated by hand because the City publishes this as a
// hand-maintained HTML page with no feed (design spec, source table, yellow).
//
// SOURCE: https://www.zagreb.hr/dezurne-ljekarne/497, page dated 20.10.2025.,
// read on LJEKARNE_CHECKED_ON. The five Gradska ljekarna Zagreb units run a
// day shift 7.00-20.00 and a night shift 20.00-7.00, which together cover the
// whole day; Ljekarna ZEUS is the one unit the page lists as 0-24 outright.
//
// The page renders every entry with the "provjeriti" mark and the source link.
// Re-check the page before each release; when the City changes the list, this
// file changes with it and LJEKARNE_CHECKED_ON moves.
export interface Pharmacy {
  label: string;
  address: string;
  /** E.164 for the tel: link, or null when the source page gives no number. */
  phoneE164: string | null;
  phoneDisplay: string | null;
  hours: string;
  operator: string;
}

export const LJEKARNE_CHECKED_ON = '2026-09-11';

export const LJEKARNE_SOURCE = {
  text: 'Grad Zagreb, Dežurne ljekarne (stranica ažurirana 20. 10. 2025.)',
  url: 'https://www.zagreb.hr/dezurne-ljekarne/497',
} as const;

const GLJZ = 'Gradska ljekarna Zagreb';
const SHIFTS = 'dnevna služba 7.00 – 20.00, noćna služba 20.00 – 7.00';

export const LJEKARNE: readonly Pharmacy[] = [
  {
    label: 'Trg bana J. Jelačića 3',
    address: 'Trg bana Josipa Jelačića 3, Zagreb',
    phoneE164: '+38514816198',
    phoneDisplay: '01 4816 198',
    hours: SHIFTS,
    operator: GLJZ,
  },
  {
    label: 'Ilica 291',
    address: 'Ilica 291, Zagreb',
    phoneE164: '+38513750321',
    phoneDisplay: '01 3750 321',
    hours: SHIFTS,
    operator: GLJZ,
  },
  {
    label: 'Ozaljska 1',
    address: 'Ozaljska 1, Zagreb',
    phoneE164: '+38513097586',
    phoneDisplay: '01 3097 586',
    hours: SHIFTS,
    operator: GLJZ,
  },
  {
    label: 'Grižanska 4',
    address: 'Grižanska 4, Zagreb (Dubrava)',
    phoneE164: '+38512992350',
    phoneDisplay: '01 2992 350',
    hours: SHIFTS,
    operator: GLJZ,
  },
  {
    label: 'Av. V. Holjevca 22',
    address: 'Avenija Većeslava Holjevca 22, Zagreb',
    phoneE164: '+38516525425',
    phoneDisplay: '01 6525 425',
    hours: SHIFTS,
    operator: GLJZ,
  },
  {
    label: 'Ljekarna ZEUS',
    address: 'Divka Budaka 17, Zagreb (Borongaj, okretište tramvaja)',
    phoneE164: null,
    phoneDisplay: null,
    hours: 'svaki dan 0 – 24, nedjeljom i praznicima 0 – 24',
    operator: 'Ljekarna ZEUS',
  },
];
