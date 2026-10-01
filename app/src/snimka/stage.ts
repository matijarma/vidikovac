// The stage of /snimka/: the map with its clock plate, the controls row, the
// scrubber, the layer chips, a polite status line and the side column (the
// service state, ZET's notice, the headline, the event). Every control is a
// real button, select or range, at least 44 px, with the page's focus ring;
// the keyboard map of the brief holds while the focus is inside the stage.
// The map itself arrives through one dynamic import (map-layer.ts), never in
// the lightweight mode, where the fleet numbers stand in its place and
// everything else works the same.
import { SPEEDS, isNewsFile, isNoticesFile, type NewsFile, type NoticesFile, type SnimkaState, type Speed } from '../../../shared/snimka';
import { SnimkaError } from '../../../shared/snimka-codec';
import type { ChunkState } from './chunks';
import type { TickReason } from './clock';
import type { Layers, Mount, SnimkaContext } from './context';
import { duration, formatZagrebLocal, num, zagrebClock, zagrebDateTime, zagrebDay, zagrebMidnight } from './format';
import { SN, fill } from './strings';
import { currentArticle, currentMarker, currentNotice } from './voices';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 3_600_000;
/** ZET's header this old is a feed that has stopped changing (the series' own stale rule is the twin's; this is the reader's word for it). */
export const FROZEN_AFTER_S = 120;
/** The badge's tone per state: a word and a shape, never colour alone (base.css .badge). */
const TONE: Record<SnimkaState, string> = { normal: 'live', reduced: 'stale', silent: 'down', unknown: 'info' };

type Attrs = Record<string, string | boolean | undefined>;
function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

/** An external link as the brief asks: a new tab, no referrer, and the hidden note for a screen reader. */
function externalLink(doc: Document, href: string, text: string, className = 'sn-link'): HTMLAnchorElement {
  const a = el(doc, 'a', { class: className, href, target: '_blank', rel: 'noopener noreferrer' }, text);
  a.append(el(doc, 'span', { class: 'visually-hidden' }, ` ${SN.news.newTab}`));
  return a;
}

/** replaceChildren without the nulls of an optional line. */
const present = (...nodes: (Node | null)[]): Node[] => nodes.filter((n): n is Node => n !== null);

const decodeNews = (raw: unknown): NewsFile => { if (!isNewsFile(raw)) throw new SnimkaError('news: not a news file'); return raw; };
const decodeNotices = (raw: unknown): NoticesFile => { if (!isNoticesFile(raw)) throw new SnimkaError('notices: not a notices file'); return raw; };

/** The series column index of an instant, clamped into the file. */
function minuteIndex(t0: number, n: number, atSec: number): number {
  return Math.max(0, Math.min(n - 1, Math.floor((atSec - t0) / 60)));
}

export const mountStage: Mount = (ctx, root) => {
  const { clock, frames, layers, series, doc } = ctx;
  const start = clock.start;
  const end = clock.end;
  const minutes = Math.round((end - start) / MINUTE_MS);
  let disposed = false;
  let scrubbing = false;
  let motion: ChunkState | null = null;
  /** The badge says "Učitavanje snimke" only until the map has read its first chunk; a later load keeps the series' word. */
  let motionSettled = ctx.lagano;
  let news: NewsFile | null = null;
  let notices: NoticesFile | null = null;

  // ---- the map box ---------------------------------------------------------------
  const mapBox = el(doc, 'div', { class: 'sn-map-box' });
  const plateDay = el(doc, 'span', { class: 'sn-plate-day' });
  const plateTime = el(doc, 'time', { class: 'sn-plate-time' });
  const plate = el(doc, 'div', { class: 'sn-plate' }, plateDay, plateTime);
  let mapHost: HTMLElement | null = null;
  let laganoSeen: HTMLElement | null = null;
  let laganoExpected: HTMLElement | null = null;
  if (ctx.lagano) {
    laganoSeen = el(doc, 'p', { class: 'sn-lagano-num' });
    laganoExpected = el(doc, 'p', { class: 'sn-lagano-expected' });
    mapBox.append(
      el(doc, 'div', { class: 'sn-lagano', 'data-sn': 'lagano' },
        laganoSeen,
        el(doc, 'p', { class: 'sn-lagano-label', text: SN.strip.fleetSeen }),
        laganoExpected,
        el(doc, 'p', { class: 'st-note sn-lagano-note', text: SN.stage.laganoNote }),
      ),
      plate,
    );
  } else {
    mapHost = el(doc, 'div', { class: 'sn-map', id: 'sn-map', 'data-sn': 'map' });
    mapBox.append(mapHost, plate);
  }

  // ---- the controls row -----------------------------------------------------------
  const playButton = el(doc, 'button', { type: 'button', class: 'btn sn-play', 'data-sn': 'play' });
  const prevButton = el(doc, 'button', { type: 'button', class: 'btn-ghost sn-chapter', 'data-sn': 'prev', 'aria-label': SN.controls.prev, title: SN.controls.prev },
    el(doc, 'span', { 'aria-hidden': 'true', text: '«' }));
  const nextButton = el(doc, 'button', { type: 'button', class: 'btn-ghost sn-chapter', 'data-sn': 'next', 'aria-label': SN.controls.next, title: SN.controls.next },
    el(doc, 'span', { 'aria-hidden': 'true', text: '»' }));
  const speedButtons = new Map<Speed, HTMLButtonElement>();
  // Not statistika.css's `.segmented`: `.st-body .segmented` would outrank the phone rule that hides this group.
  const speedGroup = el(doc, 'div', { class: 'sn-speed', role: 'group', 'aria-label': SN.controls.speed });
  for (const speed of SPEEDS) {
    const button = el(doc, 'button', { type: 'button', class: 'segment', 'data-speed': String(speed), 'aria-pressed': 'false' },
      el(doc, 'span', { text: SN.speed[speed] }), el(doc, 'span', { class: 'visually-hidden', text: `, ${SN.speedAria[speed]}` }));
    button.addEventListener('click', () => clock.setSpeed(speed));
    speedButtons.set(speed, button);
    speedGroup.append(button);
  }
  const speedSelect = el(doc, 'select', { class: 'sn-speed-select', 'aria-label': SN.controls.speed, 'data-sn': 'speed-select' });
  for (const speed of SPEEDS) speedSelect.append(el(doc, 'option', { value: String(speed), text: SN.speed[speed] }));
  speedSelect.addEventListener('change', () => {
    const next = SPEEDS.find((s) => String(s) === speedSelect.value);
    if (next) clock.setSpeed(next);
  });
  const speedPick = el(doc, 'div', { class: 'sn-speed-pick' }, speedSelect);
  const controls = el(doc, 'div', { class: 'sn-controls' }, playButton, el(doc, 'div', { class: 'sn-chapters', role: 'group', 'aria-label': SN.controls.chapters }, prevButton, nextButton), speedGroup, speedPick);

  playButton.addEventListener('click', () => {
    if (!clock.playing() && clock.now() >= end) clock.seek(start);
    clock.toggle();
  });
  prevButton.addEventListener('click', () => clock.prevChapter());
  nextButton.addEventListener('click', () => clock.nextChapter());

  // ---- the scrubber -----------------------------------------------------------------
  const range = el(doc, 'input', { type: 'range', class: 'sn-range', min: '0', max: String(minutes), step: '1', 'aria-label': SN.stage.scrubber, 'data-sn': 'scrubber' });
  const marks = el(doc, 'div', { class: 'sn-scrub-marks', 'aria-hidden': 'true' });
  const dayLabels = el(doc, 'div', { class: 'sn-scrub-days', 'aria-hidden': 'true' });
  const pct = (t: number): string => `${(((t - start) / (end - start)) * 100).toFixed(3)}%`;
  for (const chapter of clock.chapters()) {
    const tick = el(doc, 'span', { class: 'sn-mark-chapter', title: chapter.title });
    tick.style.insetInlineStart = pct(chapter.at);
    marks.append(tick);
  }
  for (let midnight = zagrebMidnight(start) + DAY_MS; midnight < end; midnight += DAY_MS) {
    const line = el(doc, 'span', { class: 'sn-mark-day' });
    line.style.insetInlineStart = pct(midnight);
    marks.append(line);
    const label = el(doc, 'span', { class: 'sn-day-label', text: zagrebDay(midnight) });
    label.style.insetInlineStart = pct(midnight);
    dayLabels.append(label);
  }
  const scrub = el(doc, 'div', { class: 'sn-scrub' }, range, marks, dayLabels);
  range.addEventListener('input', () => {
    scrubbing = true;
    clock.pause();
    clock.seek(start + Number(range.value) * MINUTE_MS);
  });
  range.addEventListener('change', () => { scrubbing = false; });
  range.addEventListener('blur', () => { scrubbing = false; });

  // ---- the layers --------------------------------------------------------------------
  const chipFor: Record<keyof Layers, HTMLButtonElement> = {
    vehicles: el(doc, 'button', { type: 'button', class: 'chip', 'data-layer': 'vehicles', 'aria-pressed': 'false', text: SN.layers.vehicles }),
    compare: el(doc, 'button', { type: 'button', class: 'chip', 'data-layer': 'compare', 'aria-pressed': 'false', text: SN.layers.compare }),
    bikes: el(doc, 'button', { type: 'button', class: 'chip', 'data-layer': 'bikes', 'aria-pressed': 'false', text: SN.layers.bikes }),
    closures: el(doc, 'button', { type: 'button', class: 'chip', 'data-layer': 'closures', 'aria-pressed': 'false', text: SN.layers.closures }),
  };
  for (const key of Object.keys(chipFor) as (keyof Layers)[]) chipFor[key].addEventListener('click', () => layers.set({ [key]: !layers.get()[key] }));
  const chips = el(doc, 'div', { class: 'chips sn-layer-chips', role: 'group', 'aria-label': SN.layers.label }, ...Object.values(chipFor));
  const compareNote = el(doc, 'p', { class: 'st-note sn-layer-note', 'data-sn': 'compare-note', text: SN.layers.compareNote, hidden: true });
  const speedNote = el(doc, 'p', { class: 'st-note sn-layer-note', 'data-sn': 'speed-note', text: SN.layers.noVehiclesAtSpeed, hidden: true });
  const layersRow = el(doc, 'div', { class: 'sn-layers' }, el(doc, 'span', { class: 'sn-layers-label', text: SN.layers.label }), chips, compareNote, speedNote);

  const status = el(doc, 'p', { class: 'sn-status', role: 'status', 'aria-live': 'polite', 'data-sn': 'status' });
  const reducedNote = ctx.reducedMotion ? el(doc, 'p', { class: 'st-note sn-reduced-note', text: SN.stage.reducedNote }) : null;

  // ---- the side column -----------------------------------------------------------------
  const badgeWord = el(doc, 'span', { class: 'badge sn-badge', 'data-sn': 'badge' });
  const retroMark = el(doc, 'span', { class: 'sn-retro', 'data-sn': 'retro', text: SN.badge.retroShort, hidden: true });
  const counts = el(doc, 'p', { class: 'sn-counts', 'data-sn': 'counts' });
  const holds = el(doc, 'p', { class: 'sn-holds', 'data-sn': 'holds' });
  const feedLine = el(doc, 'p', { class: 'sn-feed', 'data-sn': 'feed', hidden: true });
  const retroNote = el(doc, 'p', { class: 'sn-retro-note', 'data-sn': 'retro-note', hidden: true, text: fill(SN.badge.retroNote, { liveFrom: zagrebDateTime(ctx.manifest.serviceLiveFromSec * 1000) }) });
  const badgeCard = el(doc, 'section', { class: 'st-card sn-card sn-card-badge', 'aria-labelledby': 'sn-badge-h' },
    el(doc, 'h3', { id: 'sn-badge-h', text: SN.badge.label }),
    el(doc, 'p', { class: 'sn-badge-line' }, badgeWord, ' ', retroMark),
    counts, holds, feedLine, retroNote);

  const zetBody = el(doc, 'div', { class: 'sn-card-body', 'data-sn': 'zet' });
  const zetCard = el(doc, 'section', { class: 'st-card sn-card sn-card-zet', 'aria-labelledby': 'sn-zet-h' }, el(doc, 'h3', { id: 'sn-zet-h', text: SN.zet.title }), zetBody);
  const newsBody = el(doc, 'div', { class: 'sn-card-body', 'data-sn': 'news' });
  const newsCard = el(doc, 'section', { class: 'st-card sn-card sn-card-news', 'aria-labelledby': 'sn-news-h' }, el(doc, 'h3', { id: 'sn-news-h', text: SN.news.title }), newsBody);
  const markerBody = el(doc, 'div', { class: 'sn-card-body', 'data-sn': 'marker' });
  const markerCard = el(doc, 'section', { class: 'st-card sn-card sn-card-marker', 'aria-labelledby': 'sn-marker-h', hidden: true }, el(doc, 'h3', { id: 'sn-marker-h', text: SN.marker.title }), markerBody);
  const side = el(doc, 'aside', { class: 'sn-side' }, badgeCard, zetCard, newsCard, markerCard);

  const main = el(doc, 'div', { class: 'sn-stage-main' }, mapBox, controls, scrub, layersRow, status, reducedNote);
  const grid = el(doc, 'div', { class: 'sn-stage-grid', 'data-sn-lagano': ctx.lagano ? '1' : '0' }, main, side);
  root.replaceChildren(grid);
  root.setAttribute('tabindex', '-1');

  // ---- rendering --------------------------------------------------------------------------
  let shownMinute = -1;
  let shownDay = '';
  let shownTime = '';
  let shownNotice = -1;
  let shownArticle = '';
  let shownMarker = '';
  let shownBadge = '';

  function renderPlate(t: number): void {
    const day = zagrebDay(t);
    const time = zagrebClock(t);
    if (day !== shownDay) { shownDay = day; plateDay.textContent = day; }
    if (time !== shownTime) {
      shownTime = time;
      plateTime.textContent = time;
      plateTime.setAttribute('datetime', `${formatZagrebLocal(t)}+02:00`);
      root.dataset.snAt = formatZagrebLocal(t);
    }
  }

  function renderScrubber(t: number): void {
    // The whole minute the clock is in, as the plate shows it: the value and its text come from the same instant.
    const minute = Math.min(minutes, Math.floor((t - start) / MINUTE_MS));
    if (minute === shownMinute) return;
    shownMinute = minute;
    const at = start + minute * MINUTE_MS;
    if (!scrubbing) range.value = String(minute);
    range.setAttribute('aria-valuetext', fill(SN.stage.valueText, { day: zagrebDay(at), time: zagrebClock(at) }));
  }

  function renderBadge(t: number): void {
    const atSec = t / 1000;
    const i = minuteIndex(series.t0, series.n, atSec);
    const state = series.service.state[i] ?? 'unknown';
    const seen = series.seen.all[i];
    const expected = series.expected.all[i];
    const since = series.service.since[i];
    const entities = series.feed.entities[i];
    const headerAge = series.feed.headerAgeS[i];
    const retro = atSec < ctx.manifest.serviceLiveFromSec;
    // A chunk is missing either because the recording has a hole or because ZET sent no new frame (its data did not
    // change, or it sent none with a vehicle): only the first is "Bez snimke"; in the second the state stays the
    // word and the feed line says what ZET did (Tue 29 Sep 06:28 to 07:56 on the real data).
    const zetQuiet = entities === 0 || (headerAge !== null && headerAge !== undefined && headerAge >= FROZEN_AFTER_S);
    const missing = motion === 'missing' && !zetQuiet;
    const loading = !motionSettled && motion !== 'idle';
    const key = [i, state, seen, expected, since, entities, headerAge, retro, missing, loading].join('|');
    if (key === shownBadge) return;
    shownBadge = key;
    const word = missing ? SN.badge.missing : loading ? SN.badge.loading : SN.badge[state];
    badgeWord.textContent = word;
    badgeWord.dataset.tone = missing || loading ? 'info' : TONE[state];
    badgeWord.dataset.state = missing ? 'missing' : loading ? 'loading' : state;
    retroMark.hidden = !retro;
    retroNote.hidden = !retro;
    if (missing || seen === null) {
      counts.hidden = true;
      counts.textContent = '';
    } else {
      counts.hidden = false;
      counts.textContent = expected === null ? fill(SN.badge.countsNoExpected, { seen: num(seen) }) : fill(SN.badge.counts, { seen: num(seen), expected: num(expected) });
    }
    if (since === null || t - since * 1000 < 0) {
      holds.hidden = true;
      holds.textContent = '';
    } else {
      holds.hidden = false;
      holds.textContent = fill(SN.badge.holds, { duration: duration(t - since * 1000) });
    }
    if (entities === 0) {
      feedLine.hidden = false;
      feedLine.textContent = SN.feed.empty;
    } else if (headerAge !== null && headerAge >= FROZEN_AFTER_S) {
      feedLine.hidden = false;
      feedLine.textContent = fill(SN.feed.frozen, { time: zagrebClock(t - headerAge * 1000) });
    } else {
      feedLine.hidden = true;
      feedLine.textContent = '';
    }
    if (laganoSeen) laganoSeen.textContent = seen === null ? SN.strip.noValue : num(seen);
    if (laganoExpected) laganoExpected.textContent = expected === null ? '' : `${SN.strip.fleetExpected} ${num(expected)}`;
  }

  /** A time beside a card: the clock alone on the replay's own day, the day and the clock otherwise. */
  const whenText = (sec: number, t: number): string => (zagrebMidnight(sec * 1000) === zagrebMidnight(t) ? zagrebClock(sec * 1000) : zagrebDateTime(sec * 1000));

  function renderCards(t: number): void {
    const atSec = Math.floor(t / 1000);
    const notice = notices ? currentNotice(notices, atSec) : null;
    const noticeKey = notice ? notice.id : notices ? 0 : -1;
    if (noticeKey !== shownNotice) {
      shownNotice = noticeKey;
      if (!notice) zetBody.replaceChildren(el(doc, 'p', { class: 'sn-none', text: SN.zet.none }));
      else {
        zetBody.replaceChildren(...present(
          el(doc, 'p', { class: 'sn-card-title', text: notice.title }),
          notice.text ? el(doc, 'p', { class: 'st-card-text', text: notice.text }) : null,
          el(doc, 'p', { class: 'sn-card-meta' }, el(doc, 'time', { datetime: `${formatZagrebLocal(notice.pubSec * 1000)}+02:00`, text: whenText(notice.pubSec, t) }), ' · ', externalLink(doc, notice.link, SN.zet.source)),
        ));
      }
    }
    const article = news ? currentArticle(news, atSec) : null;
    const articleKey = article ? article.item.id : news ? '' : '-';
    if (articleKey !== shownArticle) {
      shownArticle = articleKey;
      if (!article) newsBody.replaceChildren(el(doc, 'p', { class: 'sn-none', text: SN.news.none }));
      else {
        newsBody.replaceChildren(
          el(doc, 'p', { class: 'sn-card-meta', text: fill(SN.news.meta, { outlet: article.outlet, time: whenText(article.item.pubSec, t) }) }),
          el(doc, 'p', { class: 'sn-card-title' }, externalLink(doc, article.item.link, article.item.title, 'sn-headline')),
        );
      }
    }
    const marker = currentMarker(ctx.events, atSec);
    const markerKey = marker ? marker.id : '';
    if (markerKey !== shownMarker) {
      shownMarker = markerKey;
      markerCard.hidden = !marker;
      if (marker) {
        const sources = el(doc, 'p', { class: 'sn-card-meta' }, el(doc, 'time', { datetime: `${formatZagrebLocal(marker.atSec * 1000)}+02:00`, text: whenText(marker.atSec, t) }));
        for (const source of marker.sources) sources.append(' · ', externalLink(doc, source.url, source.label));
        markerBody.replaceChildren(...present(
          el(doc, 'p', { class: 'sn-card-title', text: marker.title }),
          marker.text ? el(doc, 'p', { class: 'st-card-text', text: marker.text }) : null,
          sources,
        ));
      } else markerBody.replaceChildren();
    }
  }

  function renderControls(): void {
    const playing = clock.playing();
    playButton.textContent = playing ? SN.controls.pause : SN.controls.play;
    playButton.dataset.playing = playing ? '1' : '0';
    const speed = clock.speed();
    for (const [s, button] of speedButtons) button.setAttribute('aria-pressed', s === speed ? 'true' : 'false');
    if (speedSelect.value !== String(speed)) speedSelect.value = String(speed);
    speedNote.hidden = ctx.lagano || speed !== 3600 || !layers.get().vehicles;
  }

  function renderLayers(): void {
    const current = layers.get();
    for (const key of Object.keys(chipFor) as (keyof Layers)[]) chipFor[key].setAttribute('aria-pressed', current[key] ? 'true' : 'false');
    compareNote.hidden = !current.compare;
    speedNote.hidden = ctx.lagano || clock.speed() !== 3600 || !current.vehicles;
  }

  function renderStatus(reason: TickReason | 'init'): void {
    const t = clock.now();
    const where = { day: zagrebDay(t), time: zagrebClock(t) };
    let text: string;
    if (reason === 'end' || (!clock.playing() && t >= end && reason !== 'seek')) text = fill(SN.stage.end, where);
    else if (clock.playing()) text = fill(SN.stage.playing, { speed: SN.speedAria[clock.speed()] });
    else text = fill(SN.stage.paused, where);
    if (status.textContent !== text) status.textContent = text;
  }

  function frame(t: number): void {
    if (disposed) return;
    renderPlate(t);
    renderScrubber(t);
    renderBadge(t);
    renderCards(t);
  }

  const offFrames = frames.subscribe(frame);
  const offTick = clock.onTick((_, reason) => {
    renderControls();
    if (reason !== 'suspend' && reason !== 'resume') renderStatus(reason);
  });
  const offLayers = layers.onChange(() => { renderLayers(); });

  // ---- the keyboard map (brief section 8) ----------------------------------------------------
  const SPEED_KEYS: Record<string, Speed> = { Digit1: 1, Digit2: 60, Digit3: 600, Digit4: 3600, Numpad1: 1, Numpad2: 60, Numpad3: 600, Numpad4: 3600 };
  function onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName ?? '';
    // The range, the select and any text field keep their own keys.
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
    switch (event.code) {
      case 'Space':
        if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return; // the control's own activation
        if (!clock.playing() && clock.now() >= end) clock.seek(start);
        clock.toggle();
        break;
      case 'KeyJ': clock.prevChapter(); break;
      case 'KeyL': clock.nextChapter(); break;
      case 'Comma': clock.step(-(event.shiftKey ? 10 : 1) * MINUTE_MS); break;
      case 'Period': clock.step((event.shiftKey ? 10 : 1) * MINUTE_MS); break;
      default: {
        const speed = SPEED_KEYS[event.code];
        if (speed === undefined || event.shiftKey) return;
        clock.setSpeed(speed);
      }
    }
    event.preventDefault();
  }
  root.addEventListener('keydown', onKey);

  // ---- the map ---------------------------------------------------------------------------------
  let unmountMap: (() => void) | null = null;
  if (mapHost) {
    const host = mapHost;
    void import('./map-layer').then(({ mountMapLayer }) => {
      if (disposed) return;
      unmountMap = mountMapLayer(ctx, host, {
        onMotion: (state) => {
          motion = state;
          if (state === 'ready' || state === 'missing') motionSettled = true;
          renderBadge(clock.now());
        },
      });
    }, () => {
      // The map library did not load (an old browser, a blocked chunk): the stage keeps its clock, its numbers and its cards.
      motionSettled = true;
      host.dataset.mapStatus = 'unavailable';
      renderBadge(clock.now());
    });
  }

  // ---- the voices' files ------------------------------------------------------------------------
  void ctx.data.get(ctx.manifest.files.notices, decodeNotices).then((file) => { if (!disposed) { notices = file; renderCards(clock.now()); } }, () => {});
  void ctx.data.get(ctx.manifest.files.news, decodeNews).then((file) => { if (!disposed) { news = file; renderCards(clock.now()); } }, () => {});

  renderControls();
  renderLayers();
  renderStatus('init');
  frame(clock.now());
  root.removeAttribute('aria-busy');

  return () => {
    disposed = true;
    root.removeEventListener('keydown', onKey);
    offLayers();
    offTick();
    offFrames();
    unmountMap?.();
    unmountMap = null;
  };
};

