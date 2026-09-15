// Feature flags (plan D7). No flag mechanism exists in the worker (no `vars`
// block by design, `keep_vars: true`), so flags are one static, frozen
// object: a tile producer behind a flag that is off returns no tiles ("tile
// absent"), and a module is registered in the worker in the same commit that
// turns its flag on, so nothing is ever polled that does not exist. A flag
// flips in a commit, never at runtime.
export const FLAGS = Object.freeze({
  /** The nearest bike-share station's free bikes: producer and fixtures ship in T3.2, on when the source is confirmed (docs/izvori.md). */
  FEED_BIKES: false,
  /** The nearest garage's free places: as above. */
  FEED_PARKING: false,
  /** The kvart's next waste pickup: as above. */
  FEED_WASTE: false,
  /** The last departure from the screen's stop, from GTFS static on disk: T3.1 turns it on with the producer. */
  FEED_LASTRUN: false,
  /** Web push for the bell: off; the notify sheet offers its toggles as "istakni" highlights and says so. */
  PUSH: false,
});
export type Flag = keyof typeof FLAGS;
