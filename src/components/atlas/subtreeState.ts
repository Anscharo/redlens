export type RungLevel = 0 | 1 | 2;
export type RungDir = 1 | -1;
export interface Rung {
  level: RungLevel;
  dir: RungDir;
}
export const DEFAULT_RUNG: Rung = { level: 0, dir: 1 };

// The reader's per-level pendulum: the » chevron discloses one level of
// immediate children at a time, swinging hidden → titles → titles+bodies →
// titles → hidden … rather than dumping (or hiding) a whole subtree at once.
//   0 → 1: always swings up, direction set to +1 (the ordinary forward step).
//   1 → 2: only if already swinging forward (dir === +1).
//   1 → 0: if swinging backward (dir === -1) — dir resets to +1 at the bottom
//          so the next click starts the climb again instead of re-descending.
//   2 → 1: always swings back down, direction set to -1.
export function nextRung(cur: Rung): Rung {
  if (cur.level === 0) return { level: 1, dir: 1 };
  if (cur.level === 2) return { level: 1, dir: -1 };
  // level === 1
  return cur.dir === 1 ? { level: 2, dir: 1 } : { level: 0, dir: 1 };
}

export function rungClass(level: RungLevel): string {
  if (level === 2) return "is-open";
  if (level === 0) return "is-hidden";
  return "";
}

export function rungAngle(level: RungLevel): number {
  if (level === 0) return -90;
  if (level === 2) return 90;
  return 0;
}

/** Midpoint between this rung's angle and the next one's — the hover preview:
 *  it leans 45° toward wherever the next click will actually land. */
export function rungHoverAngle(cur: Rung): number {
  return (rungAngle(cur.level) + rungAngle(nextRung(cur).level)) / 2;
}
