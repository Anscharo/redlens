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
  it("keeps every added and changed doc with nothing stored", () => {
    expect(sorted(filterPreviewDocs(diff(), []))).toEqual(["e1", "n1", "n2", "r1", "t1"]);
  });

  it("Edited includes doc-number-only changes", () => {
    expect(sorted(filterPreviewDocs(diff(), ["edited"]))).toEqual(["e1", "r1", "t1"]);
  });

  it("no-renumbered removes doc-number-only changes from whatever else is kept", () => {
    expect(sorted(filterPreviewDocs(diff(), ["no-renumbered"]))).toEqual(["e1", "n1", "n2", "t1"]);
    expect(sorted(filterPreviewDocs(diff(), ["edited", "no-renumbered"]))).toEqual(["e1", "t1"]);
  });

  it("ANDs across groups", () => {
    expect(sorted(filterPreviewDocs(diff(), ["new", "reused-slot"]))).toEqual(["n2"]);
  });

  it("a flag alone narrows the full changed set", () => {
    expect(sorted(filterPreviewDocs(diff(), ["identity-swap"]))).toEqual(["e1"]);
  });
});

describe("old bundles without renumberedOnly", () => {
  const old = diff({ renumberedOnly: undefined });
  it("cannot hide renumber-only docs, and storing it removes nothing", () => {
    expect(PREVIEW_FILTERS.find((f) => f.id === "no-renumbered")!.ids(old)).toBeNull();
    expect(filterPreviewDocs(old, ["no-renumbered"]).size).toBe(5);
    expect(presetAvailable(PREVIEW_FILTER_PRESETS[0], old)).toBe(true);
  });
});

describe("describeFilters", () => {
  it("names a matching preset, else the stored filters", () => {
    expect(describeFilters([])).toBe("Changed only");
    expect(describeFilters(["new", "retitled"])).toBe("New · Retitled");
    expect(describeFilters(["no-renumbered"])).toBe("Changed only · No renumbers");
    expect(describeFilters(["edited", "no-renumbered"])).toBe("Edited · No renumbers");
  });
});
