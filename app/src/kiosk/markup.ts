// The kiosk's shared markup helpers: the pieces more than one composition
// draws with. The line badge and the kicker (the lagano board, a statement's
// badge row, the paired blocks), the lines board itself (the lagano field and
// paired Promet), the paired weather block, and the invitation card's own
// pieces (the typed address, the code block). Pure string builders over
// already-read models: no DOM, no fetch, no clock.
//
// Kept apart from kiosk/invitation.ts on purpose: field.ts and say.ts draw
// with these and invitation.ts composes field and column, so the helpers
// living in invitation.ts made a module cycle (field -> invitation -> field).
// invitation.ts keeps only the invitation composition (R-KP23).
import { CODE_URL_BASE } from '../code';
import type { ScreenStop } from '../core/contracts';
import { weatherIcon } from '../experience/weather-icon';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { nearbyCountLine, type LinesBoard, type WeatherNow } from './local';
import { plural, type KioskStrings } from './strings';

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

/** The address with a break opportunity before every dot and before the path,
 *  so beside a 240 px QR it wraps at its own joints ("zagreb" / ".aningfilm" /
 *  ".hr/s": the punctuation opens the next line, so no line ends like a
 *  sentence and "/s" never stands alone) rather than being ellipsised: a
 *  typed address is useless in half. */
export function hostMarkup(host: string): string {
  return host.split(/(?=[./])/).map(escapeHtml).join('<wbr>');
}

/** "ili upiši kod na" and, on its own line, the address. */
export function hintMarkup(strings: KioskStrings, codeBase?: string): string {
  const [before = '', after = ''] = strings.invitation.typeCode.split('{host}');
  return `<p class="k-hint">${escapeHtml(before)}<span class="k-hint-host">${hostMarkup(codeHost(codeBase))}</span>${escapeHtml(after)}</p>`;
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

/** The board's rows alone: the lagano board's grammar. */
export function lineRows(board: LinesBoard, strings: KioskStrings, locale: string): string {
  return board.rows.map((row) => lineRow(row, strings, locale)).join('');
}

/** The lines board (the lagano field, R-L2, and paired Promet): one row per route at the stop, delay in words, vehicles near. */
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
