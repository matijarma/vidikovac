/**
 * DHMZ's own legend of its forecast weather symbols (the `vrijeme` code of the forecast XML):
 * https://meteo.hr/prognoze.php?section=prognoze_metp&param=meteoroloski_simboli ("Meteorološki simboli"),
 * read 30 September 2026; codes 1 to 42, DHMZ's own words (the page's night variants, "1n" and so on, are the same
 * descriptions; the forecast XML carries the day number). One copy, read by the worker (dhmz-forecast writes the words
 * as `weather`) and by the header sentence's slot rule (shared/kiosk/sentence.ts), which must not import the worker's
 * XML parser. Pure data.
 */

/** Code to DHMZ's description, verbatim (code 22's doubled "uz" included: dhmzSymbolWords collapses it). */
export const DHMZ_SYMBOLS: Readonly<Record<number, string>> = Object.freeze({
  1: 'Vedro, danju sunčano',
  2: 'Malo oblačno, danju sunčano',
  3: 'Umjereno oblačno',
  4: 'Pretežno oblačno',
  5: 'Oblačno, ali svijetlo',
  6: 'Oblačno',
  7: 'Magla, umjereno do pretežno oblačno',
  8: 'Magla, nebo vedro',
  9: 'Magla, malo do umjereno oblačno',
  10: 'Maglovito',
  11: 'Oblačno i maglovito',
  12: 'Promjenljivo oblačno uz malu količinu kiše',
  13: 'Promjenljivo oblačno uz umjerenu količinu kiše',
  14: 'Promjenljivo oblačno uz znatnu količinu kiše',
  15: 'Promjenljivo oblačno uz moguću grmljavinu',
  16: 'Promjenljivo oblačno uz malu količinu kiše te moguću grmljavinu',
  17: 'Promjenljivo oblačno uz umjerenu količinu kiše te moguću grmljavinu',
  18: 'Promjenljivo oblačno uz znatnu količinu kiše te moguću grmljavinu',
  19: 'Promjenljivo oblačno uz malu količinu kiše i snijega',
  20: 'Promjenljivo oblačno uz umjerenu količinu kiše i snijega',
  21: 'Promjenljivo oblačno uz znatnu količinu kiše i snijega',
  22: 'Promjenljivo oblačno uz uz malu količinu snijega',
  23: 'Promjenljivo oblačno uz snijeg',
  24: 'Promjenljivo oblačno uz znatnu količinu snijega',
  25: 'Promjenljivo oblačno uz snijeg te moguću grmljavinu',
  26: 'Oblačno uz malu količinu kiše',
  27: 'Oblačno uz umjerenu količinu kiše',
  28: 'Oblačno uz znatnu količinu kiše',
  29: 'Oblačno uz moguću grmljavinu',
  30: 'Oblačno uz malu količinu kiše te moguću grmljavinu',
  31: 'Oblačno uz umjerenu količinu kiše te moguću grmljavinu',
  32: 'Oblačno uz znatnu količinu kiše te moguću grmljavinu',
  33: 'Oblačno uz malu količinu kiše i snijega',
  34: 'Oblačno uz umjerenu količinu kiše i snijega',
  35: 'Oblačno uz znatnu količinu kiše i snijega',
  36: 'Oblačno uz malu količinu snijega',
  37: 'Oblačno uz umjerenu količinu snijega',
  38: 'Oblačno uz znatnu količinu snijega',
  39: 'Magla, promjenjivo oblačno, uz kišu',
  40: 'Magla, promjenjivo oblačno, uz snijeg',
  41: 'Oblačno i maglovito uz mogući snijeg',
  42: 'Oblačno i maglovito uz moguću kišu',
});

/** An immediately repeated word ("uz uz", DHMZ's code 22) said once. */
function collapseRepeats(text: string): string {
  return text.replace(/(^|\s)(\p{L}+)(?:\s+\2)+(?=\s|$)/gu, '$1$2');
}

/** DHMZ's words for a `vrijeme` code ("6" is "Oblačno"), a doubled word said once; undefined for anything else. */
export function dhmzSymbolWords(code: string): string | undefined {
  if (!/^\d{1,2}$/.test(code)) return undefined;
  const words = DHMZ_SYMBOLS[Number(code)];
  return words === undefined ? undefined : collapseRepeats(words);
}

/** Every description as the header sentence says it after "Sutra": lower-cased, a doubled word said once. */
export const DHMZ_SYMBOL_CONDITIONS: readonly string[] = Object.freeze(
  Object.values(DHMZ_SYMBOLS).map((words) => collapseRepeats(words).toLocaleLowerCase('hr')),
);
