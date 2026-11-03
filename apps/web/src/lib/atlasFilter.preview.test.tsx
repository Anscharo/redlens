// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PreviewDiff } from "./previewDiff";

// The preview diff as PreviewDiffProvider would hand it out, swapped per test.
let diff: Partial<PreviewDiff> = {};
vi.mock("./previewDiff", () => ({ usePreviewDiff: () => diff }));

import { AtlasFilterProvider, useFilterHides } from "./atlasFilter";
import { DataSourceContext } from "./dataSource";
import { PreviewViewProvider } from "./previewView";
import { SelectionProvider } from "./selection";
import { STORAGE_KEY } from "./selectionStore";
import { FilteredOutNotice } from "../components/atlas/FilteredOutNotice";

const PREVIEW = { base: "/api/preview/abc/", preview: { id: "pr-1", sha: "abc" } };

const wrapper = ({ children }: { children: ReactNode }) => (
  <DataSourceContext.Provider value={PREVIEW}>
    <PreviewViewProvider>
      <SelectionProvider>
        <AtlasFilterProvider>{children}</AtlasFilterProvider>
      </SelectionProvider>
    </PreviewViewProvider>
  </DataSourceContext.Provider>
);

const loaded = (added: string[], changed: string[]): Partial<PreviewDiff> => ({ added: new Set(added), changed: new Set(changed) });

beforeEach(() => {
  window.history.replaceState(null, "", "/atlas?id=chg&subset=changed");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useFilterHides in a preview's changed-only view", () => {
  it("hides docs the preview neither added nor changed", () => {
    diff = loaded(["new"], ["chg"]);
    const { result } = renderHook(() => useFilterHides(), { wrapper });
    expect(result.current("new")).toBe(false);
    expect(result.current("chg")).toBe(false);
    expect(result.current("same")).toBe(true);
  });

  it("hides nothing while the diff is still loading", () => {
    diff = { ...loaded([], []), pending: true };
    const { result } = renderHook(() => useFilterHides(), { wrapper });
    expect(result.current("chg")).toBe(false);
    const { queryByRole } = render(<FilteredOutNotice id="chg" />, { wrapper });
    expect(queryByRole("status")).toBeNull();
  });

  it("wins over a selection that leaves a changed doc out", () => {
    diff = loaded([], ["chg"]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ids: ["other"] }));
    const { result } = renderHook(() => useFilterHides(), { wrapper });
    expect(result.current("chg")).toBe(false);
    expect(result.current("other")).toBe(true);
  });
});
