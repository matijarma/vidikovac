// The stage of /snimka/: the composition root of the instrument (plan
// section 3). Lane V3 owns this file and replaces the composition; this is
// V0's skeleton so that V2's map and V4's feed are visible in the page before
// V3 lands. It renders the five slots of STAGE_SLOTS in DOM order (plain
// blocks, no grid), mounts the map (map-layer.ts through one dynamic import,
// never on the entry graph), the voices feed and the subtitle by their
// contract names, and keeps the v1 controls (play, speed, scrubber) with the
// clock plate inside the timeline slot so the clock can be driven meanwhile.
import { SPEEDS, type Speed } from '../../../shared/snimka';
import type { TickReason } from './clock';
import type { Mount } from './context';
import { STAGE_SLOTS, type StageMap, type StageSlot } from './contracts';
import { formatZagrebLocal, zagrebClock, zagrebDay } from './format';
import { SN, fill } from './strings';
import { mountSubtitle } from './subtitle';
import { mountVoicesFeed } from './voices-feed';

const MINUTE_MS = 60_000;

export const mountStage: Mount = (ctx, root) => {
  const { clock, frames, doc } = ctx;
  const start = clock.start;
  const end = clock.end;
  const minutes = Math.round((end - start) / MINUTE_MS);
  let disposed = false;
  let scrubbing = false;

  const stage = doc.createElement('div');
  stage.className = 'sn-stage-root';
  stage.dataset.snStage = '';
  const slots = {} as Record<StageSlot, HTMLDivElement>;
  for (const name of STAGE_SLOTS) {
    const slot = doc.createElement('div');
    slot.className = `sn-slot sn-slot-${name}`;
    slot.dataset.snSlot = name;
    slots[name] = slot;
    stage.append(slot);
  }
  root.replaceChildren(stage);
  root.setAttribute('tabindex', '-1');

  // ---- the map slot: the host the map lane draws into, with the clock plate over it --------
  const mapHost = doc.createElement('div');
  mapHost.className = 'sn-map';
  mapHost.id = 'sn-map';
  mapHost.dataset.sn = 'map';
  const plateDay = doc.createElement('span');
  plateDay.className = 'sn-plate-day';
  const plateTime = doc.createElement('time');
  plateTime.className = 'sn-plate-time';
  const plate = doc.createElement('div');
  plate.className = 'sn-plate';
  plate.append(plateDay, plateTime);
  const mapBox = doc.createElement('div');
  mapBox.className = 'sn-map-box';
  if (ctx.lagano) {
    const note = doc.createElement('p');
    note.className = 'st-note sn-lagano-note';
    note.dataset.sn = 'lagano';
    note.textContent = SN.stage.laganoNote;
    mapBox.append(note, plate);
  } else mapBox.append(mapHost, plate);
  slots.map.append(mapBox);

  // ---- the timeline slot: the v1 controls -------------------------------------------------------
  const playButton = doc.createElement('button');
  playButton.type = 'button';
  playButton.className = 'btn sn-play';
  playButton.dataset.sn = 'play';
  playButton.addEventListener('click', () => {
    if (!clock.playing() && clock.now() >= end) clock.seek(start);
    clock.toggle();
  });
  const speedSelect = doc.createElement('select');
  speedSelect.className = 'sn-speed-select';
  speedSelect.dataset.sn = 'speed-select';
  speedSelect.setAttribute('aria-label', SN.controls.speed);
  for (const speed of SPEEDS) {
    const option = doc.createElement('option');
    option.value = String(speed);
    option.textContent = SN.speed[speed];
    speedSelect.append(option);
  }
  speedSelect.addEventListener('change', () => {
    const next = SPEEDS.find((s) => String(s) === speedSelect.value) as Speed | undefined;
    if (next) clock.setSpeed(next);
  });
  const range = doc.createElement('input');
  range.type = 'range';
  range.className = 'sn-range';
  range.min = '0';
  range.max = String(minutes);
  range.step = '1';
  range.dataset.sn = 'scrubber';
  range.setAttribute('aria-label', SN.stage.scrubber);
  range.addEventListener('input', () => {
    scrubbing = true;
    clock.pause();
    clock.seek(start + Number(range.value) * MINUTE_MS);
  });
  range.addEventListener('change', () => { scrubbing = false; });
  range.addEventListener('blur', () => { scrubbing = false; });
  const status = doc.createElement('p');
  status.className = 'sn-status';
  status.dataset.sn = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const controls = doc.createElement('div');
  controls.className = 'sn-controls';
  controls.append(playButton, speedSelect);
  const scrub = doc.createElement('div');
  scrub.className = 'sn-scrub';
  scrub.append(range);
  slots.timeline.append(controls, scrub, status);
  if (ctx.reducedMotion) {
    const note = doc.createElement('p');
    note.className = 'st-note sn-reduced-note';
    note.textContent = SN.stage.reducedNote;
    slots.timeline.append(note);
  }

  // ---- rendering ----------------------------------------------------------------------------------
  let shownDay = '';
  let shownTime = '';
  let shownMinute = -1;

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
    const minute = Math.min(minutes, Math.floor((t - start) / MINUTE_MS));
    if (minute === shownMinute) return;
    shownMinute = minute;
    const at = start + minute * MINUTE_MS;
    if (!scrubbing) range.value = String(minute);
    range.setAttribute('aria-valuetext', fill(SN.stage.valueText, { day: zagrebDay(at), time: zagrebClock(at) }));
  }

  function renderControls(): void {
    const playing = clock.playing();
    playButton.textContent = playing ? SN.controls.pause : SN.controls.play;
    playButton.dataset.playing = playing ? '1' : '0';
    if (speedSelect.value !== String(clock.speed())) speedSelect.value = String(clock.speed());
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

  // ---- the lane mounts, by their contract names -----------------------------------------------------
  const unmountFeed = mountVoicesFeed(ctx, slots.voices);
  const subtitle = mountSubtitle(ctx, slots.subtitle);

  const offFrames = frames.subscribe((t) => {
    if (disposed) return;
    renderPlate(t);
    renderScrubber(t);
    subtitle.update(t);
  });
  const offTick = clock.onTick((_, reason) => {
    renderControls();
    if (reason !== 'suspend' && reason !== 'resume') renderStatus(reason);
  });

  let map: StageMap | null = null;
  if (!ctx.lagano) {
    void import('./map-layer').then(async ({ mountMapLayer }) => {
      if (disposed) return;
      const m = await mountMapLayer(ctx, mapHost);
      if (disposed) { m.destroy(); return; }
      map = m;
    }, () => {
      // The map library did not load (an old browser, a blocked chunk): the stage keeps its clock and its slots.
      mapHost.dataset.mapStatus = 'unavailable';
    });
  }

  renderControls();
  renderStatus('init');
  renderPlate(clock.now());
  renderScrubber(clock.now());
  root.removeAttribute('aria-busy');

  return () => {
    disposed = true;
    offTick();
    offFrames();
    subtitle.destroy();
    unmountFeed();
    map?.destroy();
    map = null;
  };
};
