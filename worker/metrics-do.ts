import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

// Identifier-free counter store: (day, hour, event, dim1, dim2) -> count.
// Area B replaces the method bodies (port of psdlat worker/src/metrics-do.ts
// with the added hour column and the closed vocabularies from protocol.ts).
// The exported names below are the cross-area contract consumed by Area D's
// /stats page and by worker/metrics.ts.

export const METRICS_DO_NAME = 'global';

export interface MetricsDailyRow {
  /** YYYY-MM-DD in Europe/Zagreb. */
  day: string;
  /** 0-23 in Europe/Zagreb. */
  hour: number;
  event: string;
  dim1: string;
  dim2: string;
  count: number;
}

export class MetricsDO extends DurableObject<Env> {
  /** Increment one counter cell for the current Zagreb day and hour. */
  async record(_event: string, _dim1 = '', _dim2 = ''): Promise<void> {
    throw new Error('metrics store not implemented');
  }

  /** Rows with day >= sinceDay (YYYY-MM-DD), ordered by day, hour, event. */
  async query(_sinceDay: string): Promise<MetricsDailyRow[]> {
    throw new Error('metrics store not implemented');
  }
}
