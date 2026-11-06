import { describe, expect, it } from "vitest";
import type { PreviewDiff } from "./previewDiff";
import { describeFilters, filterPreviewDocs, presetAvailable, PREVIEW_FILTER_PRESETS, PREVIEW_FILTERS } from "./previewFilters";

function diff(over: Partial<PreviewDiff> = {}): PreviewDiff {
  return {
    added: new Set(["n1", "n2"]),
    changed: new Set(["e1", "r1", "t1"]),
    renumbered: { r1: ["A.1", "A.2"] },
    renumberedOnly: new Set(["r1"]),
    retitled: { t1: ["Old", "New"] },
    reusedSlot: { n2: {} },
    identitySwap: { e1: { oldTitle: "a", newTitle: "b" } },
    formerUuid: {},
    ...over,
  };
}

const sorted = (s: Set<string>) => [...s].sort();

describe("filterPreviewDocs", () => {
  it("keeps every added and changed doc with nothing ticked", () => {
    expect(sorted(filterPreviewDocs(diff(), []))).toEqual(["e1", "n1", "n2", "r1", "t1"]);
  });

  it("ORs filters within a group", () => {
    expect(sorted(filterPreviewDocs(diff(), ["new", "renumbered"]))).toEqual(["n1", "n2", "r1"]);
  });

  it("Edited leaves out renumber-only docs", () => {
    expect(sorted(filterPreviewDocs(diff(), ["edited"]))).toEqual(["e1", "t1"]);
  });

  it("ANDs across groups", () => {
    expect(sorted(filterPreviewDocs(diff(), ["new", "edited", "reused-slot"]))).toEqual(["n2"]);
  });

  it("a flag alone narrows the full changed set", () => {
    expect(sorted(filterPreviewDocs(diff(), ["identity-swap"]))).toEqual(["e1"]);
  });
});

describe("old bundles without renumberedOnly", () => {
  const old = diff({ renumberedOnly: undefined });
  it("cannot answer Edited or Renumbered only, but can answer Changed only", () => {
    expect(PREVIEW_FILTERS.find((f) => f.id === "edited")!.ids(old)).toBeNull();
    expect(PREVIEW_FILTERS.find((f) => f.id === "renumbered")!.ids(old)).toBeNull();
    expect(presetAvailable(PREVIEW_FILTER_PRESETS[0], old)).toBe(true);
  });
});

describe("describeFilters", () => {
  it("names a matching preset, else the ticked filters", () => {
    expect(describeFilters([])).toBe("Changed only");
    expect(describeFilters(["edited", "new"])).toBe("New · Edited");
    expect(describeFilters(["retitled", "new"])).toBe("New · Retitled");
  });
});
