// Types for scripts/observe-production.mjs, so the unit tier (test/scripts/observe-production.test.ts) is
// type-checked against the observer's real exports. The implementation is the .mjs; keep the two in step.
import type { Page } from '@playwright/test';
import type * as Wall from '../e2e/wall';
import type * as Inventory from '../e2e/inventory';
import type * as Recorders from '../e2e/recorders';
import type * as Legibility from '../e2e/legibility';
import type * as Scenes from '../e2e/scenes';
import type * as Lib from '../e2e/lib';

export type Surface = 'kiosk' | 'phone' | 'desktop';
export type Stage = 'd1' | 'd2' | 'd3';
export type StageChoice = Stage | 'full';

export const DEFAULT_MINUTES: number;
export const MAX_MINUTES: number;
/** The 1-minute host load above which the observer refuses to start (exit 2); `--max-load N|off` moves or drops it. */
export const MAX_HOST_LOAD: number;
export const SURFACES: readonly Surface[];
export const STAGES: readonly Stage[];
export const STAGE_ALL: 'full';
export const REDEMPTIONS_PER_SURFACE: number;
export const REDEMPTION_SPACING_MS: number;
export const REDEMPTION_MARGIN_MS: number;
export const USER_AGENT_SUFFIX: string;
export const REPEAT_WINDOW_MS: number;
export const AXE_TAGS: readonly string[];
export const INVITATION_TIMEOUT_MS: number;
/** The wall's settle waits (the accept spec's): the map census, then the first vehicle pill. Waits, never gates. */
export const CENSUS_TIMEOUT_MS: number;
export const VEHICLES_TIMEOUT_MS: number;
/** How long after the twin first reports vehicles a reading may still show no pill. */
export const PILLS_DRAW_GRACE_MS: number;
export const SESSION_TIMEOUT_MS: number;
export const CODE_TIMEOUT_MS: number;
export const CODE_MIN_PROGRESS: number;
export const KARTA_POLL_MS: number;
export const SHARE_TIMEOUT_MS: number;
export const STOP_BOARD_TIMEOUT_MS: number;
export const SESSION_MINUTES: number;
export const SESSION_LENGTH_MS: number;
export const EXPIRY_MARGIN_MS: number;
export const AFTER_EXPIRY_MS: number;
export const OUTAGE_FEEDS: readonly string[];
/** The wall's data-feed before its first poll has answered: no outage, and no vehicle to draw yet. */
export const LOADING_FEED: string;
export const CODE_TESTIDS: readonly string[];
export const PAIRING_PROBES: Readonly<{ codeA: string; codeB: string; link: string; progress: string }>;
export const SESSION_LIVE: string;
export const ABORTED: string;
export const USAGE: string;

export class ObserverRefusal extends Error {
  constructor(message: string, exitCode?: number);
  exitCode: number;
}
export class KioskUnavailable extends Error {}

export interface ObserverArgs { minutes: number; surfaces: Surface[]; stage: StageChoice; out: string | null; maxLoad: number | null; help: boolean }
export function parseArgs(argv: readonly string[]): ObserverArgs;
export interface KioskTarget { kioskUrl: string; origin: string; beaconId: string; secrets: string[] }
export function kioskFromEnv(env: Record<string, string | undefined>): KioskTarget;
export function outDirFor(out: string | null, root: string, stamp: string): string;
export function stampOf(date: Date): string;
export interface ObserverConfig extends ObserverArgs, KioskTarget { root: string; startedAt: string; outDir: string; hostLoad?: number | null }
export function configFrom(input: { argv: readonly string[]; env: Record<string, string | undefined>; root?: string; now?: Date }): ObserverConfig;

export interface Scrubber { (text: unknown): string; noteCode(code: unknown): void }
export function makeScrubber(secrets?: readonly string[]): Scrubber;

export interface RedemptionBudget {
  waitMs(surface: Surface, now: number): number;
  take(surface: Surface, now: number): void;
  /** An /api/scan answer at `at`: confirms the redemption unless it has already failed (then it is late). Whether it confirmed. */
  redeemed(surface: Surface, at: number): boolean;
  /** No /api/scan answer came by `at`: the redemption failed for good. */
  failed(surface: Surface, at: number): void;
  /** The failed redemption's page was left at `at`, or leaving it failed with `cancelError`. */
  settle(surface: Surface, at: number, cancelError?: string | null): void;
  counts(): Record<string, number>;
  /** Confirmed redemptions: the answers, in the order they came. */
  times(): { surface: Surface; at: number }[];
  failures(): { surface: Surface; at: number; cancelError?: string }[];
  lates(): { surface: Surface; at: number }[];
}
export function redemptionBudget(options?: { perSurface?: number; spacingMs?: number }): RedemptionBudget;

type InPage<A, R> = (spec: A) => R;
export const INVITATION_READY_IN_PAGE: InPage<{ invitation: string; code: string; shown: { source: string; flags: string } }, boolean>;
export const MAP_SETTLED_IN_PAGE: InPage<{ map: string; pending: string[] }, boolean>;
export const MAP_CENSUS_IN_PAGE: InPage<{ map: string }, boolean>;
export const PILLS_DRAWN_IN_PAGE: InPage<{ map: string }, boolean>;
export const ANY_PRESENT_IN_PAGE: InPage<{ selectors: string[] }, boolean>;
export const PAIRING_IN_PAGE: InPage<typeof PAIRING_PROBES, { code: string; href: string; progress: number }>;
export interface PhoneRead {
  place: string | null;
  sentence: string | null;
  sentenceChars: number;
  departures: { total: number; inViewport: number };
  slop: string[];
  tabs: string[];
  shareCity: { present: boolean; visible: boolean; text: string };
}
export interface KartaRead { status: string | null; pills: string | null; bodies: number | null; unlabelled: number | null; markers: number | null; disclosures: number; pillsAfterMs?: number | null; fleet?: FleetState | null }
/** One zet-rt snapshot as a data response carried it: its status, the moving vehicles (`vehicle:` ids) and the teaser's fleet count. */
export interface Fleet { status: string | null; pins: number; fleet: number | null }
/** A snapshot a page received, stamped on the observer's clock. */
export interface FleetRecord extends Fleet { at: number }
/** What a page held at a moment: its latest snapshot, and since when the run of snapshots with vehicles it belongs to began. */
export interface FleetState extends FleetRecord { since: number }
export function fleetOf(path: string, body: unknown): Fleet | null;
export function fleetAt(records: readonly FleetRecord[], at: number): FleetState | null;
export function watchFleet(page: Pick<ObserverPage, 'on'>, ctx: { instruments: Pick<Instruments, 'recorders'>; now(): number }): FleetRecord[];
/** A wall reading as the observer keeps it: the twin's report at its moment beside it. */
export type ObservedSample = Wall.WallSample & { fleet?: FleetState | null };
export function pillsOwed(sample: ObservedSample): boolean;
export interface DesktopRead { sadaInViewport: boolean; kartaInViewport: boolean; domains: number; shareCityVisible: boolean }
export const PHONE_READ_IN_PAGE: InPage<Record<string, unknown>, PhoneRead>;
export const KARTA_READ_IN_PAGE: InPage<{ map: string; disclosures: string }, KartaRead>;
export const DESKTOP_READ_IN_PAGE: InPage<{ sada: string; karta: string; domains: string; shareCity: string }, DesktopRead>;
export interface ShareCodeRead { present: boolean; visible: boolean; text: string }
export const SHARE_CODE_IN_PAGE: InPage<{ code: string }, ShareCodeRead>;
export interface StopBoardRead { open: boolean; total: number; inViewport: number; texts: string[] }
export const STOP_BOARD_READ_IN_PAGE: InPage<{ board: string; rows: string }, StopBoardRead>;
/** One element's `data-skipped-text`, by its data-testid (`kiosk` the root, `nearby` the timeline). */
export interface SkippedTextEntry { surface: string; value: string }
export interface SkippedTextSurface { surface: string; count: number | null; reasons: Record<string, number>; raw?: string }
/** A reading's census: `total` null when no surface wrote a count; `error` when the page could not answer. */
export interface SkippedTextReading { total: number | null; surfaces: SkippedTextSurface[]; error?: string }
export const SKIPPED_TEXT_SPEC: Readonly<{ selector: string }>;
export const SKIPPED_TEXT_IN_PAGE: InPage<{ selector: string }, SkippedTextEntry[]>;
export function parseSkippedText(value: string | null | undefined): Omit<SkippedTextSurface, 'surface'>;
export function skippedTextOf(entries: readonly SkippedTextEntry[]): SkippedTextReading;
export function readSkippedText(page: Pick<ObserverPage, 'evaluate'>): Promise<SkippedTextReading>;
export interface SkippedTextSummary {
  readings: number;
  withCensus: number;
  withSkip: number;
  /** The counts summed over the readings (a row left out in consecutive readings counts in each). */
  total: number;
  max: number | null;
  maxReading: number | null;
  maxSurfaces: { surface: string; count: number | null }[];
  bySurface: Record<string, number>;
  reasons: Record<string, number>;
  /** The readings (`n`) with a count above 0. */
  flagged: number[];
  errors: number;
}
export function summariseSkippedText(rotation: readonly ObservedRotationRow[]): SkippedTextSummary;
export const EXPIRY_KEY: string;
export const EXPIRY_WATCH_IN_PAGE: InPage<{ ended: string; key: string }, boolean>;
export const EXPIRY_STAMP_IN_PAGE: InPage<{ ended: string; key: string }, number | null>;

/** The TypeScript modules the observer loads through Vite (the unit tier imports them directly). */
export interface Instruments {
  wall: typeof Wall;
  inventory: typeof Inventory;
  recorders: typeof Recorders;
  legibility: typeof Legibility;
  scenes: typeof Scenes;
  lib: typeof Lib;
}

export interface ViewportEntry {
  label: string;
  surface: string | null;
  scenario: string | null;
  at?: string;
  zagreb?: string;
  units: number;
  counts: Record<Inventory.InventoryClass, number>;
  perClass: Inventory.InventorySummary['perClass'];
  coveredHeightShare: number;
  unclassified: string[];
  asideDisclaimers: string[];
  failures: string[];
}
export interface AxeResult { seriousCritical: number; rules: string[] }
export interface ShareObservation { tapped: boolean; code: boolean; afterMs: number | null; detail: string | null }
export interface StopBoardObservation extends StopBoardRead { taps: number; query: string; error: string | null }
export interface ExpiryObservation { seen: boolean; stamped: boolean; boundary: 'stamp' | 'estimate'; afterRedemptionMs: number; ended: Inventory.ExpiryReading; later: Inventory.ExpiryReading; requestsAfter: string[] }
export interface PhoneObservation {
  landingMs: number | null;
  sada: PhoneRead | null;
  share: ShareObservation | null;
  karta: (KartaRead & { pillsAfterMs: number | null; fleet: FleetState | null }) | null;
  stopBoard: StopBoardObservation | null;
  expiry: ExpiryObservation | null;
  axe: { sada: AxeResult | null; karta: AxeResult | null };
  viewports: ViewportEntry[];
  failed?: string;
}
export interface DesktopObservation { landingMs: number | null; read: DesktopRead | null; viewports: ViewportEntry[]; failed?: string }
/** A rotation reading as the observer records it: the wall's reading and the validator's census beside it. */
export type ObservedRotationRow = Wall.RotationRow & { skippedText?: SkippedTextReading; fleet?: FleetState | null };
export interface CalmWindow { from: number; to: number; reading?: Wall.CalmMotionReading; error?: string }
export interface KioskObservation {
  first: ObservedSample | null;
  portrait: ObservedSample | null;
  rotation: ObservedRotationRow[];
  /** Calm motion over each minute of the rotation. */
  calm: CalmWindow[];
  viewports: ViewportEntry[];
  legibility: Record<string, Legibility.LegibilityReport | null>;
  proxy: string | null;
}
export interface RecorderSnapshot extends Recorders.RecorderReport { surface: Surface; problems: string[]; aborted: number; scanTimes: string[] }
export interface Observation {
  meta: { origin: string; startedAt: string; endedAt: string | null; minutes: number; stage: StageChoice; surfaces: Surface[]; health: unknown; userAgentSuffix: string; hostLoad: { start: number | null; end: number | null; max: number | null } };
  kiosk: KioskObservation | null;
  phone: PhoneObservation | null;
  desktop: DesktopObservation | null;
  recorders: RecorderSnapshot[];
  inventories: Inventory.FirstViewport[];
  captures: string[];
  errors: { phase: string; error: string }[];
  notes: string[];
  /** Confirmed redemptions (their /api/scan answers) and failed ones (no answer, the scan cancelled). */
  redemptions: { confirmed: { surface: Surface; at: number }[]; failed: { surface: Surface; at: number; cancelError?: string }[]; late: { surface: Surface; at: number }[] };
}
export function newObservation(config: ObserverConfig, health: unknown): Observation;
export function newPhone(): PhoneObservation;
export function newDesktop(): DesktopObservation;

export interface Threshold { id: string; stage: Stage; surface: Surface | 'all'; metric: string; min?: number; max?: number; target: string; source: string }
export const THRESHOLDS: readonly Threshold[];
export function stageIndex(stage: StageChoice): number;
export function thresholdsFor(stage: StageChoice): Threshold[];
export function fillTarget(text: string, instruments: Pick<Instruments, 'wall' | 'inventory' | 'legibility' | 'scenes'>): string;
export interface Measure { value: number | null; detail: string[] }
export const METRICS: Readonly<Record<string, (obs: Observation, instruments: Instruments) => Measure>>;
export function readingsOf(obs: Observation): ObservedSample[] | null;
/** The rotation's planned readings for `minutes`, one every `stepMs`. */
export function plannedRotationSteps(minutes: number, stepMs: number): number;
export interface DistinctWindow { from: number; to: number; required: number; distinct: number }
export function distinctPerWindow(rotation: readonly (Wall.WallSample | Wall.WallSampleError | Wall.RotationRow)[], planned: number, stepMs: number, windowMs: number, min: number): { windows: DistinctWindow[]; short: number };
/** A sentence turn per fact (e2e/wall.ts sentenceTurns) as report.md reads it. */
export interface SentenceDwell {
  at: string; sentence: string; fact: string; dwellMs: number | null; dwellMinMs: number; dwellMaxMs: number | null;
  gapBeforeMs: number | null; gapAfterMs: number | null; refreshes: number; expired: boolean; truncated: boolean;
}
export function repeatsWithin(readings: readonly Wall.WallSample[], windowMs: number, wall: Pick<typeof Wall, 'sentenceTurns'>): {
  turns: number; refreshes: number; distinct: number; repeats: { at: string; afterMs: number; sentence: string }[];
  short: SentenceDwell[]; dwells: SentenceDwell[]; factSource: Wall.SentenceTurns['factSource'];
};
export type RowStatus = 'pass' | 'fail' | 'info' | 'not observed';
export interface VerdictRow extends Omit<Threshold, 'target'> { target: string; value: number | null; holds: boolean; detail: string[]; status: RowStatus }
export interface Verdict { stage: StageChoice; rows: VerdictRow[]; failures: VerdictRow[]; applied: number; ok: boolean }
export function judge(observation: Observation, instruments: Instruments, stage?: StageChoice): Verdict;
export function renderReport(observation: Observation, verdict: Verdict, instruments: Instruments): string;
export function writeOutputs(outDir: string, observation: Observation, verdict: Verdict, instruments: Instruments, scrub: Scrubber): void;

/** The page surface the observer drives; Playwright's Page satisfies it and the unit tier fakes it. */
export type ObserverPage = Pick<Page, 'goto' | 'evaluate' | 'waitForFunction' | 'waitForTimeout' | 'screenshot' | 'click' | 'fill' | 'on'> & { clock: Pick<Page['clock'], 'runFor'>; keyboard: Pick<Page['keyboard'], 'press'> };
export interface ObserverBrowser {
  newContext(options?: Record<string, unknown>): Promise<{ newPage(): Promise<ObserverPage>; close(): Promise<void> }>;
  close(): Promise<void>;
}
export interface Runtime {
  instruments: Instruments;
  chromium: { launch(options?: Record<string, unknown>): Promise<ObserverBrowser> };
  devices: Record<string, { userAgent: string } & Record<string, unknown>>;
  AxeBuilder?: new (options: { page: ObserverPage }) => { withTags(tags: string[]): { analyze(): Promise<{ violations: { id: string; impact?: string | null; nodes: unknown[] }[] }> } };
  fetch?: (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
}
export interface RunOptions { log?: (line: string) => void; error?: (line: string) => void; clock?: { now(): number; sleep(ms: number): Promise<void> }; hostLoad?: (() => number) | null }
export function run(config: ObserverConfig, runtime: Runtime, options?: RunOptions): Promise<number>;
export function loadRuntime(root?: string): Promise<Runtime>;
export function main(options?: { argv?: readonly string[]; env?: Record<string, string | undefined>; root?: string; log?: (line: string) => void; error?: (line: string) => void; load?: (root: string) => Promise<Runtime>; hostLoad?: () => number }): Promise<number>;
