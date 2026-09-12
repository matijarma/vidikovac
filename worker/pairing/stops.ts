import rows from '../data/zet-stops.json';
import type { ScreenStop } from '../protocol';

const stops = new Map<string, ScreenStop>((rows as ScreenStop[]).map((row) => [row.id, row]));
export const DEFAULT_STOP_ID = '106_1';
export function screenStop(id: string): ScreenStop | null { return stops.get(id) ?? null; }
