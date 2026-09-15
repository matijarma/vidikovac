// The screen stop knows its gradska četvrt: stamped at creation, backfilled on read for stops stored before the field existed.
import { describe, expect, it } from 'vitest';
import { DEFAULT_STOP_ID, screenStop, withDistrict } from '../../worker/pairing/stops';

describe('screenStop and withDistrict', () => {
  it('stamps the default stop (Trg bana J. Jelačića) with gornji-grad-medvescak (R-DG19)', () => {
    const stop = screenStop(DEFAULT_STOP_ID);
    expect(stop).not.toBeNull();
    expect(stop!.district).toBe('gornji-grad-medvescak');
  });

  it('backfills a stored stop that predates the field, and leaves a stamped one alone', () => {
    const bare = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11'] };
    const filled = withDistrict(bare);
    expect(filled.district).toBe('gornji-grad-medvescak');
    expect(bare).not.toHaveProperty('district');
    const stamped = { ...bare, district: 'trnje' };
    expect(withDistrict(stamped)).toBe(stamped);
  });

  it('leaves a stop outside every polygon without a district (Samobor)', () => {
    const outside = { id: 'x', name: 'Samobor', lon: 15.7107, lat: 45.8011, routes: [] as string[] };
    expect(withDistrict(outside)).not.toHaveProperty('district');
  });
});
