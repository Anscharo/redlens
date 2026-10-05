// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const searchRadar = vi.fn(() => [{ kind: "actor", label: "Actors", hits: [], total: 0 }]);
vi.mock("@/lib/radarSearch", () => ({
  getRadarSearchIndex: () => ({}),
  searchRadar: (...a: unknown[]) => searchRadar(...(a as [])),
}));

import { useRadarSearch } from "./useRadarSearch";

const GRAPH = {} as never;

describe("useRadarSearch", () => {
  it("returns null for a blank query without searching", () => {
    const { result } = renderHook(() => useRadarSearch(GRAPH, "  "));
    expect(result.current).toBeNull();
    expect(searchRadar).not.toHaveBeenCalled();
  });

  it("returns grouped results for a query", () => {
    const { result } = renderHook(() => useRadarSearch(GRAPH, "spark"));
    expect(result.current).toHaveLength(1);
  });
});
