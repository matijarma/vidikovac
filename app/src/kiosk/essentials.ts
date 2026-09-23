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
import { activeWarnings, cleanCondition, closuresNear, isLive, byModule, linesNearby, nearestPharmacy } from './local';
import type { KioskStrings } from './strings';
import { vetExternal } from '../../../shared/kiosk/external-text';
import { externalHtml, optionalExternal } from './external';
import { escapeHtml } from '../ui/dom/escape';

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

/** The card boundary also accepts direct callers, never unchecked field text. */
export function essentialsMarkup(rows: readonly EssentialsRow[]): string {
  return rows.filter(row => vetExternal('title', row.value, 'row') !== null && optionalExternal('summary', row.detail))
    .map(row => `<div class="ess-row k-ess-row" data-testid="ess-row" data-row="${row.id}">${row.label ? `<p class="k-ess-label">${escapeHtml(row.label)}</p>` : ''}<p class="k-ess-value">${externalHtml('title', row.value)}</p>${row.detail ? `<p class="k-ess-detail">${externalHtml('summary', row.detail)}</p>` : ''}${row.attribution ? `<p class="k-meta ess-attr">${externalHtml('summary', row.attribution)}</p>` : ''}</div>`).join('');
}

export function essentialsRows(modules: readonly ModuleSnapshot[], i18n: I18n, strings: KioskStrings, locale: string, stop: ScreenStop | null, now: number): EssentialsRow[] {
  const map = byModule(modules);
  const rows: EssentialsRow[] = [];
  /** A last-good copy is shown, but says so. */
  const staleMark = (snapshot: ModuleSnapshot | undefined): string => (snapshot?.status === 'stale' ? ` · ${strings.paired.stale}` : '');

  const capSnap = map['dhmz-cap'];
  // The most severe warning whose window includes now; an ended or announced one is not a warning right now.
  const warning = activeWarnings(capSnap, now)[0];
  if (isLive(capSnap) && warning) {
    rows.push({
      id: 'cap',
      label: strings.basics.warnings,
      value: `${i18n.t(`panels.severity.${warning.severity ?? 'info'}`)}${staleMark(capSnap)}`,
      detail: warning.title,
      attribution: fillAttribution(capSnap.attribution, capSnap, warning),
    });
  }

  const closures = closuresNear(modules, stop, now);
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
      value: `${temp === null ? i18n.t('common.unavailable') : fmtTemp(locale, temp)}${staleMark(weatherSnap)}`,
      detail: cleanCondition(vetExternal('summary', dataText(observation, 'weather'), 'row') ?? '') || undefined,
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

/** Osnovno holds whole cards only. The panel is the stage's own box, and at
 *  1366 x 768 with a warning in the strip five cards at the reading tiers do
 *  not fit it: after a paint and on a resize the cards the box does not hold
 *  are hidden from the last one up (the pharmacy first, which the strip under
 *  the panel keeps in view with its address), never cut and never scrolled;
 *  the first card always stays. A DOM without layout measures nothing and
 *  hides nothing; `measure` is injectable for that. */
export function fitEssentials(rows: HTMLElement, measure: (el: HTMLElement) => { scroll: number; client: number } = (el) => ({ scroll: el.scrollHeight, client: el.clientHeight })): void {
  const cards = [...rows.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
  for (const card of cards) card.hidden = false;
  const over = (): boolean => { const m = measure(rows); return m.client > 0 && m.scroll > m.client + 1; };
  for (let visible = cards.length; visible > 1 && over(); visible -= 1) cards[visible - 1]!.hidden = true;
  rows.dataset.overflow = over() ? 'true' : 'false';
}
