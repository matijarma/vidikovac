// One picture for the sky DHMZ describes in words. `conditionText` hands over
// the station's own <Vrijeme> string, which is Croatian prose rather than a
// code: "pretežno oblačno, jak vjetar", "grmljavina s oborinom", sometimes a
// wind word with no sky in it at all ("lahor"). The table below reads that
// prose the way a person does, most specific first, and an unknown word gets
// no icon: the condition is written out beside the symbol anyway, so the only
// real failure is drawing the wrong sky.
import type { IconName } from '../ui/icons';

/** Lower case, no diacritics, single spaces: "Pretežno Oblačno" and "pretezno oblacno" read the same. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word stems to symbol, in order: the first stem the text contains wins. */
const CONDITIONS: readonly (readonly [readonly string[], IconName])[] = [
  [['grmljavin'], 'cloud-lightning'],
  [['snijeg'], 'cloud-snow'],
  [['magla'], 'cloud-fog'],
  [['kis', 'pljusak'], 'cloud-rain'],
  [['umjereno oblacno', 'djelomicno oblacno'], 'cloud-sun'],
  [['oblacno'], 'cloud'],
  [['vedro', 'suncano'], 'sun'],
];

/** The sprite symbol for a DHMZ condition, or null when the words name no sky. */
export function weatherIcon(condition: string | null): IconName | null {
  if (!condition) return null;
  const text = fold(condition);
  if (!text) return null;
  for (const [stems, icon] of CONDITIONS) {
    if (stems.some((stem) => text.includes(stem))) return icon;
  }
  return null;
}
