import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { EXPORT_KINDS, LAYERS } from '../../worker/protocol';
import { METRIC_EVENTS, isMetricEvent, recordMetric, zagrebDayHour } from '../../worker/metrics';

describe('metric vocabulary', () => {
  it('lists every server and client event exactly once', () => {
    expect([...METRIC_EVENTS].sort()).toEqual(
      ['session_start', 'session_end', 'scan_fail', 'kiosk_online', 'source_fetch', 'hitno_view', 'over_cap', 'panel_open', 'export', 'evaluation'].sort(),
    );
    expect(isMetricEvent('panel_open')).toBe(true);
    expect(isMetricEvent('page_view')).toBe(false);
    expect(isMetricEvent(42)).toBe(false);
  });
  it('export kinds and layers are closed lists', () => {
    // EXPORT_KINDS lives only in protocol.ts (R-44); metrics.ts no longer
    // duplicates it.
    expect(EXPORT_KINDS).toEqual(['copy', 'share', 'ics', 'geojson', 'print']);
    expect(LAYERS).toHaveLength(6);
  });
});

describe('zagrebDayHour', () => {
  it('uses Europe/Zagreb wall time (CEST in September)', () => {
    expect(zagrebDayHour(new Date('2026-09-11T22:30:00Z'))).toEqual({ day: '2026-09-12', hour: 0 });
    expect(zagrebDayHour(new Date('2026-09-11T10:05:00Z'))).toEqual({ day: '2026-09-11', hour: 12 });
  });
  it('uses CET in January and never reports hour 24', () => {
    expect(zagrebDayHour(new Date('2026-01-15T23:10:00Z'))).toEqual({ day: '2026-01-16', hour: 0 });
    expect(zagrebDayHour(new Date('2026-01-15T22:59:59Z'))).toEqual({ day: '2026-01-15', hour: 23 });
  });
});

describe('recordMetric', () => {
  // Fix round 1, R-29/R-42 finding: the brief's given body only `.catch()`es
  // the async rejection from `metricsStub(env).record(...)`, so a
  // *synchronous* throw from `metricsStub` (e.g. `namespace.idFromName(...)`
  // throwing because `env.METRICS_DO` is absent or misconfigured) used to
  // propagate uncaught into every bare `void recordMetric(...)` call site.
  // This exercises exactly that path with no DO binding at all needed — a
  // unit test, not a workers-pool one — since the guarantee under test is
  // "recordMetric never throws", which must hold with a plain Node `env`.
  it('never throws when metricsStub(env) throws synchronously, and logs the failure', () => {
    const throwingNamespace = {
      idFromName(): never {
        throw new Error('boom: METRICS_DO not configured');
      },
      get(): never {
        throw new Error('unreachable: idFromName always throws first');
      },
    };
    const brokenEnv = { METRICS_DO: throwingNamespace } as unknown as Env;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let result: void;
      expect(() => {
        result = recordMetric(brokenEnv, 'kiosk_online', 'donji-grad');
      }).not.toThrow();
      expect(result).toBeUndefined();
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [line] = consoleError.mock.calls[0] as [string];
      expect(line).toContain('metrics-write-failed');
      expect(line).toContain('kiosk_online');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('is a no-op for an event outside the closed vocabulary: no stub is built, nothing is logged', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // No METRICS_DO on this env at all — if metricsStub were reached, this
      // would throw (and be caught/logged); it must never be reached because
      // isMetricEvent rejects the event first.
      expect(() => recordMetric({} as Env, 'not_an_event' as never)).not.toThrow();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
