// Run under `bun test` (NOT vitest) — see vitest.config.ts exclude of src/server.
import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  decide,
  backoffMs,
  nextDivergedSince,
  publishOutcome,
  shouldRetryPublish,
  dropStaleSearchIndex,
} from "./atlas-updater.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const T = 1_000_000; // arbitrary fixed "now"

describe("decide", () => {
  it("builds on drift (upstream ≠ live, idle, backoff elapsed)", () => {
    expect(decide({ upstream: B, live: A, building: false, now: T, nextAttemptAt: 0 })).toBe("build");
  });

  it("idles when fresh (upstream === live)", () => {
    expect(decide({ upstream: A, live: A, building: false, now: T, nextAttemptAt: 0 })).toBe("idle");
  });

  it("idles while a build is already in flight", () => {
    expect(decide({ upstream: B, live: A, building: true, now: T, nextAttemptAt: 0 })).toBe("idle");
  });

  it("idles when upstream couldn't be read", () => {
    expect(decide({ upstream: null, live: A, building: false, now: T, nextAttemptAt: 0 })).toBe("idle");
  });

  it("idles inside the backoff window after a failed build (no hammering)", () => {
    expect(decide({ upstream: B, live: A, building: false, now: T, nextAttemptAt: T + 5000 })).toBe("idle");
  });

  it("re-builds the SAME target once the backoff window elapses (never a permanent skip)", () => {
    expect(decide({ upstream: B, live: A, building: false, now: T + 6000, nextAttemptAt: T + 5000 })).toBe("build");
  });
});

describe("nextDivergedSince", () => {
  it("starts the clock on first divergence from a known upstream", () => {
    expect(nextDivergedSince(null, B, A, T)).toBe(T);
  });

  it("keeps the original start time while divergence persists (does not reset)", () => {
    expect(nextDivergedSince(T, B, A, T + 9999)).toBe(T);
  });

  it("clears the clock only on real convergence (live === upstream)", () => {
    expect(nextDivergedSince(T, A, A, T + 100)).toBe(null);
  });

  it("preserves the clock on a transient null upstream (DB blip) — no restart", () => {
    // The bug this guards: a null upstream must NOT clear an in-progress clock,
    // or a flapping DB keeps the stuck alarm from ever firing.
    expect(nextDivergedSince(T, null, A, T + 100)).toBe(T);
  });

  it("stays clear when converged and upstream momentarily unreadable", () => {
    expect(nextDivergedSince(null, null, A, T)).toBe(null);
  });
});

describe("backoffMs", () => {
  it("grows exponentially from the base interval", () => {
    expect(backoffMs(1, 30_000)).toBe(30_000);
    expect(backoffMs(2, 30_000)).toBe(60_000);
    expect(backoffMs(3, 30_000)).toBe(120_000);
  });

  it("caps so a persistent failure retries slowly, not every interval forever", () => {
    expect(backoffMs(100, 30_000)).toBe(30 * 60_000); // default cap
  });
});

describe("publishOutcome", () => {
  it("success clears the pending slot and broadcasts", () => {
    expect(publishOutcome(A, true)).toEqual({ pendingPublishSha: null, broadcast: true });
  });

  it("failure parks the sha for retry and does not broadcast", () => {
    // Invariant this encodes: never broadcast a sha whose bundle isn't on disk.
    expect(publishOutcome(A, false)).toEqual({ pendingPublishSha: A, broadcast: false });
  });
});

describe("shouldRetryPublish", () => {
  it("retries when idle and a sha is pending", () => {
    expect(shouldRetryPublish({ building: false, pendingPublishSha: A })).toBe(true);
  });

  it("does not retry while a build is in flight", () => {
    expect(shouldRetryPublish({ building: true, pendingPublishSha: A })).toBe(false);
  });

  it("does not retry when nothing is pending", () => {
    expect(shouldRetryPublish({ building: false, pendingPublishSha: null })).toBe(false);
  });
});

describe("dropStaleSearchIndex", () => {
  it("deletes an existing search-index.json and returns true", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-test-"));
    const p = path.join(dir, "search-index.json");
    fs.writeFileSync(p, "{}");

    expect(dropStaleSearchIndex(dir)).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it("returns false when the file is absent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-test-"));

    expect(dropStaleSearchIndex(dir)).toBe(false);
  });

  it("leaves other public/ files untouched", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-updater-test-"));
    fs.writeFileSync(path.join(dir, "search-index.json"), "{}");
    fs.writeFileSync(path.join(dir, "docs.json"), "{}");

    dropStaleSearchIndex(dir);

    expect(fs.existsSync(path.join(dir, "docs.json"))).toBe(true);
  });
});
