// The interfaces between the lanes of the snimka v2 pass (plan of 2 October
// 2026, section 7). Types only, no DOM code: every lane builds against this
// file and never edits it silently (a change goes through the orchestrator).
//
// Who implements which name:
// - V2 (map and director): `mountMapLayer` in map-layer.ts (returns a StageMap),
//   `mountMinimaps` in minimap.ts, `bindDirector` in director.ts,
//   `subjectFromSelection` in subject.ts, `aliveStates`/`stopAliveSet`/`diffStates`
//   in live-network.ts, `routeSample`/`hourMeans` in route-series.ts.
// - V3 (instrument shell): `mountStage` in stage.ts (the composition root, owns
//   the layout and the STAGE_SLOTS), `createPanelDeck` in panels.ts, the panel
//   specs in readouts.ts and panel-depths.ts, timeline.ts, heatmap.ts,
//   presentation.ts.
// - V4 (voices and screen): `mountVoicesFeed` in voices-feed.ts (a MountPanel),
//   `mountSubtitle` in subtitle.ts (a MountSubtitle), `agendaPanel` in agenda.ts
//   (an AgendaPanel), `feedMarkers`/`stateBand` in voices.ts, `factChips` in
//   facts.ts, voice-data.ts, screen.ts.
// - V5 (dossier and open data): `mountReport` in report.ts with alternatives.ts,
//   open.ts, live.ts, reckoning.ts.
import type { Focus, RoutesFile, SeriesFile } from '../../../shared/snimka';
import type { SnimkaContext } from './context';

export type Subject = { kind: 'route'; id: string } | { kind: 'station'; id: string } | { kind: 'stop'; id: string };
/** v3: three panels (Stanje merged into Vozila, Linije into Mreža; Vrijeme and Poglavlja left the deck). */
export type PanelId = 'vozila' | 'mreza' | 'bicikli';
export interface ViewState { panel: PanelId | null; subject: Subject | null; following: boolean }
export type ViewReason = 'user' | 'director' | 'address' | 'chapter' | 'feed' | 'map';
export interface ViewStore { get(): ViewState; set(patch: Partial<ViewState>, reason?: ViewReason): void; onChange(fn: (state: ViewState, prev: ViewState, reason: ViewReason | undefined) => void): () => void }

/** The five slots of the stage, in DOM order. V3 owns the layout and must keep these names: V2 draws into `map`,
 *  V4 into `voices` and `subtitle`, the deck and the timeline are V3's. */
export const STAGE_SLOTS = ['map', 'deck', 'voices', 'subtitle', 'timeline'] as const;
export type StageSlot = (typeof STAGE_SLOTS)[number];

/** What the map lane (V2) hands the shell (V3). */
export interface StageMap {
  flyTo(focus: Focus, opts?: { reason?: ViewReason }): void;
  select(subject: Subject | null, opts?: { fit?: boolean }): void;
  camera(): { center: [number, number]; zoom: number };
  onUserMove(fn: () => void): () => void;
  vehicles(): { id: string; route: string | null; lonLat: [number, number] }[];
  liveCounts(): { alive: number; dead: number; quiet: number } | null;
  resize(): void;
  destroy(): void;
  /** v3 (W1, additive): what the chip row prints as legend (decision V3-11) and which foot line the map asks for;
   *  read per frame by the stage. Absent on a stub map. */
  legendCounts?(): LegendCounts;
}
/** v3: the map's legend numbers for the chip row. `vehicles` and `ghosts` are null when unknown ("bez podatka");
 *  `bikes` is 'missing' while the BAJS bytes are 255 (the foot line layers.bikesMissing); `compare` says why no
 *  ghost is drawn: 'sunday' (layers.compareSunday), 'gap' (layers.compareGap), 'speed' (at one hour per second,
 *  layers.noVehiclesAtSpeed), 'off' (the chip), 'loading'; 'ok' draws them. */
export interface LegendCounts { vehicles: number | null; ghosts: number | null; bikes: 'ok' | 'missing'; compare: 'ok' | 'sunday' | 'gap' | 'speed' | 'off' | 'loading' }
export type MountMapLayer = (ctx: SnimkaContext, host: HTMLElement) => Promise<StageMap>;
/** Two SVG minimaps (now and the comparison day) drawn by V2 into an element V3 provides. */
export type MountMinimaps = (ctx: SnimkaContext, host: HTMLElement, opts: { large: boolean }) => () => void;
/** The director (V2) is bound by the shell with the hooks it needs. */
export type BindDirector = (ctx: SnimkaContext, map: StageMap, hooks: { spot(id: PanelId | 'zaslon'): void }) => () => void;
/** One panel of the deck (V3 builds the deck; V3 and V4 supply specs). */
export interface PanelSpec {
  id: PanelId;
  title: string;
  mountFace(el: HTMLElement): (t: number) => void;           // returns the per-frame updater (textContent only)
  mountDepth(el: HTMLElement): Promise<() => void> | (() => void);   // builds the deep layer, returns its teardown
  spotTarget?: () => HTMLElement | null;                      // the datum the director pulses
}
export interface PanelDeck { expand(id: PanelId | null, reason?: ViewReason): void; expanded(): PanelId | null; spot(id: PanelId): void; destroy(): void }
export type MountPanel = (ctx: SnimkaContext, root: HTMLElement) => () => void;   // V4: mountVoicesFeed
export interface SubtitleHandle { update(t: number): void; destroy(): void }
export type MountSubtitle = (ctx: SnimkaContext, root: HTMLElement) => SubtitleHandle;   // V4: mountSubtitle
/** v3: the agenda left the deck (W3 turns it into the Poglavlja popover), so its spec carries its own id. */
export type AgendaPanel = (ctx: SnimkaContext, open: (chapterId: string) => void) => Omit<PanelSpec, 'id'> & { id: 'poglavlja' };   // V4
/** Marker lanes the shell draws on the timeline (V4 computes them). */
export interface TimelineMarker { atSec: number; lane: 'chapter' | 'notice' | 'press'; id: string; title: string }
export type SeriesLike = Pick<SeriesFile, 'service' | 'seen' | 'expected' | 't0' | 'step' | 'n'>;
export type RoutesLike = Pick<RoutesFile, 't0' | 'step' | 'n' | 'routes' | 'seen' | 'expected'>;
