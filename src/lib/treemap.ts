import type { ChunkNode } from "./anatomy";

// Squarified treemap (Bruls et al.): children sorted largest-first fill their
// parent's box with near-square rects, largest landing in the top-left —
// recursively, so every chunk's biggest sub-chunk sits in ITS top-left. Pure
// math, unit-space coordinates (percentages of the root square), no React.

export interface TreemapRect {
  node: ChunkNode;
  path: ChunkNode[]; // ancestors, root-first, excluding self
  depth: number;
  x: number; // all in 0–100 unit space of the ROOT square
  y: number;
  w: number;
  h: number;
  children: TreemapRect[];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Worst aspect ratio a row of areas would have, laid along a side of length `side`.
function worst(row: number[], side: number): number {
  const s = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
}

/** Lay `areas` (desc-sorted, summing to box area) into `box`; returns rects in input order. */
export function squarify(areas: number[], box: Box): Box[] {
  const out: Box[] = new Array(areas.length);
  let { x, y, w, h } = box;
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    // Grow the row while it improves (lowers) the worst aspect ratio.
    let row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) {
      row.push(areas[j]);
      j++;
    }
    const s = row.reduce((a, b) => a + b, 0);
    const thickness = side > 0 ? s / side : 0;
    // Fix the row as a strip along the shorter side.
    let offset = 0;
    for (let k = 0; k < row.length; k++) {
      const len = thickness > 0 ? row[k] / thickness : 0;
      out[i + k] =
        w <= h
          ? { x: x + offset, y, w: len, h: thickness }
          : { x, y: y + offset, w: thickness, h: len };
      offset += len;
    }
    if (w <= h) {
      y += thickness;
      h -= thickness;
    } else {
      x += thickness;
      w -= thickness;
    }
    i = j;
  }
  return out;
}

export interface TreemapOptions {
  /** Stop recursing below this rect area (unit² of the 100×100 root). */
  minArea: number;
  maxDepth: number;
  /** Inset applied inside a rect before laying out its children (unit space). */
  pad: number;
  /** Extra top inset reserving space for the rect's own label. */
  padTop: number;
}

export function buildTreemap(roots: ChunkNode[], opts: TreemapOptions): TreemapRect[] {
  const layout = (nodes: ChunkNode[], box: Box, depth: number, path: ChunkNode[]): TreemapRect[] => {
    const sorted = [...nodes].sort((a, b) => b.docs - a.docs).filter((n) => n.docs > 0);
    const total = sorted.reduce((s, n) => s + n.docs, 0);
    const boxArea = box.w * box.h;
    if (total === 0 || boxArea <= 0) return [];
    const boxes = squarify(sorted.map((n) => (n.docs / total) * boxArea), box);
    return sorted.map((node, i) => {
      const b = boxes[i];
      const inner: Box = {
        x: b.x + opts.pad,
        y: b.y + opts.padTop,
        w: b.w - opts.pad * 2,
        h: b.h - opts.padTop - opts.pad,
      };
      const recurse =
        depth + 1 < opts.maxDepth &&
        (node.children?.length ?? 0) > 0 &&
        b.w * b.h >= opts.minArea &&
        inner.w > 0 &&
        inner.h > 0;
      return {
        node,
        path,
        depth,
        ...b,
        children: recurse ? layout(node.children!, inner, depth + 1, [...path, node]) : [],
      };
    });
  };
  return layout(roots, { x: 0, y: 0, w: 100, h: 100 }, 0, []);
}
