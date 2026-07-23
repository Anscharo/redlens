// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("./atlasBase", () => ({
  liveAtlasBase: () => "/api/atlas/mockedsha/",
}));

import { DataSourceContext, useDataSource, DEFAULT_SOURCE, type DataSource } from "./dataSource";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useDataSource", () => {
  it("returns DEFAULT_SOURCE (built from liveAtlasBase) when no Provider is present", () => {
    const { result } = renderHook(() => useDataSource());
    expect(result.current).toBe(DEFAULT_SOURCE);
    expect(result.current.base).toBe("/api/atlas/mockedsha/");
    expect(result.current.preview).toBeNull();
  });

  it("returns the value supplied by DataSourceContext.Provider", () => {
    const custom: DataSource = {
      base: "/api/preview/abc123/",
      preview: { id: "abc123", sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
    };
    const { result } = renderHook(() => useDataSource(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <DataSourceContext.Provider value={custom}>{children}</DataSourceContext.Provider>
      ),
    });
    expect(result.current).toEqual(custom);
    expect(result.current.preview?.id).toBe("abc123");
  });
});
