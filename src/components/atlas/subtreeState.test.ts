import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNG,
  nextRung,
  reverseRung,
  flatRung,
  flatNextRung,
  flatReverseRung,
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

// Flat filtered views (selected-only/changed-only) never hide a row for rung
// 0 — visibility there comes purely from the filter set (see AtlasReader's
// filterSet branch) — so a swing that lands on (or leans toward) 0 there looks
// like a dead click. These wrap the ordinary swings to stay within {1, 2}.
describe("flatRung", () => {
  it("reads level 0 as its display stand-in, rung 1", () => {
    expect(flatRung({ level: 0, dir: 1 })).toEqual({ level: 1, dir: 1 });
    expect(flatRung({ level: 0, dir: -1 })).toEqual({ level: 1, dir: 1 });
  });

  it("leaves 1 and 2 untouched", () => {
    expect(flatRung({ level: 1, dir: 1 })).toEqual({ level: 1, dir: 1 });
    expect(flatRung({ level: 1, dir: -1 })).toEqual({ level: 1, dir: -1 });
    expect(flatRung({ level: 2, dir: 1 })).toEqual({ level: 2, dir: 1 });
  });
});

describe("flatNextRung / flatReverseRung", () => {
  it("never produces level 0, for any input the ordinary swings can reach", () => {
    for (const level of [0, 1, 2] as const) {
      for (const dir of [1, -1] as const) {
        const cur = { level, dir };
        expect(flatNextRung(cur).level).not.toBe(0);
        expect(flatReverseRung(cur).level).not.toBe(0);
      }
    }
  });

  it("toggles cleanly between closed (1) and open (2), starting from untouched (0)", () => {
    let r: Rung = DEFAULT_RUNG; // real rung 0 — never touched
    const levels: number[] = [];
    for (let i = 0; i < 5; i++) {
      r = flatNextRung(r);
      levels.push(r.level);
    }
    expect(levels).toEqual([2, 1, 2, 1, 2]);
  });

  it("alt-click (reverse) lands on the same target a plain click would — there's no third position left to be the 'other way'", () => {
    for (const level of [0, 1, 2] as const) {
      for (const dir of [1, -1] as const) {
        const cur = { level, dir };
        expect(flatReverseRung(cur).level).toBe(flatNextRung(cur).level);
      }
    }
  });
});

describe("rungHoverAngle / rungReverseHoverAngle with flat=true", () => {
  it("never leans toward 'hidden' (-90deg), even from the state that would naturally swing there", () => {
    // { level: 1, dir: -1 } is the one state where the ordinary swing (plain
    // AND reverse) lands on 0 — exactly the case the non-flat angle tests
    // above show leaning to -45deg.
    const cur = { level: 1, dir: -1 } as const;
    expect(rungHoverAngle(cur, true)).toBe(45); // leans toward open (90deg), not hidden
    expect(rungReverseHoverAngle(cur, true)).toBe(45);
  });

  it("matches the non-flat angle wherever the ordinary swing already avoids 0", () => {
    const cur = { level: 2, dir: 1 } as const;
    expect(rungHoverAngle(cur, true)).toBe(rungHoverAngle(cur, false));
  });
});
