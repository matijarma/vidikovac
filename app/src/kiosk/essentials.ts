// "Osnovno": the five things a locked screen answers without a phone, read
// from the same open-tier teaser the invitation already receives. No new
// endpoint, no session, no countdown. A row is skipped outright when its
// source is down or has nothing to say; when none has anything, the one
// honest sentence points at /hitno, which renders the same safety line on
// the server (docs/kiosk.md, "Osnovno, bez telefona").
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { LJEKARNE_SOURCE } from '../../../worker/hitno/ljekarne';
import { fillAttribution } from '../attribution';
import type { ScreenStop } from '../core/contracts';
import type { I18n } from '../i18n/i18n';
import { dataNumber, dataText } from '../panels/panel';
import { fmtTemp } from './format';
import { closuresNear, isLive, byModule, linesNearby, nearestPharmacy } from './local';
import type { KioskStrings } from './strings';

/** Never more than this many routes on the board: the wall-of-text bug of
 *  12 September had every route in the city on one row. */
export const ESSENTIALS_ROUTE_CAP = 8;

export interface EssentialsRow {
  id: 'cap' | 'closures' | 'routes' | 'weather' | 'pharmacy' | 'empty';
  label: string;
  value: string;
  detail?: string;
  attribution?: string;
}

export function essentialsRows(modules: readonly ModuleSnapshot[], i18n: I18n, strings: KioskStrings, locale: string, stop: ScreenStop | null): EssentialsRow[] {
  const map = byModule(modules);
  const rows: EssentialsRow[] = [];
  /** A last-good copy is shown, but says so. */
  const staleMark = (snapshot: ModuleSnapshot | undefined): string => (snapshot?.status === 'stale' ? ` · ${strings.paired.stale}` : '');

  const capSnap = map['dhmz-cap'];
  const warning = capSnap?.items[0];
  if (isLive(capSnap) && warning) {
    rows.push({
      id: 'cap',
      label: strings.basics.warnings,
      value: `${i18n.t(`panels.severity.${warning.severity ?? 'info'}`)}${staleMark(capSnap)}`,
      detail: warning.title,
      attribution: fillAttribution(capSnap.attribution, capSnap, warning),
    });
  }

  const closures = closuresNear(modules, stop);
  const closuresSnap = map.prometnice;
  if (isLive(closuresSnap) && closures.count > 0 && closures.nearest) {
    rows.push({
      id: 'closures',
      label: strings.basics.closures,
      value: `${i18n.t('panels.closuresCount', { count: closures.count })}${staleMark(closuresSnap)}`,
      detail: closures.nearest.title,
      attribution: fillAttribution(closuresSnap.attribution, closuresSnap, closures.nearest.item),
    });
  }

  const zetSnap = map['zet-rt'];
  const nearby = linesNearby(modules, i18n).slice(0, ESSENTIALS_ROUTE_CAP);
  const [first, ...rest] = nearby;
  if (isLive(zetSnap) && first) {
    const line = (row: { label: string; word: string }): string => `${row.label} ${row.word}`;
    const representative = zetSnap.items.find((item) => item.id === `route:${first.routeId}`) ?? zetSnap.items.find((item) => item.id.startsWith('vehicle:'));
    rows.push({
      id: 'routes',
      label: strings.basics.routes,
      value: line(first),
      detail: rest.length > 0 ? rest.map(line).join(' · ') : undefined,
      attribution: fillAttribution(zetSnap.attribution, zetSnap, representative),
    });
  }

  const weatherSnap = map['dhmz-now'];
  const observation = weatherSnap?.items[0];
  if (isLive(weatherSnap) && observation) {
    const temp = dataNumber(observation, 'temp');
    rows.push({
      id: 'weather',
      label: strings.basics.weather,
      value: temp === null ? i18n.t('common.unavailable') : fmtTemp(locale, temp),
      detail: dataText(observation, 'weather') || undefined,
      attribution: fillAttribution(weatherSnap.attribution, weatherSnap, observation),
    });
  }

  // The curated on-duty list is real Grad Zagreb data; the open ckan-geo feed
  // never tags a pharmacy, so the feed only gates whether the safety tier is
  // answering at all (when it is down, /hitno's server render carries the
  // same list and the board points there instead of guessing).
  const poiSnap = map['ckan-geo'];
  if (isLive(poiSnap) && poiSnap.items.length > 0) {
    const tagged = poiSnap.items.find((item) => dataText(item, 'category') === 'ljekarne');
    const onDuty = nearestPharmacy(stop);
    rows.push({
      id: 'pharmacy',
      label: strings.basics.pharmacy,
      value: tagged ? tagged.title : onDuty.label,
      detail: tagged ? undefined : onDuty.hours,
      attribution: tagged ? fillAttribution(poiSnap.attribution, poiSnap, tagged) : LJEKARNE_SOURCE.text,
    });
  }

  if (rows.length === 0) rows.push({ id: 'empty', label: '', value: strings.basics.empty });
  return rows;
}
