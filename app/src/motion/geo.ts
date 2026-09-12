// A local metre-space plane and its inverse, for polyline projection and
// arc-length work (polyline.ts and the motion model built on it). Zagreb
// sits at ~45.8N; a single cos(lat) equirectangular factor around that
// latitude is accurate to a few centimetres across the whole city and
// needs no projection library. scripts/gtfs-shapes.mjs makes the same
// choice (same reference latitude, same radius) when it builds the
// network artefact this app later decodes, so both sides of the wire
// agree on what a metre is.

export interface XY {
  x: number;
  y: number;
}

const PROJECTION_LAT_DEG = 45.8;
const EARTH_RADIUS_M = 6378137; // WGS84 equatorial radius; good enough at city scale
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const COS_LAT0 = Math.cos(PROJECTION_LAT_DEG * DEG2RAD);

/**
 * Equirectangular projection about 45.8N onto a local metre plane. Only
 * differences between two points (distances, arc lengths, directions) are
 * meaningful -- the plane's origin sits at lon=0,lat=0, so a value only
 * means something when compared against another point run through this
 * same function (or decoded from the network artefact, which uses the
 * identical reference latitude and radius).
 */
export function toPlane(lon: number, lat: number): XY {
  return { x: lon * DEG2RAD * COS_LAT0 * EARTH_RADIUS_M, y: lat * DEG2RAD * EARTH_RADIUS_M };
}

/** Exact inverse of toPlane. */
export function toLonLat(p: XY): [number, number] {
  const lon = (p.x / (EARTH_RADIUS_M * COS_LAT0)) * RAD2DEG;
  const lat = (p.y / EARTH_RADIUS_M) * RAD2DEG;
  return [lon, lat];
}

/** Plain Euclidean distance in the plane, in metres. */
export function dist(a: XY, b: XY): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
