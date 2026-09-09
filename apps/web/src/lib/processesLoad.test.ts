import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProcessEntry } from "@/lib/processesIndex";

const served = vi.hoisted(() => ({ entries: null as unknown, fail: null as Error | null }));
vi.mock("@/lib/verify", () => ({
  fetchJson: () => (served.fail ? Promise.reject(served.fail) : Promise.resolve(served.entries)),
}));

const ENTRIES: ProcessEntry[] = [{ uuid: "u1", category: "Governance", shape: "inline", status: "active" }];

// The module-level `cache` has no per-call key (unlike loadOeaReport's
// per-base map), so each test needs its own fresh module instance.
beforeEach(() => {
  vi.resetModules();
  served.entries = null;
  served.fail = null;
});

describe("loadProcesses", () => {
  it("fetches once and caches — a second call returns the same promise without refetching", async () => {
    served.entries = ENTRIES;
    const { loadProcesses } = await import("./processesLoad");
    const a = loadProcesses();
    const b = loadProcesses();
    expect(a).toBe(b);
    expect(await a).toEqual(ENTRIES);
  });

  it("evicts the cache on a fetch failure, so a follow-up call retries instead of replaying the rejection", async () => {
    served.fail = new Error("boom");
    const { loadProcesses } = await import("./processesLoad");
    await expect(loadProcesses()).rejects.toThrow("boom");
    served.fail = null;
    served.entries = ENTRIES;
    await expect(loadProcesses()).resolves.toEqual(ENTRIES);
  });
});
