// The /s/ page: take a code from the URL fragment, the camera or the field,
// POST it, show the confirm card (the possession check the whole mechanic rests
// on), then hand the room and the ticket to /d/ in the fragment. Every browser
// global it needs is injected, so the flow is unit-tested under happy-dom with
// no camera, no network and no real location.
import type { ScanFail, ScanOk } from '../../worker/protocol';
import { isCompleteCode, normalizeCode } from './code';
import type { I18n } from './i18n/i18n';

/** Shape of our own QR fragment: four plus four, one optional dash. Anything
 *  else in the fragment (a stray `#room=…`, a marketing tag) is not a code, and
 *  guessing at one would auto-submit garbage. */
const HASH_CODE = /^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/;

export function codeFromHash(hash: string): string | null {
  let value = hash.replace(/^#/, '').trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // A malformed percent escape is not a code; keep the raw text and let the
    // shape test below reject it.
  }
  if (value.startsWith('code=')) value = value.slice('code='.length);
  if (!HASH_CODE.test(value)) return null;
  const code = normalizeCode(value);
  return isCompleteCode(code) ? code : null;
}

export function confirmLabel(ok: ScanOk, i18n: I18n, now: number): string {
  const minutes = Math.max(1, Math.round((ok.expiresAt - now) / 60_000));
  const minutesText = i18n.t('common.minutes', { count: minutes });
  if (ok.beaconType === 'phone') return i18n.t('scan.confirmPhone', { minutes: minutesText });
  const venue = i18n.t(`scan.venue.${ok.venueType ?? 'ostalo'}`);
  const sentence = i18n.t('scan.confirmScreen', { venue, area: ok.area ?? '', minutes: minutesText });
  return sentence.replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim();
}

export function dashboardUrl(ok: ScanOk): string {
  const label = ok.screenLabel ?? (ok.beaconType === 'phone' ? 'phone' : ok.venueType ?? 'screen');
  return `/d/#room=${encodeURIComponent(ok.roomId)}&ticket=${encodeURIComponent(ok.ticket)}&label=${encodeURIComponent(label)}`;
}
