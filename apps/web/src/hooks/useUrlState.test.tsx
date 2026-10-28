// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { useUrlPatch, useUrlState, urlString, urlInt, urlBool, urlEnum, urlEnumList, urlStringSet, urlTagged } from "./useUrlState";

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

  it("urlEnumList keeps only known members and drops the param when empty", () => {
    const { result } = renderHook(() => useUrlState("domain", urlEnumList(["peg", "alloc", "sc"] as const)), {
      wrapper: wrapperFor("/?domain=peg,bogus,sc"),
    });
    expect(result.current[0]).toEqual(["peg", "sc"]);
    act(() => result.current[1]([]));
    expect(result.current[0]).toEqual([]);
    // Empty list encodes to null, i.e. the param is dropped rather than left as "".
    expect(urlEnumList(["peg"] as const).encode([])).toBeNull();
  });

  it("urlTagged splits on the first dot only and rejects unknown kinds", () => {
    const codec = urlTagged(["facilitator", "executor", "agent"] as const);
    expect(codec.decode("facilitator.spark.ops")).toEqual({ kind: "facilitator", slug: "spark.ops" });
    expect(codec.decode("govops.spark")).toBeNull();
    expect(codec.decode("nodot")).toBeNull();
    expect(codec.decode(null)).toBeNull();
    expect(codec.encode({ kind: "agent", slug: "spark" })).toBe("agent.spark");
    expect(codec.encode(null)).toBeNull();
  });
});

describe("useUrlPatch", () => {
  const modeCodec = urlEnum("broad", ["broad", "phrase", "strict"] as const);

  it("changes several keys in one write, which two useUrlState setters cannot", () => {
    const { result } = renderHook(
      () => ({ q: useUrlState("q", urlString(null)), mode: useUrlState("mode", modeCodec), patch: useUrlPatch() }),
      { wrapper: wrapperFor("/?q=foo&mode=strict") },
    );
    // Two setters in one event: each starts from the same snapshot, so the
    // query write puts mode=strict back.
    act(() => {
      result.current.mode[1]("broad");
      result.current.q[1]("bar");
    });
    expect(result.current.q[0]).toBe("bar");
    expect(result.current.mode[0]).toBe("strict");
    // The patch sets one key, deletes the other and leaves the rest alone.
    act(() => result.current.patch({ q: "baz", mode: null }));
    expect(result.current.q[0]).toBe("baz");
    expect(result.current.mode[0]).toBe("broad");
  });
});

