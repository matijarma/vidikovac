// What the tap card says about one vehicle (T9): the line, the direction it
// is heading, and its route's median delay. Pure: a Drawn (the model's own
// estimate, never a reported fix -- R-P2), the network and the delay map
// in, three strings out. Direction is the terminus of the shape the model
// has the vehicle on -- what the headsign would say -- and reads "smjer
// nepoznat" whenever the model's heading is null, i.e. at a standstill or
// under the evidence threshold (decision 5), rather than being guessed.
import { routeName } from '../data/routes';
import type { I18n } from '../i18n/i18n';
import { delayWord } from '../layers/shared';
import type { XY } from './geo';
import type { Drawn } from './model';
import type { Network } from './network';

export interface VehicleCard {
  line: string;
  direction: string;
  delay: string;
}

const COMPASS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] as const;
export type CompassKey = (typeof COMPASS)[number];

/** Eight-point compass word key for a plane heading (x east, y north):
 *  the fallback when a heading is known but no shape terminus can name it
 *  (a free-plane vehicle, a shape with no stops in the artefact). */
export function compassKey(heading: XY): CompassKey {
  const angle = Math.atan2(heading.y, heading.x); // -pi..pi, 0 = east, counter-clockwise
  const sector = Math.round(angle / (Math.PI / 4)); // -4..4
  return COMPASS[(sector + 8) % 8];
}

/** The last stop along shape `shapeIdx` -- its terminus -- or null when the
 *  artefact associates no stop with that shape. */
function terminusName(net: Network, shapeIdx: number): string | null {
  let best: { name: string; s: number } | null = null;
  for (const stop of net.stops) {
    for (const on of stop.on) {
      if (on.shape === shapeIdx && (best === null || on.s > best.s)) best = { name: stop.name, s: on.s };
    }
  }
  return best?.name ?? null;
}

export function describeVehicle(i18n: I18n, net: Network, v: Drawn, delays: ReadonlyMap<string, number>): VehicleCard {
  const line = v.routeId !== undefined ? routeName(v.routeId) : i18n.t('motion.lineUnknown');

  let direction: string;
  if (!v.heading) {
    direction = i18n.t('motion.directionUnknown');
  } else {
    const terminus = v.onShape !== null ? terminusName(net, v.onShape) : null;
    direction = i18n.t('motion.direction', { towards: terminus ?? i18n.t(`motion.compass.${compassKey(v.heading)}`) });
  }

  const seconds = v.routeId !== undefined ? delays.get(v.routeId) : undefined;
  const delay = seconds === undefined ? i18n.t('motion.delayUnknown') : i18n.t('motion.delay', { word: delayWord(i18n, seconds) });

  return { line, direction, delay };
}
