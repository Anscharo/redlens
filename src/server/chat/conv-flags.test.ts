import { describe, expect, it } from "bun:test";
import { convFlags } from "./conv-flags.ts";

describe("convFlags", () => {
  it("raises a flag for its ttl and forgets it after", () => {
    const flags = convFlags(1_000);
    expect(flags.has("a", 0)).toBe(false);
    flags.set("a", 0);
    expect(flags.has("a", 999)).toBe(true);
    expect(flags.has("a", 1_000)).toBe(false);
    // Reading an expired flag drops it rather than leaving it to the sweep.
    expect(flags.size).toBe(0);
  });

  it("clears on demand", () => {
    const flags = convFlags(1_000);
    flags.set("a", 0);
    flags.clear("a");
    expect(flags.has("a", 1)).toBe(false);
  });

  it("re-raising extends the deadline", () => {
    const flags = convFlags(1_000);
    flags.set("a", 0);
    flags.set("a", 900);
    expect(flags.has("a", 1_500)).toBe(true);
    expect(flags.size).toBe(1);
  });

  it("sweeps expired entries on write, so an abandoned conversation cannot leak one", () => {
    const flags = convFlags(1_000);
    for (let i = 0; i < 50; i++) flags.set(`old-${i}`, 0);
    expect(flags.size).toBe(50);
    flags.set("new", 5_000);
    expect(flags.size).toBe(1);
    expect(flags.has("old-0", 5_000)).toBe(false);
  });

  it("evicts the oldest entry at the cap, so live flags stay bounded", () => {
    const flags = convFlags(1_000, 3);
    flags.set("a", 0);
    flags.set("b", 1);
    flags.set("c", 2);
    expect(flags.size).toBe(3);
    flags.set("d", 3);
    expect(flags.size).toBe(3);
    expect(flags.has("a", 3)).toBe(false);
    expect(flags.has("d", 3)).toBe(true);
  });
});
