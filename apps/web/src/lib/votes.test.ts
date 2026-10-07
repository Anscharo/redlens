import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchJson = vi.fn();
vi.mock("@/lib/verify", () => ({
  fetchJson: (...a: unknown[]) => fetchJson(...a),
}));

import { loadVoteEvidence, loadVoteIndex, resetVoteIndexCache } from "./votes";

const artifact = {
  sources: { executives: "", polls: "", portal: null },
  executives: [
    { file: "2026/e.md", date: "2026-03-26", frontmatterDate: null, outOfSchedule: false, title: "T", summary: "", address: null, sections: [], portal: null },
  ],
  polls: [],
};

describe("loadVoteIndex", () => {
  beforeEach(() => {
    resetVoteIndexCache();
    fetchJson.mockReset();
  });
  afterEach(() => resetVoteIndexCache());

  it("fetches votes.json once and indexes it", async () => {
    fetchJson.mockResolvedValue(artifact);
    const index = await loadVoteIndex();
    expect(index).toMatchObject({ first: "2026-03-26", last: "2026-03-26" });
    await expect(loadVoteIndex()).resolves.toBe(index);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0][0]).toMatch(/votes\.json$/);
  });

  it("resolves null on a failed fetch and retries on the next call", async () => {
    fetchJson.mockRejectedValueOnce(new Error("votes.json: 404"));
    await expect(loadVoteIndex()).resolves.toBeNull();
    fetchJson.mockResolvedValueOnce(artifact);
    await expect(loadVoteIndex()).resolves.toMatchObject({ first: "2026-03-26" });
  });
});

describe("loadVoteEvidence", () => {
  beforeEach(() => {
    resetVoteIndexCache();
    fetchJson.mockReset();
  });

  it("fetches the worker's overlay once from the API root", async () => {
    const overlay = { atlasSha: "abc", computedAt: "2026-10-07T00:00:00.000Z", claims: {} };
    fetchJson.mockResolvedValue(overlay);
    await expect(loadVoteEvidence()).resolves.toBe(overlay);
    await loadVoteEvidence();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0][0]).toBe("/api/vote-evidence");
  });

  it("resolves null before the worker has run, and asks again next time", async () => {
    fetchJson.mockRejectedValueOnce(new Error("vote-evidence: 503"));
    await expect(loadVoteEvidence()).resolves.toBeNull();
    fetchJson.mockResolvedValueOnce({ atlasSha: "abc", computedAt: "t", claims: {} });
    await expect(loadVoteEvidence()).resolves.toMatchObject({ atlasSha: "abc" });
  });
});
