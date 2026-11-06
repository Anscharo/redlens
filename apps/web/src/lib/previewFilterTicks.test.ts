import { describe, expect, it } from "vitest";
import type { PreviewDiff } from "./previewDiff";
import { isLastTicked, tickedFilters, toggleFilter } from "./previewFilterTicks";
import { filterPreviewDocs } from "./previewFilters";

function diff(over: Partial<PreviewDiff> = {}): PreviewDiff {
  return {
    added: new Set(["n1"]),
    changed: new Set(["e1", "r1"]),
    renumbered: { r1: ["A.1", "A.2"] },
    renumberedOnly: new Set(["r1"]),
    retitled: { e1: ["Old", "New"] },
    reusedSlot: {},
    identitySwap: {},
    formerUuid: {},
    ...over,
  };
}

describe("change kinds are exhaustive", () => {
  it("New + Edited + Renumbered only is every change", () => {
    expect(filterPreviewDocs(diff(), ["new", "edited", "renumbered"])).toEqual(filterPreviewDocs(diff(), []));
  });

  it("Changed only shows every kind ticked, and no flag", () => {
    expect(tickedFilters([])).toEqual(["new", "edited", "renumbered"]);
    expect(tickedFilters(["identity-swap"])).toEqual(["new", "edited", "renumbered", "identity-swap"]);
  });

  it("unticking a kind from Changed only stores the rest", () => {
    expect(toggleFilter([], "renumbered", false, diff())).toEqual(["new", "edited"]);
  });

  it("ticking the last missing kind back stores Changed only", () => {
    expect(toggleFilter(["new", "edited"], "renumbered", true, diff())).toEqual([]);
  });

  it("flags toggle on their own", () => {
    expect(toggleFilter([], "retitled", true, diff())).toEqual(["retitled"]);
    expect(toggleFilter(["new", "retitled"], "retitled", false, diff())).toEqual(["new"]);
  });

  it("locks the last ticked kind", () => {
    expect(isLastTicked("new", ["new"], diff())).toBe(true);
    expect(isLastTicked("new", [], diff())).toBe(false);
    expect(isLastTicked("retitled", ["retitled"], diff())).toBe(false);
  });

  it("on a bundle without renumberedOnly, New is the only kind it can untick, so it is locked", () => {
    const old = diff({ renumberedOnly: undefined });
    expect(isLastTicked("new", [], old)).toBe(true);
  });
});
