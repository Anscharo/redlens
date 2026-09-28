// Unit coverage for the committed PR-metadata cache. fs is mocked to an
// in-memory store so a test never touches .cache/github-prs, and execSync is
// stubbed per-test so nothing calls `gh`.
import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn((p: string) => store.has(p)),
    readFileSync: vi.fn((p: string) => {
      if (!store.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      return store.get(p)!;
    }),
    writeFileSync: vi.fn((p: string, data: string) => { store.set(p, data); }),
    mkdirSync: vi.fn(() => undefined),
  },
}));

const execSync = vi.fn();
vi.mock("node:child_process", () => ({ execSync: (...args: unknown[]) => execSync(...args) }));

// @ts-expect-error — runtime-only .mjs import.
import { extractPrNumber, fetchPr, PR_CACHE_DIR } from "../scripts/lib/github-pr-cache.mjs";

const cacheKey = (pr: number) => `${PR_CACHE_DIR}/${pr}.json`;

beforeEach(() => {
  store.clear();
  execSync.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("extractPrNumber", () => {
  it("reads the number an atlas commit subject ends with", () => {
    expect(extractPrNumber("Atlas Edit Proposal — 2026-09-21 (#341)")).toBe(341);
    expect(extractPrNumber("Set SparkLend LBTC LTV to zero (#319)\n")).toBe(319);
  });

  it("returns null when the subject carries no trailing PR marker", () => {
    expect(extractPrNumber("Merge branch 'main'")).toBeNull();
    expect(extractPrNumber("Revert (#12) and start over")).toBeNull();
  });
});

describe("fetchPr", () => {
  const ghPayload = {
    title: "Atlas Edit Proposal",
    body: "- Update Sky Direct Exposures",
    author: { login: "wouterkampmann" },
    url: "https://github.com/sky-ecosystem/next-gen-atlas/pull/341",
    comments: [{}, {}],
    reviews: [{ state: "APPROVED" }, { state: "COMMENTED" }, { state: "APPROVED" }],
  };

  it("returns a cached record without calling gh", async () => {
    store.set(cacheKey(294), JSON.stringify({ number: 294, title: "cached" }));
    expect(await fetchPr(294)).toEqual({ number: 294, title: "cached" });
    expect(execSync).not.toHaveBeenCalled();
  });

  it("fetches a missing record, counts approvals, and writes it", async () => {
    execSync.mockReturnValue(JSON.stringify(ghPayload));
    const rec = await fetchPr(341);
    expect(rec).toEqual({
      number: 341,
      title: "Atlas Edit Proposal",
      body: "- Update Sky Direct Exposures",
      author: "wouterkampmann",
      url: "https://github.com/sky-ecosystem/next-gen-atlas/pull/341",
      commentCount: 2,
      reviewCount: 3,
      approvalCount: 2,
    });
    expect(String(execSync.mock.calls[0][0])).toContain("sky-ecosystem/next-gen-atlas");
    expect(JSON.parse(store.get(cacheKey(341))!)).toEqual(rec);
  });

  it("fills in the fields gh leaves out", async () => {
    execSync.mockReturnValue(JSON.stringify({ title: "No body", url: "u" }));
    expect(await fetchPr(1)).toMatchObject({ body: "", author: null, commentCount: 0, reviewCount: 0, approvalCount: 0 });
  });

  it("returns null and writes nothing when the fetch fails", async () => {
    execSync.mockImplementation(() => { throw new Error("Resource not accessible by integration"); });
    expect(await fetchPr(999)).toBeNull();
    expect(store.has(cacheKey(999))).toBe(false);
  });
});
