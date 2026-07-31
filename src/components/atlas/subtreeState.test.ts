import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNG,
  nextRung,
  rungAngle,
  rungClass,
  rungHoverAngle,
  type Rung,
} from "./subtreeState";

describe("nextRung", () => {
  it("swings through the full pendulum: 0→1→2→1→0→1, dir resetting at the bottom", () => {
    let r: Rung = DEFAULT_RUNG;
    const levels: number[] = [];
    for (let i = 0; i < 5; i++) {
      r = nextRung(r);
      levels.push(r.level);
    }
    // Not 0→1→2→1→0→(back up to 2, wrapping) — the pendulum swings back down
    // to 1 again after hitting bottom, same as the very first step.
    expect(levels).toEqual([1, 2, 1, 0, 1]);
  });

  it.each([
    [{ level: 0, dir: 1 }, { level: 1, dir: 1 }],
    // dir is irrelevant at level 0 — always swings up with dir reset to +1.
    [{ level: 0, dir: -1 }, { level: 1, dir: 1 }],
    [{ level: 1, dir: 1 }, { level: 2, dir: 1 }],
    [{ level: 1, dir: -1 }, { level: 0, dir: 1 }],
    [{ level: 2, dir: 1 }, { level: 1, dir: -1 }],
    // dir is irrelevant at level 2 — always swings back down with dir set to -1.
    [{ level: 2, dir: -1 }, { level: 1, dir: -1 }],
  ] as const)("nextRung(%o) -> %o", (input, expected) => {
    expect(nextRung(input)).toEqual(expected);
  });
});

describe("rungClass", () => {
  it.each([
    [0, "is-hidden"],
    [1, ""],
    [2, "is-open"],
  ] as const)("level %d -> %j", (level, expected) => {
    expect(rungClass(level)).toBe(expected);
  });
});

describe("rungAngle", () => {
  it.each([
    [0, -90],
    [1, 0],
    [2, 90],
  ] as const)("level %d -> %d deg", (level, expected) => {
    expect(rungAngle(level)).toBe(expected);
  });
});

describe("rungHoverAngle", () => {
  // Midpoint between the current angle and the next click's landing angle —
  // exact since every step is ±90°.
  it.each([
    [{ level: 0, dir: 1 } as const, -45],
    [{ level: 1, dir: 1 } as const, 45],
    [{ level: 1, dir: -1 } as const, -45],
    [{ level: 2, dir: 1 } as const, 45],
  ] as const)("rung %o -> %d deg", (cur, expected) => {
    expect(rungHoverAngle(cur)).toBe(expected);
  });
});
