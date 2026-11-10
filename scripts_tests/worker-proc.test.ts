import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROOT, SUBMODULE, readUpstreamSha, run, runAsync, setRunDeadline } from "../scripts/lib/worker-proc.mjs";

const node = process.execPath;

describe("worker process plumbing", () => {
  vi.spyOn(console, "log").mockImplementation(() => {});

  it("resolves the repo root and the atlas submodule under it", () => {
    expect(fs.existsSync(path.join(ROOT, "package.json"))).toBe(true);
    expect(SUBMODULE).toBe(path.join(ROOT, "vendor/next-gen-atlas"));
  });

  it("run completes a zero exit and throws on a non-zero one", () => {
    expect(() => run(node, ["-e", "process.exit(0)"])).not.toThrow();
    expect(() => run(node, ["-e", "process.exit(3)"], { stdio: "ignore" })).toThrow();
  });

  // execFileSync blocks the event loop, so the worker's hard-cap timer cannot
  // kill a hung child: the child must carry the deadline itself.
  it("run kills a child still running at the run deadline", () => {
    setRunDeadline(Date.now() + 300);
    try {
      const t = Date.now();
      expect(() => run(node, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" })).toThrow(/killed at the run deadline/);
      expect(Date.now() - t).toBeLessThan(10_000);
    } finally {
      setRunDeadline(null);
    }
  });

  it("runAsync resolves on exit 0, rejects with the exit code otherwise, and rejects a spawn error", async () => {
    await expect(runAsync(node, ["-e", "process.exit(0)"])).resolves.toBeUndefined();
    await expect(runAsync(node, ["-e", "process.exit(4)"], { stdio: "ignore" })).rejects.toThrow(/exited 4/);
    await expect(runAsync("definitely-not-a-command-xyz", [])).rejects.toThrow();
  });

  it("readUpstreamSha returns a full sha or null, never anything else", async () => {
    const sha = await readUpstreamSha(true);
    expect(sha === null || /^[0-9a-f]{40}$/.test(sha)).toBe(true);
  });
});
