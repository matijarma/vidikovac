import { describe, expect, it } from 'vitest';
import { weatherIcon } from '../../app/src/experience/weather-icon';
import { ICON_NAMES } from '../../app/src/ui/icons';

// The vocabulary is DHMZ's own: the words `conditionText` passes through from
// the <Vrijeme> element of hrvatska1_n.xml, including the composed ones
// ("pretežno oblačno, jak vjetar") and the wind-only ones ("lahor") that name
// no sky at all. A word the table does not know gets no icon: the condition is
// already written out beside it, so a wrong picture is the only failure mode.
describe('weatherIcon', () => {
  it('names one of the seven sprite symbols for every sky DHMZ writes', () => {
    const cases: [string, string][] = [
      ['vedro', 'sun'],
      ['sunčano', 'sun'],
      ['pretežno vedro', 'sun'],
      ['djelomično oblačno', 'cloud-sun'],
      ['umjereno oblačno', 'cloud-sun'],
      ['umjereno oblačno, vjetrovito', 'cloud-sun'],
      ['oblačno', 'cloud'],
      ['pretežno oblačno', 'cloud'],
      ['pretežno oblačno, jak vjetar', 'cloud'],
      ['potpuno oblačno', 'cloud'],
      ['kiša', 'cloud-rain'],
      ['slaba kiša', 'cloud-rain'],
      ['pljusak', 'cloud-rain'],
      ['snijeg', 'cloud-snow'],
      ['magla', 'cloud-fog'],
      ['grmljavina', 'cloud-lightning'],
      ['grmljavina s oborinom', 'cloud-lightning'],
    ];
    for (const [condition, icon] of cases) expect(weatherIcon(condition), condition).toBe(icon);
  });

  it('only ever names a symbol the sprite carries', () => {
    for (const condition of ['vedro', 'umjereno oblačno', 'oblačno', 'kiša', 'snijeg', 'magla', 'grmljavina']) {
      expect(ICON_NAMES).toContain(weatherIcon(condition));
    }
  });

  it('reads the word however it is cased, spaced or spelled without diacritics', () => {
    expect(weatherIcon('VEDRO')).toBe('sun');
    expect(weatherIcon('  Umjereno Oblacno  ')).toBe('cloud-sun');
    expect(weatherIcon('Pretezno oblacno')).toBe('cloud');
    expect(weatherIcon('Kisa')).toBe('cloud-rain');
  });

  it('gives no icon to a word that names no sky', () => {
    for (const condition of ['lahor', 'povjetarac', 'slab vjetar', 'umjeren vjetar', 'umjereno jak vjetar', 'slaba rosulja', '', '-', 'burin']) {
      expect(weatherIcon(condition), condition).toBeNull();
    }
    expect(weatherIcon(null)).toBeNull();
  });
});
