// The ordering register's geometry (R-TE7, E3): where a vehicle sits on the
// rail graph, how one vehicle's arc reads in another's frame, and whether two
// vehicles are on the same rails at all. Both halves of the engine ask those
// questions -- the twin's law (laws.ts) of the plans it is about to publish,
// the client's integrator (app/src/motion/integrator.ts) of the marks it is
// about to draw -- so the answers live in one DOM-free module (R-TE15) that
// depends on nothing but the decoded network's `Path`.
//
// A path is a sequence of directed edges plus the arc each of them starts at;
// an arc is a distance along that sequence. Two paths that run the same edge
// run the same rails there, and an arc on one reads on the other as the same
// distance into that shared edge. Where the paths diverge there is no mapping
// at all, and null is the honest answer: a constraint that cannot be
// expressed in the other's frame is not a constraint.

import type { Path } from './network';

/** A vehicle placed on the graph: the path it runs, and its arc along it. */
export interface Placed {
  path: Path;
  /** Metres along `path`. */
  s: number;
}

/** The index within `path.edges` of the edge under arc `s`. The integrator's
 *  neighbourhood index needs the index, not only the edge: a pair of marks a
 *  tram length apart is on one edge or the next, and the next is a step in
 *  this sequence, not a search over the whole graph. */
export function edgeIndexAt(path: Path, s: number): number {
  let k = 0;
  while (k + 1 < path.edges.length && path.offsets[k + 1] <= s) k++;
  return k;
}

/** The edge under arc s of a path, and the arc within that edge. */
export function edgeAt(path: Path, s: number): { edge: number; arc: number } {
  const k = edgeIndexAt(path, s);
  return { edge: path.edges[k], arc: s - path.offsets[k] };
}

/** Arc `s` of `from` expressed on `to`, or null when `to` does not run the
 *  edge `from` is on at that arc (the two have diverged). */
export function mapArc(from: Path, s: number, to: Path): number | null {
  const { edge, arc } = edgeAt(from, s);
  const k = to.edges.indexOf(edge);
  if (k < 0) return null;
  return to.offsets[k] + arc;
}

/** The pairing test the law and the integrator share: two vehicles are on the
 *  same rails when either one's current edge lies on the other's path. It is
 *  deliberately one-sided-or-the-other: a tram that has just turned off a
 *  shared trunk is still ordered against the one behind it on the trunk,
 *  because the trunk is on its own path even though its edge no longer is. */
export function onSharedRails(a: Placed, b: Placed): boolean {
  return b.path.edges.includes(edgeAt(a.path, a.s).edge) || a.path.edges.includes(edgeAt(b.path, b.s).edge);
}

/**
 * The stretch of rails the two have in common ahead of `a`: the run of edges
 * beginning at the edge `a`'s arc is on that `b`'s path also runs, in the
 * same order, following `a`'s path forward until the paths diverge. Null when
 * `b`'s path does not run `a`'s current edge at all -- then the two share no
 * rails where `a` stands, whatever they may share elsewhere.
 *
 * This is the key a relation is filed under (E3): keying it to the leader's
 * current edge instead drops the relation every time either of them crosses
 * one of the metre-long edges a noded junction leaves behind, and a relation
 * that has to be established afresh at every junction is no relation at all.
 */
export function sharedStretch(a: Placed, b: Placed): { edges: number[] } | null {
  const edges: number[] = [];
  let after = -1;
  for (let k = edgeIndexAt(a.path, a.s); k < a.path.edges.length; k++) {
    const edge = a.path.edges[k];
    // From `after + 1`, so the run is one b also traverses in a's order: a
    // path that meets the same rails again later meets them going somewhere
    // else, and that is a different stretch.
    const j = b.path.edges.indexOf(edge, after + 1);
    if (j < 0) break;
    edges.push(edge);
    after = j;
  }
  return edges.length > 0 ? { edges } : null;
}
