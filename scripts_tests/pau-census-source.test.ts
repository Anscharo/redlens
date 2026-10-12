import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atlasSkew, readSnapshots } from "../scripts/lib/pau-census-source.ts";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const snap = (fetchedAt: string) => ({ deployment: "p:ethereum:monolithic", fetchedAt, contracts: [] });
const file = (body: unknown) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pau-src-")), "pau.json");
  fs.writeFileSync(f, typeof body === "string" ? body : JSON.stringify(body));
  return f;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("readSnapshots", () => {
  it("accepts fresh snapshots from a file", async () => {
    const r = await readSnapshots(file({ deployments: [snap("2026-10-09T11:00:00Z")] }), NOW);
    expect(r.problem).toBeNull();
    expect(r.snaps).toHaveLength(1);
  });

  it("keeps stale snapshots but names the problem", async () => {
    const r = await readSnapshots(file({ deployments: [snap("2026-10-09T01:00:00Z")] }), NOW);
    expect(r.snaps).toHaveLength(1);
    expect(r.problem).toMatch(/11 hours old/);
  });

  it("never reads an empty, missing or unreadable source as an empty list", async () => {
    expect(await readSnapshots(file({ deployments: [] }), NOW)).toMatchObject({ snaps: null, problem: expect.stringMatching(/served no deployments/) });
    expect((await readSnapshots(file("{not json"), NOW)).problem).toMatch(/could not be read/);
    expect((await readSnapshots(file({ deployments: [{ ...snap("x") }] }), NOW)).problem).toMatch(/without a read time/);
  });

  it("fetches a URL with one retry after a failure", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(new Response(JSON.stringify({ deployments: [snap("2026-10-09T11:30:00Z")] })));
    vi.stubGlobal("fetch", fetch);
    const pending = readSnapshots("https://example.test/api/pau", NOW);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).snaps).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports a URL that fails twice", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const pending = readSnapshots("https://example.test/api/pau", NOW);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).problem).toMatch(/could not be read \(HTTP 503\)/);
  });
});

describe("atlasSkew", () => {
  const root = path.resolve(import.meta.dirname, "..");
  it("says nothing for a file source", async () => {
    expect(await atlasSkew("/tmp/pau.json", root)).toBeNull();
  });

  it("names the server's and the checkout's atlas when they differ, and nothing when they match", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ atlas_sha: "abcdef1234" }))));
    expect(await atlasSkew("https://example.test/api/pau", root)).toMatch(/the server's atlas is abcdef1, the checkout's is/);
    const local = (await import("node:child_process")).execFileSync("git", ["-C", path.join(root, "vendor/next-gen-atlas"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ atlas_sha: local }))));
    expect(await atlasSkew("https://example.test/api/pau", root)).toBeNull();
  });

  it("says when the server's atlas could not be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect(await atlasSkew("https://example.test/api/pau", root)).toBe("pau-census: the server's atlas commit could not be read");
  });
});
