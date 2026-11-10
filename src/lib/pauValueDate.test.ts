// When the atlas wrote a value: the newest edit whose diff adds it, an edit
// without a diff as possibly the one, whole-value matching, and the fallback.
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./history.ts";
import { valueChangedAt } from "./pauValueDate.ts";

const edit = (date: string, diff?: HistoryEntry["diff"]): HistoryEntry => ({ date, commitHash: date, changeType: "modified", changeKind: "semantic", ...(diff ? { diff } : {}) });

describe("valueChangedAt", () => {
  it("takes the newest edit that wrote the stated value, passing over edits that left it alone", () => {
    const entries = [
      edit("2026-10-20", [["-", "| maxAmount | 5,000,000 USDC |"], ["+", "| maxAmount | 10,000,000 USDC |"]]),
      edit("2026-11-01", [["~", [["=", "Some "], ["-", "old"], ["+", "new"], ["=", " prose"]]]]),
    ];
    expect(valueChangedAt(entries, "10,000,000 USDC")).toBe("2026-10-20");
  });
  it("reads a word-level line on its new side, and an edit without a diff as possibly the one", () => {
    expect(valueChangedAt([edit("2026-10-20", [["~", [["=", "maxAmount "], ["-", "5"], ["+", "10"], ["=", ",000,000 USDC"]]]])], "10,000,000 USDC")).toBe("2026-10-20");
    expect(valueChangedAt([edit("2026-10-21")], "10,000,000 USDC")).toBe("2026-10-21");
  });
  it("matches the value whole, so 0 is not found inside 20,000,000", () => {
    const entries = [edit("2026-10-20", [["-", "| maxAmount | 10,000,000 |"], ["+", "| maxAmount | 20,000,000 |"]]), edit("2026-09-01", [["-", "| maxAmount | 5 |"], ["+", "| maxAmount | 0 |"]])];
    expect(valueChangedAt(entries, "0")).toBe("2026-09-01");
  });
  it("falls back to the last content change when no diff writes the value, ignoring cosmetic edits and moves", () => {
    expect(valueChangedAt([edit("2026-10-20", [["+", "something else"]])], "10,000,000 USDC")).toBe("2026-10-20");
    expect(valueChangedAt([{ ...edit("2026-10-20"), changeKind: "typo" }, { date: "2026-10-21", commitHash: "m", changeType: "moved" }], "x")).toBeNull();
  });
});
