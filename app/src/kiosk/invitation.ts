// The unpaired composition: the one map (about 60% of the width, with the
// lines board laid over its foot), and beside it the side column with the
// city first: the weather lockup, then the fixed invitation card with the
// rotating QR and readable code, then one bounded secondary story. Built
// once; update() rewrites only the text blocks, so the map container the
// page moved in is never touched by a poll.
//
// R-K7 composes the column so it fits its stage at both design sizes: the
// lockup is two lines under a 48 px condition icon (the sun line moved to
// the story's foot when no story shows, else to the strip), the card is
// QR-bound (lead and hint beside the QR, the code under it at wide, beside
// it at compact, no fourth line), and the story is a clamped headline with
// its credit, its title given as many lines as the room allows.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { CODE_URL_BASE } from '../code';
import type { ScreenStop } from '../core/contracts';
import { weatherIcon } from '../experience/weather-icon';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { byModule, linesAtStop, nearbyCountLine, stories, sunLine, sunToday, weatherNow, type LinesBoard, type Story, type WeatherNow } from './local';
import { plural, type KioskStrings } from './strings';

/** How long the outgoing story stays in the block, fading, before it is removed. */
export const STORY_LEAVE_MS = 180;

export interface InvitationDeps {
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
  lightweight: boolean;
  /** The origin the QR points at; the hint names its hostname. Production when absent. */
  codeBase?: string;
  /** Runs `fn` once after `ms` and returns its cancel: the controller's clock, so the leaving story goes on the timers the tests drive and destroy() leaves nothing armed. */
  defer?: (fn: () => void, ms: number) => () => void;
}

export interface InvitationModel {
  modules: readonly ModuleSnapshot[];
  stop: ScreenStop | null;
  now: number;
  /** Which of the bounded stories is up; the controller advances it on its 20 s tick. */
  storyIndex: number;
  /** Rows the lines board shows before "još N linija" (6 wide, 4 compact, 10 lightweight). */
  lineCap: number;
  /** The composition on screen: the facts line holds three details at wide and two at compact. */
  size: 'wide' | 'compact';
}

export interface InvitationHandle {
  element: HTMLElement;
  /** The page parks the one map container here (never in lightweight mode). */
  mapHost: HTMLElement;
  update(model: InvitationModel): void;
  /** Whether a story is on show right now (the strip carries the sun line while one is). */
  storyShowing(): boolean;
  /** Re-measures the story block and gives its title the lines that fit; called after fonts arrive and on the clock tick. */
  fit(): void;
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
          <div class="k-code-box"><p class="k-code" data-testid="pair-code" data-state="waiting"><span data-testid="code-a">····</span><span class="k-code-dash">-</span><span data-testid="code-b">····</span></p></div>
          <a class="k-visually-hidden" data-testid="pair-url" href="" hidden></a>
          <div class="k-progress" data-testid="code-progress" role="progressbar" aria-label="${escapeAttribute(strings.invitation.progressLabel)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><div class="k-progress-bar"></div></div>
        </div>`;
}

/** The weather lockup: the condition icon, the reading with the condition word, one facts line of `facts` details (humidity, wind, pressure in that order; the compact column holds two), and the credit naming the observation time, the station and DHMZ. */
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

/** The lines board: one row per route at the stop, delay in words, vehicles near. */
export function linesMarkup(board: LinesBoard, stop: ScreenStop | null, strings: KioskStrings, locale: string): string {
  const title = stop ? strings.lines.title : strings.lines.nearbyTitle;
  const head = kicker(title, nearbyCountLine(board, strings, locale));
  if (board.state === 'loading') return `${head}<p class="k-board-note">${escapeHtml(strings.lines.loading)}</p>`;
  if (board.state === 'down') return `${head}<p class="k-board-note" data-state="down">${escapeHtml(strings.lines.unavailable)}</p>`;
  if (board.rows.length === 0) return `${head}<p class="k-board-note">${escapeHtml(stop ? strings.lines.noneNearby : strings.lines.noStop)}</p>`;
  const more = board.more > 0 ? `<p class="k-line-more">${escapeHtml(plural(locale, strings.lines.more, board.more))}</p>` : '';
  const stale = board.state === 'stale' ? ` · ${strings.paired.stale}` : '';
  return `${head}<ul class="k-line-list">${board.rows.map((row) => lineRow(row, strings, locale)).join('')}</ul>${more}<p class="k-meta">${escapeHtml(`${strings.lines.modelNote} · ZET${stale}`)}</p>`;
}

/** A story: its kicker, the headline and the credit; with none, the honest sentence and the sun line as the block's foot. */
export function storyMarkup(story: Story | null, strings: KioskStrings, sourcesDown = false, foot = ''): string {
  // No story because the sources are not answering is said so; only an answering source with nothing new is "nothing new".
  if (!story) {
    const sun = foot ? `<p class="k-story-sun">${escapeHtml(foot)}</p>` : '';
    return `${kicker(strings.story.city)}<p class="k-story-title k-story-title--empty"${sourcesDown ? ' data-state="down"' : ''}>${escapeHtml(sourcesDown ? strings.paired.sourceDown : strings.story.empty)}</p>${sun}`;
  }
  const meta = [story.meta, story.source].filter(Boolean).join(' · ');
  return `${kicker(story.kicker, '', story.tone)}<p class="k-story-title" title="${escapeAttribute(story.attribution)}">${escapeHtml(story.title)}</p><p class="k-meta">${escapeHtml(meta)}</p>`;
}

function invitationMarkup(s: KioskStrings, lightweight: boolean, codeBase?: string): string {
  return `<div class="k-map" data-testid="kiosk-live">
      <div class="k-map-host" data-testid="kiosk-map-host"${lightweight ? ' hidden' : ''}></div>
      <div class="k-lines ${lightweight ? 'k-lines--board' : 'k-lines--overlay'}" data-testid="kiosk-lines"></div>
    </div>
    <aside class="k-side">
      <article class="k-weather" data-testid="kiosk-weather"></article>
      <article class="k-invite" data-testid="kiosk-invite">
        <div class="k-qr" data-testid="kiosk-qr"><p class="k-qr-waiting">${escapeHtml(s.invitation.qrWaiting)}</p></div>
        <div class="k-invite-text"><h1 class="k-lead">${escapeHtml(s.invitation.lead)}</h1>${hintMarkup(s, codeBase)}</div>
        ${codeBlockMarkup(s)}
      </article>
      <article class="k-story" data-testid="kiosk-story"></article>
    </aside>`;
}

export function mountInvitation(host: HTMLElement, deps: InvitationDeps): InvitationHandle {
  const { strings: s, i18n, locale } = deps;
  const defer = deps.defer ?? ((fn, ms) => { const handle = globalThis.setTimeout(fn, ms); return () => globalThis.clearTimeout(handle); });
  /** Cancels of the leave timers still pending, keyed by the item they remove. */
  const leaving = new Map<HTMLElement, () => void>();
  const element = document.createElement('section');
  element.className = 'k-invitation';
  element.dataset.testid = 'kiosk-invitation';
  element.innerHTML = invitationMarkup(s, deps.lightweight, deps.codeBase);
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
  let showing = false;

  /** The title gets two lines when the box has room for them, one otherwise; a DOM without layout measures nothing and changes nothing. */
  function fit(): void {
    if (storyBox.clientHeight === 0) return;
    delete storyBox.dataset.lines;
    if (storyBox.scrollHeight > storyBox.clientHeight + 1) storyBox.dataset.lines = '1';
  }

  /** The story on show leaves under data-leaving (a 180 ms fade, absolute so the box never moves) while the next one enters; the box keeps one item afterwards. */
  function swapStory(html: string): void {
    // A change faster than the fade: the copy already leaving goes at once, its timer with it.
    for (const [stale, cancel] of leaving) { cancel(); stale.remove(); }
    leaving.clear();
    const previous = storyBox.querySelector<HTMLElement>('.k-story-item');
    const next = document.createElement('div');
    next.className = 'k-story-item';
    next.innerHTML = html;
    if (previous) {
      previous.dataset.leaving = '1';
      leaving.set(previous, defer(() => { leaving.delete(previous); previous.remove(); }, STORY_LEAVE_MS));
    }
    storyBox.appendChild(next);
  }

  return {
    element,
    mapHost,
    update(model) {
      const lines = linesMarkup(linesAtStop(model.modules, model.stop, i18n, model.lineCap), model.stop, s, locale);
      if (lines !== lastLines) { linesBox.innerHTML = lines; lastLines = lines; }
      const weather = weatherMarkup(weatherNow(model.modules, s, locale), s, model.size === 'wide' ? 3 : 2);
      if (weather !== lastWeather) { weatherBox.innerHTML = weather; lastWeather = weather; }
      const list = stories(model.modules, s, locale, model.now);
      const story = list.length > 0 ? list[model.storyIndex % list.length]! : null;
      showing = story !== null;
      const sources = (['dogadanja', 'hrt-news', 'emsc'] as const).map((id) => byModule(model.modules)[id]);
      const sun = story ? '' : sunLine(sunToday(model.now), s);
      const html = sources.every((snapshot) => snapshot === undefined)
        ? `${kicker(s.story.city)}<p class="k-story-title k-story-title--empty" data-state="loading">${escapeHtml(i18n.t('status.loading'))}</p><p class="k-story-sun">${escapeHtml(sun)}</p>`
        : storyMarkup(story, s, sources.every((snapshot) => snapshot?.status === 'down'), sun);
      if (html !== lastStory) {
        swapStory(html);
        storyBox.dataset.tone = story?.tone ?? 'empty';
        storyBox.dataset.storyId = story?.id ?? '';
        lastStory = html;
      }
      fit();
    },
    storyShowing: () => showing,
    fit,
    destroy() {
      for (const cancel of leaving.values()) cancel();
      leaving.clear();
      element.remove();
    },
  };
}
