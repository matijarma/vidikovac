// The unpaired composition (C.3): the scene field on the left, which
// kiosk/scenes.ts rotates through Promet, Večeras and Grad on the controller's
// clock, and the side column on the right: the two value tiles (vehicles
// moving on the network, closures within 1.5 km of the stop; frame.ts's
// valueTiles, D18) over the fixed, accent-filled invitation card with the
// rotating QR, the lead, the hint and the readable code. Built once; update()
// hands the field its model and rewrites the tiles only when their markup
// changed, so the map container the page moved in and the code the rotation
// paints are never touched by a poll.
//
// The header carries the weather (D11) and the strip the safety words, so
// nothing here says either. This file also keeps the shared markup helpers
// the lagano board, the scene tiles and the paired compositions draw with
// (kBadge, kicker, linesMarkup, weatherMarkup) and the card pieces the
// handheld reuses (codeHost, hintMarkup, codeBlockMarkup).
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { CODE_URL_BASE } from '../code';
import type { ScreenStop } from '../core/contracts';
import { weatherIcon } from '../experience/weather-icon';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { tileMarkup, valueTiles } from './frame';
import { nearbyCountLine, type LinesBoard, type WeatherNow } from './local';
import { mountScenes, type SceneId, type ScenesHandle } from './scenes';
import { plural, type KioskStrings } from './strings';

export interface InvitationDeps {
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
  lightweight: boolean;
  /** The origin the QR points at; the hint names its hostname. Production when absent. */
  codeBase?: string;
  /** Runs `fn` once after `ms` and returns its cancel: the controller's clock, so the leaving scene goes on the timers the tests drive and destroy() leaves nothing armed. */
  defer?: (fn: () => void, ms: number) => () => void;
}

export interface InvitationModel {
  modules: readonly ModuleSnapshot[];
  stop: ScreenStop | null;
  now: number;
  /** The controller's rotation counter; the scene on show is `order[sceneIndex % order.length]` while rotating. */
  sceneIndex: number;
  /** `?prizor=` (D13): one scene, no rotation. */
  pinned: SceneId | null;
  /** False under reduced motion, lagano and the pin: the field holds Promet (or the pinned scene). */
  rotate: boolean;
  /** Members a chapter's rail asks for before it has been measured: the drawing's own count (6 wide, 4 compact, 3 handheld, 10 lightweight). */
  columns: number;
  size: 'wide' | 'compact';
}

export interface InvitationHandle {
  element: HTMLElement;
  /** The field's own map host: the map is the field and stands through every chapter, so this is null only in lightweight mode, which has no map. */
  readonly mapHost: HTMLElement | null;
  update(model: InvitationModel): void;
  scenes(): ScenesHandle;
  /** Re-measures the field's titled tiles; called after every update and on the clock tick. */
  fit(): void;
  /** The rail's measured height where it hangs over the map, for the map's own bottom padding. */
  railPad(): number;
  destroy(): void;
}

export function kicker(text: string, meta = '', tone = ''): string {
  return `<p class="k-kicker${tone ? ` k-kicker--${escapeAttribute(tone)}` : ''}"><span>${escapeHtml(text)}</span>${meta ? `<span class="k-kicker-meta">${escapeHtml(meta)}</span>` : ''}</p>`;
}

/** The one line badge (signage.css `.line`) at the kiosk's k size; `.k-line-badge` keeps the kiosk's geometry, `.line` paints the mode. */
export function kBadge(label: string, kind: 'tram' | 'bus' | 'other', ariaLabel = ''): string {
  return `<span class="k-line-badge line" data-kind="${kind}" data-size="k"${ariaLabel ? ` aria-label="${escapeAttribute(ariaLabel)}"` : ''}>${escapeHtml(label)}</span>`;
}

/** The hostname a person types, read from the code base: "zagreb.aningfilm.hr/s" in production, the dev host in a worktree. */
export function codeHost(codeBase: string = CODE_URL_BASE): string {
  return `${codeBase.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '')}/s`;
}

/** "ili upiši kod na" and, on its own never-wrapping line, the address. */
export function hintMarkup(strings: KioskStrings, codeBase?: string): string {
  const [before = '', after = ''] = strings.invitation.typeCode.split('{host}');
  return `<p class="k-hint">${escapeHtml(before)}<span class="k-hint-host">${escapeHtml(codeHost(codeBase))}</span>${escapeHtml(after)}</p>`;
}

/** The code, its payload link (hidden, for the scanner-less) and the remaining-time bar; the controller paints all three. */
export function codeBlockMarkup(strings: KioskStrings): string {
  return `<div class="k-invite-code">
          <div class="k-code-box"><p class="k-code" data-testid="pair-code" data-state="waiting"><span data-testid="code-a">····</span><span class="k-code-dash">·</span><span data-testid="code-b">····</span></p></div>
          <a class="k-visually-hidden" data-testid="pair-url" href="" hidden></a>
          <div class="k-progress" data-testid="code-progress" role="progressbar" aria-label="${escapeAttribute(strings.invitation.progressLabel)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><div class="k-progress-bar"></div></div>
        </div>`;
}

/** The paired compositions' weather block (zrak-i-nebo, the Sada overview): the condition icon, the reading with the condition word, one facts line of `facts` details (humidity, wind, pressure in that order; the compact column holds two), and the credit naming the observation time, the station and DHMZ. */
export function weatherMarkup(weather: WeatherNow, strings: KioskStrings, facts = 3): string {
  if (weather.state === 'loading' || (weather.state === 'down' && weather.temperature === null)) {
    const text = weather.state === 'loading' ? strings.weather.loading : strings.weather.unavailable;
    return `<p class="k-weather-note" data-state="${weather.state}">${escapeHtml(text)}</p>`;
  }
  const icon = weatherIcon(weather.condition);
  const stale = weather.state === 'stale' ? `<span class="k-chip k-chip--stale">${escapeHtml(strings.paired.stale)}</span>` : '';
  const temp = weather.temperature !== null
    ? `<span class="k-temp" data-testid="kiosk-temp">${escapeHtml(weather.temperature)}</span>`
    : `<span class="k-temp k-temp--none" data-testid="kiosk-temp" data-state="none">${escapeHtml(strings.weather.noReading)}</span>`;
  const condition = weather.condition ? `<span class="k-condition">${escapeHtml(weather.condition)}</span>` : '';
  const shown = weather.details.slice(0, facts);
  const details = shown.length > 0 ? `<p class="k-weather-details">${escapeHtml(shown.join(' · '))}</p>` : '';
  return `<div class="k-weather-main">${icon ? iconMarkup(icon, undefined, 'icon k-weather-icon') : ''}${temp}${condition}${stale}</div>${details}<p class="k-meta">${escapeHtml([weather.observedAt, weather.station, 'DHMZ'].filter(Boolean).join(' · '))}</p>`;
}

function lineRow(row: LinesBoard['rows'][number], strings: KioskStrings, locale: string): string {
  const near = row.nearby > 0 ? plural(locale, strings.lines.nearby, row.nearby) : strings.lines.noneNearby;
  const kindWord = row.kind === 'tram' ? strings.lines.tram : row.kind === 'bus' ? strings.lines.bus : '';
  return `<li class="k-line" data-kind="${row.kind}" data-route="${escapeAttribute(row.routeId)}">
      ${kBadge(row.label, row.kind, `${kindWord} ${row.label}`.trim())}
      <span class="k-line-name">${escapeHtml(row.longName)}</span>
      <span class="k-line-word">${escapeHtml(row.word)}</span>
      <span class="k-line-near">${escapeHtml(near)}</span>
    </li>`;
}

/** The board's rows alone: the lagano board's grammar, which the scene rail
 *  stands its own members up in when the room holds only one column. */
export function lineRows(board: LinesBoard, strings: KioskStrings, locale: string): string {
  return board.rows.map((row) => lineRow(row, strings, locale)).join('');
}

/** The lines board (the lagano Promet scene, D12, and paired Promet): one row per route at the stop, delay in words, vehicles near. */
export function linesMarkup(board: LinesBoard, stop: ScreenStop | null, strings: KioskStrings, locale: string): string {
  const title = stop ? strings.lines.title : strings.lines.nearbyTitle;
  const head = kicker(title, nearbyCountLine(board, strings, locale));
  if (board.state === 'loading') return `${head}<p class="k-board-note">${escapeHtml(strings.lines.loading)}</p>`;
  if (board.state === 'down') return `${head}<p class="k-board-note" data-state="down">${escapeHtml(strings.lines.unavailable)}</p>`;
  if (board.rows.length === 0) return `${head}<p class="k-board-note">${escapeHtml(stop ? strings.lines.noneNearby : strings.lines.noStop)}</p>`;
  const more = board.more > 0 ? `<p class="k-line-more">${escapeHtml(plural(locale, strings.lines.more, board.more))}</p>` : '';
  const stale = board.state === 'stale' ? ` · ${strings.paired.stale}` : '';
  return `${head}<ul class="k-line-list">${lineRows(board, strings, locale)}</ul>${more}<p class="k-meta">${escapeHtml(`${strings.lines.modelNote} · ZET${stale}`)}</p>`;
}

/** The side column: the two value tiles, then the card whose QR and code the rotation paints (C.3). The lead is the page's one h1. */
function sideMarkup(s: KioskStrings, codeBase?: string): string {
  return `<div class="k-side-tiles" data-testid="kiosk-tiles"></div>
    <article class="k-invite" data-testid="kiosk-invite">
      <h1 class="k-lead">${escapeHtml(s.invitation.lead)}</h1>
      <div class="k-qr" data-testid="kiosk-qr"><p class="k-qr-waiting">${escapeHtml(s.invitation.qrWaiting)}</p></div>
      ${hintMarkup(s, codeBase)}
      ${codeBlockMarkup(s)}
    </article>`;
}

export function mountInvitation(host: HTMLElement, deps: InvitationDeps): InvitationHandle {
  const { strings: s, i18n, locale, lightweight } = deps;
  const element = document.createElement('section');
  element.className = 'k-invitation';
  element.dataset.testid = 'kiosk-invitation';
  host.appendChild(element);
  // The field takes the grid's first column, the side column the second.
  const field = mountScenes(element, deps);
  const side = document.createElement('aside');
  side.className = 'k-side';
  side.innerHTML = sideMarkup(s, deps.codeBase);
  element.appendChild(side);
  const tilesBox = side.querySelector<HTMLElement>('[data-testid=kiosk-tiles]')!;
  // The tiles are rewritten only when their markup changed: a poll that
  // brought the same numbers repaints nothing, and a reader mid-glance is
  // never interrupted by an identical re-render.
  let lastTiles = '';

  return {
    element,
    get mapHost() { return field.mapHost; },
    update(model) {
      field.update({
        modules: model.modules, stop: model.stop, now: model.now, strings: s, i18n, locale, lightweight,
        size: model.size, columns: model.columns, index: model.sceneIndex, pinned: model.pinned, rotate: model.rotate,
      });
      const tiles = valueTiles(model.modules, model.stop, i18n, s, locale, model.now).map((tile) => tileMarkup(tile, s)).join('');
      if (tiles !== lastTiles) { tilesBox.innerHTML = tiles; lastTiles = tiles; }
    },
    scenes: () => field,
    fit: () => field.fit(),
    railPad: () => field.railPad(),
    destroy() {
      field.destroy();
      element.remove();
    },
  };
}
