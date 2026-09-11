import type { Env } from './env';
import type { ServerEvent } from './protocol';

// Area B replaces this stub with the fire-and-forget counter write to MetricsDO.
// Signature is the cross-area contract consumed by Area A (source_fetch) and D (hitno_view).
export function recordMetric(_env: Env, _event: ServerEvent, _dim1?: string, _dim2?: string): void {}
