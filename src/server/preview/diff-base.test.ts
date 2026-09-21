// Tests for diff-base.ts: candidate kick-off (startCandidates) + per-build
// diff-pair writing (writeDiffBases). No subprocess, no real GitHub round-trip
// — fetchTree stubs hand back local tmp atlas checkouts, parsed by the real
// scripts/lib/atlas-source.mjs loader (via snapshotFromSrcDir).
import { afterAll, afterEach, describe, test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startCandidates, writeDiffBases } from "./diff-base.ts";
import { previewPaths } from "./cache.ts";
import { config } from "../config.ts";
import type { Resolved } from "./resolve.ts";
import { getIndexes, setIndexes } from "../retrieval/indexes.ts";
import type { Candidates } from "./pr-diff.ts";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "diff-base-test-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function writeAtlasCheckout(dir: string, content: string): void {
  fs.mkdirSync(path.join(dir, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "content", "A.0 - Base.md"),
    [`# A.1 - One [Core]  <!-- UUID: ${ID} -->`, "", content, ""].join("\n"),
  );
}

function writeDocsJson(outDir: string, nodes: Record<string, unknown>): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "docs.json"), JSON.stringify({ nodes }));
}

const ID = "00000000-0000-4000-8000-000000000001";
const RESOLVED: Resolved = { repo: "someone/next-gen-atlas", sha: "headsha", kind: "branch", ref: "wip", private: false };

// Every test below drives writeDiffBases against a 2-doc (or smaller) fixture,
// not the real ~11k-node atlas.
const prevMinNodes = process.env.ATLAS_MIN_NODES;
process.env.ATLAS_MIN_NODES = "0";
afterAll(() => {
  if (prevMinNodes === undefined) delete process.env.ATLAS_MIN_NODES;
  else process.env.ATLAS_MIN_NODES = prevMinNodes;
});

/** Install a fake `live` snapshot for the duration of `fn`, restoring whatever
 *  (real or absent) indexes were installed before. */
async function withLiveDocMap<T>(atlasCommit: string, content: string, fn: () => Promise<T>): Promise<T> {
  let prev: unknown;
  try {
    prev = getIndexes();
  } catch {
    prev = undefined;
  }
  setIndexes({ docMap: new Map([[ID, { id: ID, doc_no: "A.1", title: "One", content }]]), meta: { atlasCommit } } as never);
  try {
    return await fn();
  } finally {
    setIndexes(prev as never);
  }
}

function muted(): () => void {
  const origWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (m: string) => warnings.push(String(m));
  return () => {
    console.warn = origWarn;
  };
}

describe("writeDiffBases", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  test("cold start (indexes not loaded): artifactsSkipped set, degrades to live-main, no artifacts written", async () => {
    let prev: unknown;
    try {
      prev = getIndexes();
    } catch {
      prev = undefined;
    }
    setIndexes(undefined as never); // makes getIndexes() throw
    const root = mkTmp();
    dirs.push(root);
    const paths = previewPaths("cold1", root);
    writeDocsJson(paths.outDir, {});
    const restore = muted();
    try {
      const result = await writeDiffBases(Promise.resolve({ auto: "live-main", compareOk: false } as Candidates), {
        resolved: RESOLVED,
        token: "t",
        priv: false,
        sha: "cold1",
        paths,
        fetchTree: async () => {
          throw new Error("must not be called");
        },
      });
      expect(result.artifactsSkipped).toBeDefined();
      expect(result.bases).toEqual({ auto: "live-main", reason: "indexes not loaded" });
      expect(fs.existsSync(path.join(paths.outDir, "diff.json"))).toBe(false);
    } finally {
      restore();
      setIndexes(prev as never);
    }
  });

  test("no candidate resolved: writes only diff.json/patches.json, warns with the given reason", async () => {
    const root = mkTmp();
    dirs.push(root);
    const paths = previewPaths("nolm1", root);
    writeDocsJson(paths.outDir, { [ID]: { id: ID, doc_no: "A.1", title: "One", content: "HEAD-X" } });
    await withLiveDocMap("live-sha", "LIVE-X", async () => {
      const restore = muted();
      try {
        const result = await writeDiffBases(
          Promise.resolve({ auto: "live-main", compareOk: false, reason: "compare failed" } as Candidates),
          { resolved: RESOLVED, token: "t", priv: false, sha: "nolm1", paths, fetchTree: async () => ({ srcDir: "" }) },
        );
        expect(result.bases).toEqual({ auto: "live-main", reason: "compare failed" });
        expect(fs.existsSync(path.join(paths.outDir, "diff.json"))).toBe(true);
        expect(fs.existsSync(path.join(paths.outDir, "patches.json"))).toBe(true);
        expect(fs.existsSync(path.join(paths.outDir, "diff.sky.json"))).toBe(false);
        expect(fs.existsSync(path.join(paths.outDir, "diff.repo.json"))).toBe(false);
      } finally {
        restore();
      }
    });
  });

  test("both candidates: writes diff.sky.json + diff.repo.json, sky renders vs live, repo renders vs its own base, auto pair copied byte-for-byte", async () => {
    const root = mkTmp();
    dirs.push(root);
    const paths = previewPaths("both1", root);
    writeDocsJson(paths.outDir, { [ID]: { id: ID, doc_no: "A.1", title: "One", content: "HEAD-X" } });

    const skyBase = mkTmp();
    writeAtlasCheckout(skyBase, "SKY-BASE-X");
    const repoBase = mkTmp();
    writeAtlasCheckout(repoBase, "REPO-BASE-X");

    const candidates: Candidates = {
      auto: "repo",
      sky: { key: "sky", repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "sky-mb" },
      repo: { key: "repo", repo: "someone/base-repo", ref: "develop", mergeBase: "repo-mb" },
      compareOk: true,
    };

    // The `repo` candidate makes writeCandidateDiffs also attempt base-drift,
    // which hits raw `fetch` (not the injected fetchTree) for the base tip's
    // compare/branch lookup — stub it to a deterministic 404 so this test never
    // touches the real network. The drift assertion below is what makes the
    // stub load-bearing rather than decorative.
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;

    try {
      await withLiveDocMap("unrelated-live-sha", "LIVE-X", async () => {
        const fetchCalls: string[] = [];
        const result = await writeDiffBases(Promise.resolve(candidates), {
          resolved: RESOLVED,
          token: "t",
          priv: false,
          sha: "both1",
          paths,
          fetchTree: async (_repo, s) => {
            fetchCalls.push(s);
            if (s === "sky-mb") return { srcDir: skyBase };
            if (s === "repo-mb") return { srcDir: repoBase };
            throw new Error(`unexpected sha ${s}`);
          },
        });

        expect(result.bases.auto).toBe("repo");
        // No /branches/<ref> lookup succeeded (404), so base-drift never resolved a tip.
        expect(result.bases.repo?.drift).toBeUndefined();
        expect(result.bases.sky).toMatchObject({ repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "sky-mb" });
        expect(result.bases.repo).toMatchObject({ repo: "someone/base-repo", ref: "develop", mergeBase: "repo-mb" });
        // stripKey: the internal `key` discriminator never leaks into meta.bases.
        expect((result.bases.sky as unknown as { key?: string }).key).toBeUndefined();

        const skyPatch = JSON.stringify(
          JSON.parse(fs.readFileSync(path.join(paths.outDir, "patches.sky.json"), "utf8"))[ID],
        );
        // sky's rendered patch is vs LIVE, never its own base.
        expect(skyPatch).toContain("LIVE");
        expect(skyPatch).not.toContain("SKY-BASE");

        const repoPatch = JSON.stringify(
          JSON.parse(fs.readFileSync(path.join(paths.outDir, "patches.repo.json"), "utf8"))[ID],
        );
        // repo's rendered patch is vs its OWN base, never live (no upstream drift leak).
        expect(repoPatch).toContain("REPO-BASE");
        expect(repoPatch).not.toContain("LIVE");

        // diff.json / patches.json are the `auto` ("repo") pair, byte-for-byte.
        expect(fs.readFileSync(path.join(paths.outDir, "diff.json"), "utf8")).toBe(
          fs.readFileSync(path.join(paths.outDir, "diff.repo.json"), "utf8"),
        );
        expect(fs.readFileSync(path.join(paths.outDir, "patches.json"), "utf8")).toBe(
          fs.readFileSync(path.join(paths.outDir, "patches.repo.json"), "utf8"),
        );
        expect(fetchCalls.sort()).toEqual(["repo-mb", "sky-mb"]);
      });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("dedupe: sky and repo sharing one merge base fetch it exactly once", async () => {
    const root = mkTmp();
    dirs.push(root);
    const paths = previewPaths("dedupe1", root);
    writeDocsJson(paths.outDir, { [ID]: { id: ID, doc_no: "A.1", title: "One", content: "HEAD-X" } });
    const sharedBase = mkTmp();
    writeAtlasCheckout(sharedBase, "SHARED-BASE-X");

    const candidates: Candidates = {
      auto: "sky",
      sky: { key: "sky", repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "shared-mb" },
      repo: { key: "repo", repo: "someone/base-repo", ref: "develop", mergeBase: "shared-mb" },
      compareOk: true,
    };

    // Same rationale as the "both candidates" test above: the `repo` candidate
    // triggers base-drift, which hits raw `fetch` — stub it to a deterministic
    // 404 so this test never touches the real network.
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    try {
      await withLiveDocMap("live-sha", "LIVE-X", async () => {
        let fetchCount = 0;
        const result = await writeDiffBases(Promise.resolve(candidates), {
          resolved: RESOLVED,
          token: "t",
          priv: false,
          sha: "dedupe1",
          paths,
          fetchTree: async () => {
            fetchCount += 1;
            return { srcDir: sharedBase };
          },
        });
        expect(fetchCount).toBe(1);
        expect(result.bases.repo?.drift).toBeUndefined(); // 404'd — makes the stub load-bearing
        expect(fs.existsSync(path.join(paths.outDir, "diff.sky.json"))).toBe(true);
        expect(fs.existsSync(path.join(paths.outDir, "diff.repo.json"))).toBe(true);
      });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("base fetch failure: the candidate is dropped, auto degrades to live-main with the reason, diff.json is vs live", async () => {
    const root = mkTmp();
    dirs.push(root);
    const paths = previewPaths("fail1", root);
    writeDocsJson(paths.outDir, { [ID]: { id: ID, doc_no: "A.1", title: "One", content: "HEAD-X" } });

    const candidates: Candidates = {
      auto: "sky",
      sky: { key: "sky", repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "unreachable-mb" },
      compareOk: true,
    };

    await withLiveDocMap("live-sha", "LIVE-X", async () => {
      const origWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (m: string) => warnings.push(String(m));
      try {
        const result = await writeDiffBases(Promise.resolve(candidates), {
          resolved: RESOLVED,
          token: "t",
          priv: false,
          sha: "fail1",
          paths,
          fetchTree: async () => {
            throw new Error("network exploded");
          },
        });
        // The label and the bytes must agree: a base that never loaded is not
        // advertised, so the bar says "live main", not "sky main".
        expect(result.bases.sky).toBeUndefined();
        expect(result.bases.auto).toBe("live-main");
        expect(result.bases.reason).toContain("base unreacha unavailable");
        expect(fs.existsSync(path.join(paths.outDir, "diff.sky.json"))).toBe(false);
        expect(fs.existsSync(path.join(paths.outDir, "diff.json"))).toBe(true);
        expect(warnings.some((w) => w.includes("unavailable") && w.includes("diffing against live main"))).toBe(true);
        // Fell back to live main as the base — the patch is LIVE-X → HEAD-X,
        // never anything from the unreachable base tree.
        const rendered = JSON.stringify(JSON.parse(fs.readFileSync(path.join(paths.outDir, "patches.json"), "utf8"))[ID]);
        expect(rendered).toContain("LIVE");
        expect(rendered).toContain("HEAD");
      } finally {
        console.warn = origWarn;
      }
    });
  });
});

describe("startCandidates", () => {
  const origToken = config.githubToken;
  afterEach(() => {
    config.githubToken = origToken;
  });

  test("public with no service token: resolves to the live-main stub without any network attempt", async () => {
    config.githubToken = "";
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("must not hit the network");
    }) as unknown as typeof fetch;
    try {
      const result = await startCandidates(RESOLVED, "t", false);
      expect(result).toEqual({ auto: "live-main", compareOk: false, reason: "no GitHub token, compare skipped" });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("private preview resolves its in-repo candidate with no service token configured (the installation token is enough)", async () => {
    config.githubToken = "";
    const origFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      fetched.push(u);
      if (u.endsWith("/repos/acme/secret-atlas/compare/main...headsha")) return Response.json({ merge_base_commit: { sha: "mainmb" }, ahead_by: 2 });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    try {
      const resolved = { repo: "acme/secret-atlas", sha: "headsha", kind: "branch" as const, ref: "pull-7", defaultBranch: "main", private: true };
      const result = await startCandidates(resolved, "inst-tok", true);
      // Unlike the public no-token stub above, the compare ran — and it is the
      // ONLY call: no nga-main commit list is walked for a private preview.
      expect(fetched).toEqual(["https://api.github.com/repos/acme/secret-atlas/compare/main...headsha"]);
      expect(result).toMatchObject({ auto: "repo", repo: { ref: "main", mergeBase: "mainmb" }, compareOk: true });
      expect(result.sky).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
