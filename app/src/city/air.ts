import { createDefaultI18n, type SupportedLocale } from '../i18n/create-default-i18n';
import type { I18n } from '../i18n/i18n';
import { ct } from './strings';
// Callers hand in anything with getLocale (the contract of ct() in strings.ts),
// so the class names are read from a catalogue of that locale, the way
// transport/strings.ts reads the workspace's words.
const BY_LOCALE=new Map<SupportedLocale,I18n>();
function catalogue(locale:string):I18n {
  const code:SupportedLocale=locale.toLowerCase().startsWith('en')?'en':'hr';
  let i18n=BY_LOCALE.get(code);
  if(!i18n){i18n=createDefaultI18n(code);BY_LOCALE.set(code,i18n);}
  return i18n;
}
/** The six source-provided station index classes (city.airIndex-1 … -6), not a citywide verdict. */
export function airIndexLabel(i18n: Pick<I18n,'getLocale'>, index: unknown): string {
  const c=catalogue(i18n.getLocale());
  // One literal key per class, so the i18n scanner (test/app/i18n-scan.ts) counts each as read.
  switch(index){
    case 1:return c.t('city.airIndex-1');
    case 2:return c.t('city.airIndex-2');
    case 3:return c.t('city.airIndex-3');
    case 4:return c.t('city.airIndex-4');
    case 5:return c.t('city.airIndex-5');
    case 6:return c.t('city.airIndex-6');
    default:return ct(i18n,'unknown');
  }
}
