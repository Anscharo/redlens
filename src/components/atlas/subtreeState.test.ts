import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNG,
  nextRung,
  reverseRung,
  rungAngle,
  rungClass,
  rungHoverAngle,
  rungReverseHoverAngle,
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

describe("reverseRung (shift-click)", () => {
  it.each([
    // From the middle: the rung a plain click would NOT have gone to.
    [{ level: 1, dir: 1 }, { level: 0, dir: 1 }],
    [{ level: 1, dir: -1 }, { level: 2, dir: 1 }],
    // From either end there is no "other step", so it crosses to the far end.
    [{ level: 0, dir: 1 }, { level: 2, dir: 1 }],
    [{ level: 0, dir: -1 }, { level: 2, dir: 1 }],
    [{ level: 2, dir: 1 }, { level: 0, dir: 1 }],
    [{ level: 2, dir: -1 }, { level: 0, dir: 1 }],
  ] as const)("reverseRung(%o) -> %o", (input, expected) => {
    expect(reverseRung(input)).toEqual(expected);
  });

  it("always lands somewhere a plain click would not have", () => {
    for (const level of [0, 1, 2] as const) {
      for (const dir of [1, -1] as const) {
        const cur = { level, dir };
        expect(reverseRung(cur).level).not.toBe(nextRung(cur).level);
      }
    }
  });

  it("undoes the swing it reversed: up → middle → shift → up", () => {
    const middle = nextRung(DEFAULT_RUNG); // 0 -> 1, dir +1
    expect(middle.level).toBe(1);
    expect(reverseRung(middle).level).toBe(0);
  });

  it("undoes the swing back too: down → middle → shift → down", () => {
    const middle = nextRung({ level: 2, dir: 1 }); // 2 -> 1, dir -1
    expect(middle.level).toBe(1);
    expect(reverseRung(middle).level).toBe(2);
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

// The chevron previews where the NEXT click lands. Alt-click reverses the
// swing, so while Alt is held the preview has to point somewhere else — if the
// two ever agreed, the modifier would look like it hadn't registered.
describe("rungReverseHoverAngle", () => {
  it.each([
    [{ level: 0, dir: 1 }, 0],    // -90 -> 90 (far end): midpoint 0
    [{ level: 1, dir: 1 }, -45],  // plain goes to 2, alt goes to 0
    [{ level: 1, dir: -1 }, 45],  // plain goes to 0, alt goes to 2
    [{ level: 2, dir: 1 }, 0],    // 90 -> -90 (far end): midpoint 0
  ] as const)("rung %o previews %ddeg under Alt", (cur, expected) => {
    expect(rungReverseHoverAngle(cur)).toBe(expected);
  });

  it("never previews the same angle as a plain hover", () => {
    for (const level of [0, 1, 2] as const) {
      for (const dir of [1, -1] as const) {
        const cur = { level, dir };
        expect(rungReverseHoverAngle(cur)).not.toBe(rungHoverAngle(cur));
      }
    }
  });
});
