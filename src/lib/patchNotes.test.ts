import { describe, it, expect } from "vitest";
import { parsePatchNotes, formatPatchDate } from "./patchNotes";

const SAMPLE = `<!-- a leading comment -->

## 2026-06-17
- New Stale Dates report

## 2026-06-16
- Moved history storage into the database
- Removed unneeded legacy code
- Added a background worker

## 2026-06-15
- Lightened colors
- Added depth indicators
`;

describe("parsePatchNotes", () => {
  it("returns ordered groups in file order (newest first)", () => {
    const groups = parsePatchNotes(SAMPLE, 99);
    expect(groups.map((g) => g.date)).toEqual([
      "2026-06-17",
      "2026-06-16",
      "2026-06-15",
    ]);
    expect(groups[1].items).toEqual([
      "Moved history storage into the database",
      "Removed unneeded legacy code",
      "Added a background worker",
    ]);
  });

  it("truncates to the first `limit` bullets across group boundaries", () => {
    const groups = parsePatchNotes(SAMPLE, 4);
    expect(groups.map((g) => g.date)).toEqual(["2026-06-17", "2026-06-16"]);
    // 1 from the first group + 3 from the second = 4 total; nothing from the third.
    expect(groups[0].items).toHaveLength(1);
    expect(groups[1].items).toHaveLength(3);
  });

  it("keeps only surviving bullets in a partially-consumed group", () => {
    const groups = parsePatchNotes(SAMPLE, 3);
    expect(groups.map((g) => g.date)).toEqual(["2026-06-17", "2026-06-16"]);
    expect(groups[1].items).toEqual([
      "Moved history storage into the database",
      "Removed unneeded legacy code",
    ]);
  });

  it("defaults to a limit of 7", () => {
    const groups = parsePatchNotes(SAMPLE);
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(6); // sample has only 6 bullets, all fit under 7
  });

  it("returns [] for empty input", () => {
    expect(parsePatchNotes("")).toEqual([]);
    expect(parsePatchNotes("   \n\n  ")).toEqual([]);
  });

  it("ignores comments and malformed lines", () => {
    const raw = `<!-- comment -->
## 2026-06-17
not a bullet
- a real bullet
### wrong heading level
-no space after dash
`;
    const groups = parsePatchNotes(raw, 99);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual(["a real bullet"]);
  });

  it("drops bullets that appear before any date heading", () => {
    const raw = `- orphan bullet
## 2026-06-17
- kept bullet
`;
    const groups = parsePatchNotes(raw, 99);
    expect(groups).toEqual([{ date: "2026-06-17", items: ["kept bullet"] }]);
  });
});

describe("formatPatchDate", () => {
  it("formats YYYY-MM-DD as a readable date, timezone-stable", () => {
    expect(formatPatchDate("2026-06-18")).toBe("Jun 18, 2026");
    expect(formatPatchDate("2026-01-01")).toBe("Jan 1, 2026");
  });
});
