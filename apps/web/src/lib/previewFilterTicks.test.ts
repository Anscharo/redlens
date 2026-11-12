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
    retyped: {},
    reusedSlot: {},
    identitySwap: {},
    formerUuid: {},
    ...over,
  };
}

describe("preview filter ticks", () => {
  it("New + Edited is every change", () => {
    expect(filterPreviewDocs(diff(), ["new", "edited"])).toEqual(filterPreviewDocs(diff(), []));
  });

  it("Changed only shows both kinds ticked, and no exclusion or flag", () => {
    expect(tickedFilters([])).toEqual(["new", "edited"]);
    expect(tickedFilters(["identity-swap"])).toEqual(["new", "edited", "identity-swap"]);
  });

  it("ticking Exclude › Renumber-only changes stores it; unticking clears it", () => {
    expect(toggleFilter([], "no-renumbered", true, diff())).toEqual(["no-renumbered"]);
    expect(toggleFilter(["no-renumbered"], "no-renumbered", false, diff())).toEqual([]);
    expect(tickedFilters(["no-renumbered"])).toEqual(["new", "edited", "no-renumbered"]);
  });

  it("unticking a kind stores the other; ticking it back stores Changed only", () => {
    expect(toggleFilter([], "new", false, diff())).toEqual(["edited"]);
    expect(toggleFilter(["edited"], "new", true, diff())).toEqual([]);
  });

  it("toggling a kind keeps an exclusion, and toggling a flag keeps the kinds", () => {
    expect(toggleFilter(["no-renumbered"], "new", false, diff())).toEqual(["edited", "no-renumbered"]);
    expect(toggleFilter(["edited"], "retitled", true, diff())).toEqual(["edited", "retitled"]);
  });

  it("locks the last ticked kind, never a flag", () => {
    expect(isLastTicked("edited", ["edited"], diff())).toBe(true);
    expect(isLastTicked("edited", [], diff())).toBe(false);
    expect(isLastTicked("no-renumbered", [], diff())).toBe(false);
  });
});
