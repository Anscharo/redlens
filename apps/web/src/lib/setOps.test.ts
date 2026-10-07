import { describe, expect, it } from "vitest";
import { added, addedAll, removed, toggled } from "./setOps";

describe("setOps", () => {
  it("added returns the same Set when the value is present", () => {
    const s = new Set(["a"]);
    expect(added(s, "a")).toBe(s);
    const next = added(s, "b");
    expect(next).not.toBe(s);
    expect([...next]).toEqual(["a", "b"]);
    expect([...s]).toEqual(["a"]);
  });

  it("removed returns the same Set when the value is absent", () => {
    const s = new Set(["a", "b"]);
    expect(removed(s, "z")).toBe(s);
    const next = removed(s, "a");
    expect([...next]).toEqual(["b"]);
    expect([...s]).toEqual(["a", "b"]);
  });

  it("toggled flips membership without mutating the input", () => {
    const s = new Set(["a"]);
    expect([...toggled(s, "b")]).toEqual(["a", "b"]);
    expect([...toggled(s, "a")]).toEqual([]);
    expect([...s]).toEqual(["a"]);
  });

  it("addedAll returns the same Set when nothing is new", () => {
    const s = new Set(["a", "b"]);
    expect(addedAll(s, ["a", "b"])).toBe(s);
    expect(addedAll(s, [])).toBe(s);
    const next = addedAll(s, ["b", "c", "d", "c"]);
    expect([...next]).toEqual(["a", "b", "c", "d"]);
    expect([...s]).toEqual(["a", "b"]);
  });
});
