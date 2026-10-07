// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readInt, readJson, readString, writeJson, writeString } from "./safeStorage";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("safeStorage", () => {
  it("round-trips strings, ints and JSON", () => {
    expect(writeString("s", "hi")).toBe(true);
    expect(readString("s")).toBe("hi");
    writeString("n", "42px");
    expect(readInt("n")).toBe(42);
    expect(writeJson("j", { a: [1] })).toBe(true);
    expect(readJson<{ a: number[] }>("j")).toEqual({ a: [1] });
  });

  it("uses sessionStorage when asked", () => {
    writeJson("k", [1], "session");
    expect(sessionStorage.getItem("k")).toBe("[1]");
    expect(localStorage.getItem("k")).toBeNull();
    expect(readJson("k", "session")).toEqual([1]);
  });

  it("reads null for absent, empty, malformed or non-numeric values", () => {
    expect(readString("missing")).toBeNull();
    expect(readJson("missing")).toBeNull();
    localStorage.setItem("bad", "{oops");
    expect(readJson("bad")).toBeNull();
    expect(readInt("bad")).toBeNull();
    expect(readInt("missing")).toBeNull();
  });

  it("swallows storage failures", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(readString("k")).toBeNull();
    expect(readJson("k")).toBeNull();
    expect(readInt("k")).toBeNull();
    expect(writeString("k", "v")).toBe(false);
    expect(writeJson("k", 1)).toBe(false);
  });

  it("reports false for values JSON cannot serialise", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(writeJson("c", cyclic)).toBe(false);
  });
});
