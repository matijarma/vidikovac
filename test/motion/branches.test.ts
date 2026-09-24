import { describe, expect, it } from 'vitest';
import { createBranchTable } from '../../shared/motion/branches';
import { straight, syntheticNetwork } from './synthetic-network';

// Rail round 2: where a line's rails branch, per path. The corridor is the
// diversion corridor of the matcher's tests: the own path runs the trunk
// east (edges 0, 1, 2); variant A turns north at x = 1500 (edges 0, 3),
// variant B runs east along y = 1200 (edge 4), variant C comes south at
// x = 2700 and rejoins the trunk (edges 5, 2). A loop of the line hangs off
// the trunk's end and counts for nothing.
describe('createBranchTable', () => {
  const net = syntheticNetwork({
    edges: [
      { from: 0, to: 1, pts: straight(0, 1500) },
      { from: 1, to: 2, pts: straight(1500, 2700) },
      { from: 2, to: 3, pts: straight(2700, 3900) },
      { from: 1, to: 4, pts: [{ x: 1500, y: 0 }, { x: 1500, y: 1200 }] },
      { from: 4, to: 5, pts: straight(1500, 2700, 1200) },
      { from: 5, to: 2, pts: [{ x: 2700, y: 1200 }, { x: 2700, y: 0 }] },
      { from: 3, to: 6, pts: [{ x: 3900, y: 0 }, { x: 3900, y: 100 }] },
      { from: 7, to: 8, pts: straight(0, 1500, 60) },
    ],
    routes: [
      { id: '11', type: 0, paths: [
        { id: 'own', direction: 0, edges: [0, 1, 2] },
        { id: 'variantA', direction: 0, edges: [0, 3] },
        { id: 'variantB', direction: 0, edges: [4] },
        { id: 'variantC', direction: 0, edges: [5, 2] },
        { id: 'loop:11:x', direction: -1, edges: [2, 6] },
      ] },
      { id: '12', type: 0, paths: [{ id: 'other', direction: 0, edges: [7] }] },
    ],
    stops: [],
  });
  const table = createBranchTable(net);
  const idx = (id: string) => net.paths.findIndex((p) => p.id === id);

  it('names the node where another rail of the line leaves, not the path\'s own next edge, nor its end', () => {
    expect(table.arcsOf(idx('own'))).toEqual([1500]); // variant A leaves at x = 1500; at x = 2700 only the own edge leaves
    expect(table.arcsOf(idx('variantA'))).toEqual([1500]); // the own path leaves where variant A turns; its end at (1500, 1200) is an end
    expect(table.arcsOf(idx('variantB'))).toEqual([]);
    expect(table.arcsOf(idx('variantC'))).toEqual([]); // at x = 2700 only edge 2 leaves the node
  });

  it('finds the next branch strictly ahead, and none past the last', () => {
    expect(table.aheadOf(idx('own'), 0)).toBe(1500);
    expect(table.aheadOf(idx('own'), 1499)).toBe(1500);
    expect(table.aheadOf(idx('own'), 1499.6)).toBeNull();
    expect(table.aheadOf(idx('own'), 2000)).toBeNull();
    expect(table.aheadOf(idx('variantB'), 0)).toBeNull();
  });

  it('counts no loop as a branch and branches no loop, and reads no other line', () => {
    expect(table.arcsOf(idx('loop:11:x'))).toEqual([]);
    // The trunk's end at x = 3900 is where the loop leaves: not a branch of the own path (its end), and the loop is no rail of the diversion.
    expect(table.aheadOf(idx('own'), 2800)).toBeNull();
    expect(table.arcsOf(idx('other'))).toEqual([]);
  });
});
