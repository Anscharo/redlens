// @vitest-environment jsdom
// readOverrides() is the last line of defense against a tampered localStorage
// entry — ALLOWED_TOKEN_NAMES exists specifically so a compromised browser
// extension (or a stale schema from a previous release) can't inject arbitrary
// CSS custom properties into applyOverrides. Every branch here must fail
// closed to {} rather than throw or pass attacker-controlled data through.
import { describe, it, expect, afterEach, vi } from "vitest";
import { readOverrides, writeOverrides, clearOverrides, STORAGE_KEY, SCHEMA_VERSION } from "./palette-storage";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("readOverrides", () => {
  it("returns {} when nothing is stored", () => {
    expect(readOverrides()).toEqual({});
  });

  it("returns {} for unparseable JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readOverrides()).toEqual({});
  });

  it("returns {} for a schema version that doesn't match", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 2, values: { bg: "#111111" } }));
    expect(readOverrides()).toEqual({});
  });

  it("returns {} when v is missing entirely (pre-schema payload)", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ values: { bg: "#111111" } }));
    expect(readOverrides()).toEqual({});
  });

  it("returns {} when values is null", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, values: null }));
    expect(readOverrides()).toEqual({});
  });

  it("returns {} when values is a string instead of an object", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, values: "bg: red" }));
    expect(readOverrides()).toEqual({});
  });

  it("returns {} when values is a number instead of an object", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, values: 42 }));
    expect(readOverrides()).toEqual({});
  });

  it("drops keys that aren't in the token registry (an injected custom property)", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: SCHEMA_VERSION, values: { bg: "#111111", "not-a-real-token": "evil" } }),
    );
    expect(readOverrides()).toEqual({ bg: "#111111" });
  });

  it("drops non-string values even on an otherwise-known token name", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: SCHEMA_VERSION, values: { bg: "#111111", accent: 12345, tan: null } }),
    );
    expect(readOverrides()).toEqual({ bg: "#111111" });
  });

  it("returns {} when localStorage.getItem itself throws (private mode / quota errors)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readOverrides()).toEqual({});
  });
});

describe("writeOverrides / clearOverrides", () => {
  it("round-trips through readOverrides", () => {
    writeOverrides({ bg: "#222222", accent: "#c9a08a" });
    expect(readOverrides()).toEqual({ bg: "#222222", accent: "#c9a08a" });
  });

  it("stores the current schema version alongside the values", () => {
    writeOverrides({ bg: "#222222" });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual({ v: SCHEMA_VERSION, values: { bg: "#222222" } });
  });

  it("clearOverrides removes the key so readOverrides falls back to {}", () => {
    writeOverrides({ bg: "#222222" });
    clearOverrides();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readOverrides()).toEqual({});
  });
});
