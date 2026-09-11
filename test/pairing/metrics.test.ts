import { describe, expect, it } from 'vitest';
import { LAYERS } from '../../worker/protocol';
import { EXPORT_KINDS, METRIC_EVENTS, isMetricEvent, zagrebDayHour } from '../../worker/metrics';

describe('metric vocabulary', () => {
  it('lists every server and client event exactly once', () => {
    expect([...METRIC_EVENTS].sort()).toEqual(
      ['session_start', 'session_end', 'scan_fail', 'kiosk_online', 'source_fetch', 'hitno_view', 'over_cap', 'panel_open', 'export'].sort(),
    );
    expect(isMetricEvent('panel_open')).toBe(true);
    expect(isMetricEvent('page_view')).toBe(false);
    expect(isMetricEvent(42)).toBe(false);
  });
  it('export kinds and layers are closed lists', () => {
    expect(EXPORT_KINDS).toEqual(['copy', 'link', 'ics', 'geojson', 'pdf']);
    expect(LAYERS).toHaveLength(7);
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
