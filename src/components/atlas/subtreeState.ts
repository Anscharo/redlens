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

// Alt-click: go the OTHER way. From the middle that means the rung a plain
// click would not have gone to; from either end there is no "other step", so it
// swings clear across to the far end instead of stalling.
//   0 → 2: skip titles-only, straight to bodies.
//   1 → 0 when a plain click would have gone to 2, and 1 → 2 when it would have
//        gone to 0 — the reversal the user reaches for after over-swinging.
//   2 → 0: hide the whole branch in one click.
// `dir` is only consulted at level 1 (see nextRung) and every result here is 0
// or 2, so the returned direction is inert — kept at +1 to match DEFAULT_RUNG.
export function reverseRung(cur: Rung): Rung {
  if (cur.level === 0) return { level: 2, dir: 1 };
  if (cur.level === 2) return { level: 0, dir: 1 };
  // level === 1 — the mirror of nextRung's branch.
  return cur.dir === 1 ? { level: 0, dir: 1 } : { level: 2, dir: 1 };
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
 *  it leans 45° toward wherever the next click will actually land. `flat`
 *  selects the flatNextRung swing (see below) for views where 0 is invisible. */
export function rungHoverAngle(cur: Rung, flat = false): number {
  const next = flat ? flatNextRung(cur) : nextRung(cur);
  return (rungAngle(cur.level) + rungAngle(next.level)) / 2;
}

/** Same idea for the alt-click swing: while Alt is held the chevron must lean
 *  toward where THAT click lands, not the plain one — otherwise the preview
 *  lies. Always a different angle from rungHoverAngle, since reverseRung never
 *  agrees with nextRung. */
export function rungReverseHoverAngle(cur: Rung, flat = false): number {
  const next = flat ? flatReverseRung(cur) : reverseRung(cur);
  return (rungAngle(cur.level) + rungAngle(next.level)) / 2;
}

// The flat filtered views (selected-only / changed-only, AtlasReader's
// filterSet branch) never hide a row for rung 0 — visibility there comes
// purely from the filter set, never from rung (see AtlasReader.test.tsx
// "filtered view ignores collapse state") — so a chevron that swings up to
// "hidden" looks like a dead click: the row is still right there. These
// wrap the ordinary swings to skip 0 in both directions, leaving a plain
// closed (titles) / open (bodies) toggle. `cur.level === 0` is first treated
// as 1 (its display stand-in — see flatRung) since 0 has no chevron glyph of
// its own here either.

/** `cur.level === 0` has no meaning in a flat view (see above) — read it as
 *  its display stand-in, rung 1, instead. */
export function flatRung(cur: Rung): Rung {
  return cur.level === 0 ? { level: 1, dir: 1 } : cur;
}

export function flatNextRung(cur: Rung): Rung {
  const c = flatRung(cur);
  const next = nextRung(c);
  if (next.level !== 0) return next;
  return c.level === 2 ? { level: 1, dir: 1 } : { level: 2, dir: 1 };
}

export function flatReverseRung(cur: Rung): Rung {
  const c = flatRung(cur);
  const next = reverseRung(c);
  if (next.level !== 0) return next;
  return c.level === 2 ? { level: 1, dir: 1 } : { level: 2, dir: 1 };
}
