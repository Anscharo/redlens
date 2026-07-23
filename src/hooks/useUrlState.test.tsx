// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { useUrlState, urlString, urlInt, urlBool, urlEnum, urlStringSet } from "./useUrlState";

afterEach(() => cleanup());

function wrapperFor(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: ReactNode }) => <Router hook={hook}>{children}</Router>;
}

describe("useUrlState codecs", () => {
  it("urlString decodes default and encodes changes", () => {
    const { result } = renderHook(() => useUrlState("q", urlString(null)), {
      wrapper: wrapperFor("/?q=hello"),
    });
    expect(result.current[0]).toBe("hello");
    act(() => result.current[1]("world"));
    expect(result.current[0]).toBe("world");
  });

  it("urlInt falls back to default on invalid input", () => {
    const { result } = renderHook(() => useUrlState("n", urlInt(40)), {
      wrapper: wrapperFor("/?n=abc"),
    });
    expect(result.current[0]).toBe(40);
    act(() => result.current[1](80));
    expect(result.current[0]).toBe(80);
  });

  it("urlBool round-trips", () => {
    const { result } = renderHook(() => useUrlState("open", urlBool(false)), {
      wrapper: wrapperFor("/"),
    });
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it("urlEnum rejects out-of-range values", () => {
    const { result } = renderHook(
      () => useUrlState("mode", urlEnum("broad", ["broad", "phrase", "strict"] as const)),
      { wrapper: wrapperFor("/?mode=nonsense") },
    );
    expect(result.current[0]).toBe("broad");
    act(() => result.current[1]("phrase"));
    expect(result.current[0]).toBe("phrase");
  });

  it("urlStringSet parses and updates a comma set, using a functional updater", () => {
    const { result } = renderHook(() => useUrlState("tags", urlStringSet()), {
      wrapper: wrapperFor("/?tags=a,b"),
    });
    expect(result.current[0]).toEqual(new Set(["a", "b"]));
    act(() => result.current[1]((prev) => new Set([...prev, "c"])));
    expect(result.current[0]).toEqual(new Set(["a", "b", "c"]));
  });
});
