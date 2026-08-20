// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

let selectedOnly = false;
let ids = new Set<string>();

vi.mock("./selection", () => ({
  useSelection: () => ({ selectedOnly, ids }),
}));

import { useSelectionSet } from "./selectionFilter";

afterEach(() => {
  cleanup();
  selectedOnly = false;
  ids = new Set();
});

describe("useSelectionSet", () => {
  it("returns null (show everything) when selectedOnly is off, regardless of ids", () => {
    selectedOnly = false;
    ids = new Set(["a", "b"]);
    const { result } = renderHook(() => useSelectionSet());
    expect(result.current).toBeNull();
  });

  it("returns null when selectedOnly is on but the selection is empty", () => {
    selectedOnly = true;
    ids = new Set();
    const { result } = renderHook(() => useSelectionSet());
    expect(result.current).toBeNull();
  });

  it("returns the id set when selectedOnly is on and non-empty", () => {
    selectedOnly = true;
    ids = new Set(["a", "b"]);
    const { result } = renderHook(() => useSelectionSet());
    expect(result.current).toEqual(new Set(["a", "b"]));
  });
});
