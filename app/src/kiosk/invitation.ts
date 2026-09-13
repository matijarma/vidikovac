// The unpaired composition: the one map (about 60% of the width, with the
// lines board laid over its foot), and beside it the fixed invitation with
// the rotating QR and readable code, the weather now, and one bounded
// secondary story. Built once; update() rewrites only the text blocks, so
// the map container the page moved in is never touched by a poll.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { ScreenStop } from '../core/contracts';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { byModule, linesAtStop, nearbyCountLine, stories, sunLine, sunToday, weatherNow, type LinesBoard, type Story, type WeatherNow } from './local';
import { plural, type KioskStrings } from './strings';

export interface InvitationDeps {
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
  lightweight: boolean;
}

export interface InvitationModel {
  modules: readonly ModuleSnapshot[];
  stop: ScreenStop | null;
  now: number;
  /** Which of the bounded stories is up; the controller advances it on its 20 s tick. */
  storyIndex: number;
  /** Rows the lines board shows before "još N linija" (6 wide, 4 compact, 10 lightweight). */
  lineCap: number;
}

export interface InvitationHandle {
  element: HTMLElement;
  /** The page parks the one map container here (never in lightweight mode). */
  mapHost: HTMLElement;
  update(model: InvitationModel): void;
  destroy(): void;
}

export function kicker(text: string, meta = '', tone = ''): string {
  return `<p class="k-kicker${tone ? ` k-kicker--${escapeAttribute(tone)}` : ''}"><span>${escapeHtml(text)}</span>${meta ? `<span class="k-kicker-meta">${escapeHtml(meta)}</span>` : ''}</p>`;
}

/** The weather block: reading, condition, three details, the computed sun, and the observation time. */
export function weatherMarkup(weather: WeatherNow, now: number, strings: KioskStrings): string {
  const sun = sunLine(sunToday(now), strings);
  if (weather.state === 'loading' || (weather.state === 'down' && weather.temperature === null)) {
    const text = weather.state === 'loading' ? strings.weather.loading : strings.weather.unavailable;
    return `${kicker(strings.weather.title)}<p class="k-weather-note" data-state="${weather.state}">${escapeHtml(text)}</p><p class="k-weather-sun">${escapeHtml(sun)}</p>`;
  }
  const stale = weather.state === 'stale' ? `<span class="k-chip k-chip--stale">${escapeHtml(strings.paired.stale)}</span>` : '';
  return `${kicker(strings.weather.title, weather.station)}
    <div class="k-weather-main">${weather.temperature !== null ? `<span class="k-temp" data-testid="kiosk-temp">${escapeHtml(weather.temperature)}</span>` : `<span class="k-temp k-temp--none" data-testid="kiosk-temp" data-state="none">${escapeHtml(strings.weather.noReading)}</span>`}<span class="k-condition">${escapeHtml(weather.condition)}</span>${stale}</div>
    <p class="k-weather-details">${escapeHtml(weather.details.join(' · '))}</p>
    <p class="k-weather-sun">${escapeHtml(sun)}</p>
    <p class="k-meta">${escapeHtml([weather.observedAt, 'DHMZ'].filter(Boolean).join(' · '))}</p>`;
}

function lineRow(row: LinesBoard['rows'][number], strings: KioskStrings, locale: string): string {
  const near = row.nearby > 0 ? plural(locale, strings.lines.nearby, row.nearby) : strings.lines.noneNearby;
  const kindWord = row.kind === 'tram' ? strings.lines.tram : row.kind === 'bus' ? strings.lines.bus : '';
  return `<li class="k-line" data-kind="${row.kind}" data-route="${escapeAttribute(row.routeId)}">
      <span class="k-line-badge" aria-label="${escapeAttribute(`${kindWord} ${row.label}`.trim())}">${escapeHtml(row.label)}</span>
      <span class="k-line-name">${escapeHtml(row.longName)}</span>
      <span class="k-line-word">${escapeHtml(row.word)}</span>
      <span class="k-line-near">${escapeHtml(near)}</span>
    </li>`;
}

/** The lines board: one row per route at the stop, delay in words, vehicles near. */
export function linesMarkup(board: LinesBoard, stop: ScreenStop | null, strings: KioskStrings, locale: string): string {
  const title = stop ? strings.lines.title : strings.lines.nearbyTitle;
  const head = kicker(title, nearbyCountLine(board, strings, locale));
  if (board.state === 'loading' && board.rows.length === 0) return `${head}<p class="k-board-note">${escapeHtml(strings.lines.loading)}</p>`;
  if (board.state === 'down') return `${head}<p class="k-board-note" data-state="down">${escapeHtml(strings.lines.unavailable)}</p>`;
  if (board.rows.length === 0) return `${head}<p class="k-board-note">${escapeHtml(stop ? strings.lines.noneNearby : strings.lines.noStop)}</p>`;
  const more = board.more > 0 ? `<p class="k-line-more">${escapeHtml(plural(locale, strings.lines.more, board.more))}</p>` : '';
  const stale = board.state === 'stale' ? ` · ${strings.paired.stale}` : '';
  return `${head}<ul class="k-line-list">${board.rows.map((row) => lineRow(row, strings, locale)).join('')}</ul>${more}<p class="k-meta">${escapeHtml(`${strings.lines.modelNote} · ZET${stale}`)}</p>`;
}

export function storyMarkup(story: Story | null, strings: KioskStrings, sourcesDown = false): string {
  // No story because the sources are not answering is said so; only an answering source with nothing new is "nothing new".
  if (!story) return `${kicker(strings.story.city)}<p class="k-story-title k-story-title--empty"${sourcesDown ? ' data-state="down"' : ''}>${escapeHtml(sourcesDown ? strings.paired.sourceDown : strings.story.empty)}</p>`;
  const meta = [story.meta, story.source].filter(Boolean).join(' · ');
  return `${kicker(story.kicker, '', story.tone)}<p class="k-story-title" title="${escapeAttribute(story.attribution)}">${escapeHtml(story.title)}</p><p class="k-meta">${escapeHtml(meta)}</p>`;
}

function invitationMarkup(s: KioskStrings, lightweight: boolean): string {
  return `<div class="k-map" data-testid="kiosk-live">
      <div class="k-map-host" data-testid="kiosk-map-host"${lightweight ? ' hidden' : ''}></div>
      <div class="k-lines ${lightweight ? 'k-lines--board' : 'k-lines--overlay'}" data-testid="kiosk-lines"></div>
    </div>
    <aside class="k-side">
      <article class="k-invite" data-testid="kiosk-invite">
        <div class="k-qr" data-testid="kiosk-qr"><p class="k-qr-waiting">${escapeHtml(s.invitation.qrWaiting)}</p></div>
        <div class="k-invite-text">
          <h1 class="k-lead">${escapeHtml(s.invitation.lead)}</h1>
          <p class="k-support">${escapeHtml(s.invitation.support)}</p>
        </div>
        <div class="k-invite-code">
          <p class="k-code" data-testid="pair-code" data-state="waiting"><span data-testid="code-a">····</span><span class="k-code-dash">-</span><span data-testid="code-b">····</span></p>
          <a class="k-visually-hidden" data-testid="pair-url" href="" hidden></a>
          <p class="k-hint">${escapeHtml(s.invitation.typeCode)}</p>
          <div class="k-progress" data-testid="code-progress" role="progressbar" aria-label="${escapeAttribute(s.invitation.progressLabel)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><div class="k-progress-bar"></div></div>
        </div>
      </article>
      <article class="k-weather" data-testid="kiosk-weather"></article>
      <article class="k-story" data-testid="kiosk-story"></article>
    </aside>`;
}

export function mountInvitation(host: HTMLElement, deps: InvitationDeps): InvitationHandle {
  const { strings: s, i18n, locale } = deps;
  const element = document.createElement('section');
  element.className = 'k-invitation';
  element.dataset.testid = 'kiosk-invitation';
  element.innerHTML = invitationMarkup(s, deps.lightweight);
  host.appendChild(element);
  const mapHost = element.querySelector<HTMLElement>('[data-testid=kiosk-map-host]')!;
  const linesBox = element.querySelector<HTMLElement>('[data-testid=kiosk-lines]')!;
  const weatherBox = element.querySelector<HTMLElement>('[data-testid=kiosk-weather]')!;
  const storyBox = element.querySelector<HTMLElement>('[data-testid=kiosk-story]')!;
  // Each block is rewritten only when its markup changed: a poll that
  // brought the same data repaints nothing, and a reader mid-sentence is
  // never interrupted by an identical re-render.
  let lastLines = '';
  let lastWeather = '';
  let lastStory = '';
  return {
    element,
    mapHost,
    update(model) {
      const lines = linesMarkup(linesAtStop(model.modules, model.stop, i18n, model.lineCap), model.stop, s, locale);
      if (lines !== lastLines) { linesBox.innerHTML = lines; lastLines = lines; }
      const weather = weatherMarkup(weatherNow(model.modules, s, locale), model.now, s);
      if (weather !== lastWeather) { weatherBox.innerHTML = weather; lastWeather = weather; }
      const list = stories(model.modules, s, locale, model.now);
      const story = list.length > 0 ? list[model.storyIndex % list.length]! : null;
      const sources = (['dogadanja', 'hrt-news', 'emsc'] as const).map((id) => byModule(model.modules)[id]);
      const html = storyMarkup(story, s, sources.every((snapshot) => snapshot?.status === 'down'));
      if (html !== lastStory) {
        storyBox.innerHTML = html;
        storyBox.dataset.tone = story?.tone ?? 'empty';
        storyBox.dataset.storyId = story?.id ?? '';
        lastStory = html;
      }
    },
    destroy() {
      element.remove();
    },
  };
}
