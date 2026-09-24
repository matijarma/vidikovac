// The words /statistika/ puts on the counters' dimension values. Layer names
// are the ones the app's own tabs use (app/src/i18n/hr.json `layers`), source
// names shortened from app/src/data/izvori.json. Croatian only, like every
// prose page. A value without an entry is shown as written.
import { FOLDED_KEY } from '../../../shared/statistika';

export const FOLDED_LABEL = 'Sažeto („ostalo”)';

const LAYERS: Record<string, string> = {
  'grad-sada': 'Sada',
  'u-pokretu': 'Karta',
  'zrak-i-nebo': 'Vrijeme',
  sigurnost: 'Sigurnost',
  'uprava-i-pravo': 'Grad',
  kultura: 'Događanja',
};

/** session_start's first dimension: the venue type, a share, or a temporary screen. */
const SESSION_KINDS: Record<string, string> = {
  kafic: 'Kafić',
  knjiznica: 'Knjižnica',
  cetvrt: 'Ured četvrti',
  udruga: 'Udruga',
  zet: 'ZET',
  ostalo: 'Drugi prostor',
  phone: 'Podijeljena na drugi telefon',
  privremeni: 'Skeniranje zaslona',
};

const EXPORT_KINDS: Record<string, string> = {
  copy: 'Kopirano',
  share: 'Podijeljeno',
  ics: 'Dodano u kalendar',
  geojson: 'Preuzeto kao GeoJSON',
  print: 'Ispisano',
};

const SCAN_FAILS: Record<string, string> = {
  'code-expired': 'Kod je istekao',
  'code-used': 'Kod je već iskorišten',
  'code-unknown': 'Nepoznat kod',
  'screen-offline': 'Zaslon nije bio na mreži',
  'slow-down': 'Prebrzo ponovljeno',
  'rate-limited': 'Previše pokušaja',
  'bad-request': 'Neispravan zahtjev',
  revoked: 'Zaslon je ugašen',
  'same-network': 'Druga mreža',
};

export const SOURCES: Record<string, string> = {
  'zet-rt': 'ZET, vozila uživo',
  prometnice: 'Zatvorene prometnice',
  'dhmz-now': 'DHMZ, mjerenja',
  'dhmz-forecast': 'DHMZ, prognoza',
  'dhmz-cap': 'DHMZ, upozorenja',
  emsc: 'EMSC, potresi',
  glasnik: 'Službeni glasnik',
  'ckan-geo': 'Gradski prostorni skupovi',
  dogadanja: 'Događanja',
};

export const PLAN_EVENTS: Record<string, string> = {
  floor: 'Procjena zadržana na već objavljenom mjestu',
  junction_wait: 'Čekanje na križanju uračunato',
  stand_fix: 'Tramvaj zadržan na peronu',
  eta_bound_skipped: 'Najava „već otišao” odbačena',
};

export const ORDER_EVENTS: Record<string, string> = {
  established: 'Redoslijed upisan',
  dropped: 'Redoslijed pao',
  hold: 'Tramvaj zadržan iza drugoga',
  push: 'Tramvaj pogurnut iza drugoga',
  concession: 'Redoslijed ustupljen',
  swap: 'Redoslijed zamijenjen',
};

export const TICK_OUTCOMES: Record<string, string> = {
  ok: 'Novo očitanje',
  unchanged: 'Isto očitanje',
  error: 'Izvor nije odgovorio',
  stale_index: 'Vožnje nepoznate voznom redu',
  overrides_unreadable: 'Ručna tablica nečitljiva',
};

export const BUCKETS: Record<string, string> = {
  lt25: 'do 25 m',
  lt50: '25 do 50 m',
  lt100: '50 do 100 m',
  lt200: '100 do 200 m',
  ge200: '200 m i više',
};

export const SIGNS: Record<string, string> = {
  ahead_ge50: 'Ispred tramvaja',
  within50: 'Unutar 50 m',
  behind_ge50: 'Iza tramvaja',
};

function pick(table: Record<string, string>, key: string): string {
  if (key === FOLDED_KEY) return FOLDED_LABEL;
  return table[key] ?? key;
}

export const layerLabel = (key: string): string => pick(LAYERS, key);
export const sessionKindLabel = (key: string): string => pick(SESSION_KINDS, key);
export const exportKindLabel = (key: string): string => pick(EXPORT_KINDS, key);
export const scanFailLabel = (key: string): string => pick(SCAN_FAILS, key);
export const sourceLabel = (key: string): string => pick(SOURCES, key);

/** A district slug with the server's name for it; 'zagreb' is a screen set to the whole city. */
export function areaLabel(key: string, serverLabel?: string): string {
  if (key === FOLDED_KEY) return FOLDED_LABEL;
  if (key === 'zagreb') return 'Cijeli grad';
  return serverLabel ?? key;
}
