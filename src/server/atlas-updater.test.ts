// Run under `bun test` (NOT vitest) — see vitest.config.ts exclude of src/server.
import { describe, it, expect } from "bun:test";
import { decide } from "./atlas-updater.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);

describe("decide", () => {
  it("builds on drift (upstream ≠ live, idle, not yet tried)", () => {
    expect(decide({ upstream: B, live: A, building: false, lastTried: null })).toBe("build");
  });

  it("idles when fresh (upstream === live)", () => {
    expect(decide({ upstream: A, live: A, building: false, lastTried: null })).toBe("idle");
  });

  it("idles while a build is already in flight", () => {
    expect(decide({ upstream: B, live: A, building: true, lastTried: null })).toBe("idle");
  });

  it("idles when upstream couldn't be read", () => {
    expect(decide({ upstream: null, live: A, building: false, lastTried: null })).toBe("idle");
  });

  it("idles when the target was already attempted but didn't advance (no infinite loop)", () => {
    expect(decide({ upstream: B, live: A, building: false, lastTried: B })).toBe("idle");
  });

  it("re-builds once upstream moves past a stuck target", () => {
    const C = "c".repeat(40);
    expect(decide({ upstream: C, live: A, building: false, lastTried: B })).toBe("build");
  });
});
