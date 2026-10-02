// The fact chips of a feed item at its minute: "bez podatka" for null,
// "naknadno" before serviceLiveFromSec, never a 0 for a missing value (plan
// section 3.4). Lane V4 owns this file; V0 ships no chips.
import type { FactKey } from '../../../shared/snimka';
import type { SnimkaContext } from './context';

export function factChips(_ctx: SnimkaContext, _facts: readonly FactKey[], _atSec: number): string[] {
  return [];
}
