import { test, expect } from "bun:test";
import { CANONICAL_REPO, type GhClient } from "./resolve.ts";
import { diffBaseHasLca, diffBaseLabel, diffBaseType } from "./diff-base-record.ts";
import type { Candidate, Candidates } from "./pr-diff.ts";
import type { Snapshot } from "./snapshot.ts";
import type { PreviewMeta } from "./cache.ts";
import {
  fillPreviewDiffBase,
  materializeDiffBase,
  resolveBackfillRow,
  type BackfillRow,
} from "./diff-base-backfill-row.ts";
import { backfillPreviewDiffBases, type BackfillDeps } from "./diff-base-backfill.ts";

const SHA = "h".repeat(40);
const LIVE = "c".repeat(40);
const OLD = "o".repeat(40);

function row(over: Partial<BackfillRow> = {}): BackfillRow {
  return {
    sha: SHA,
    repo: "blimpa/next-gen-atlas",
    ref: "pull-340",
    kind: "pr",
    pr_number: 340,
    private: false,
    pr_base_repo: null,
    pr_base_ref: null,
    default_branch: null,
    ...over,
  };
}

function gh(routes: Record<string, { ok: boolean; json?: unknown }>, seen: string[]): GhClient {
  return {
    async fetchJson(p) {
      seen.push(p);
      const hit = routes[p];
      if (!hit) throw new Error(`unexpected ${p}`);
      return { ok: hit.ok, status: hit.ok ? 200 : 404, json: hit.json ?? null };
    },
  };
}

function snap(rows: [string, string][]): Snapshot {
  return new Map(rows.map(([id, hash]) => [id, { id, doc_no: "A.1", title: "t", content: hash, contentHash: hash }]));
}

const liveSnap = snap([["a", "1"]]);
const headSnap = snap([["a", "9"], ["b", "2"]]);
const live = { commit: LIVE, snapshot: liveSnap };

function sky(mergeBase = LIVE): Candidate {
  return { key: "sky", repo: CANONICAL_REPO, ref: "main", mergeBase, aheadBy: 1, behindBy: 0 };
}

test("resolveBackfillRow keeps a stored PR base and does not ask GitHub", async () => {
  const seen: string[] = [];
  const got = await resolveBackfillRow(row({ pr_base_repo: CANONICAL_REPO, pr_base_ref: "main" }), gh({}, seen));
  expect(seen).toEqual([]);
  expect(got).not.toBe("skip");
  if (got === "skip") return;
  expect(got.resolved.kind).toBe("pr");
  expect(got.resolved.prBase).toEqual({ repo: CANONICAL_REPO, ref: "main" });
  expect(got.resolved.defaultBranch).toBeUndefined();
  expect(got.discovered).toEqual({});
});

test("resolveBackfillRow reads a canonical PR from nga, not from the head fork", async () => {
  const seen: string[] = [];
  const got = await resolveBackfillRow(
    row(),
    gh({ [`/repos/${CANONICAL_REPO}/pulls/340`]: { ok: true, json: { base: { ref: "main", repo: { full_name: CANONICAL_REPO }, sha: "abc" } } } }, seen),
  );
  expect(seen).toEqual([`/repos/${CANONICAL_REPO}/pulls/340`]);
  if (got === "skip") throw new Error("skip");
  expect(got.resolved.prBase).toMatchObject({ repo: CANONICAL_REPO, ref: "main" });
  expect(got.discovered.prBase).toEqual({ repo: CANONICAL_REPO, ref: "main" });
  expect(got.resolved.defaultBranch).toBeUndefined();
});

test("resolveBackfillRow reads a fork pull-N from that fork", async () => {
  const seen: string[] = [];
  const repo = "acme/private-atlas";
  const got = await resolveBackfillRow(
    row({ repo, ref: "pull-7", kind: "branch", pr_number: null }),
    gh({ [`/repos/${repo}/pulls/7`]: { ok: true, json: { base: { ref: "develop", repo: { full_name: repo } } } } }, seen),
  );
  expect(seen).toEqual([`/repos/${repo}/pulls/7`]);
  if (got === "skip") throw new Error("skip");
  expect(got.resolved.kind).toBe("branch");
  expect(got.discovered.prBase).toEqual({ repo, ref: "develop" });
});

test("resolveBackfillRow learns a fork default branch only when there is no PR base", async () => {
  const seen: string[] = [];
  const repo = "acme/fork";
  const got = await resolveBackfillRow(
    row({ repo, ref: "feature", kind: "branch", pr_number: null }),
    gh({ [`/repos/${repo}`]: { ok: true, json: { default_branch: "develop" } } }, seen),
  );
  expect(seen).toEqual([`/repos/${repo}`]);
  if (got === "skip") throw new Error("skip");
  expect(got.resolved.prBase).toBeUndefined();
  expect(got.resolved.defaultBranch).toBe("develop");
  expect(got.discovered).toEqual({ defaultBranch: "develop" });
});

test("resolveBackfillRow skips a repo it cannot read", async () => {
  const seen: string[] = [];
  const repo = "acme/gone";
  const got = await resolveBackfillRow(
    row({ repo, ref: "feature", kind: "branch", pr_number: null }),
    gh({ [`/repos/${repo}`]: { ok: false } }, seen),
  );
  expect(got).toBe("skip");
});

test("materializeDiffBase reuses the served atlas when the merge base is current main", async () => {
  const fetched: string[] = [];
  const got = await materializeDiffBase(
    { repo: "blimpa/next-gen-atlas", sha: SHA, kind: "pr", ref: "pull-340", prBase: { repo: CANONICAL_REPO, ref: "main" } },
    { auto: "sky", sky: sky(), compareOk: true },
    live,
    async (_repo, sha) => {
      fetched.push(sha);
      if (sha !== SHA) throw new Error(`fetched ${sha}`);
      return headSnap;
    },
  );
  expect(fetched).toEqual([SHA]);
  if (got === "skip") throw new Error("skip");
  expect(got.bases.auto).toBe("sky");
  expect(got.bases.sky?.mergeBase).toBe(LIVE);
  expect(got.counts).toEqual({ added: 1, changed: 1 });
});

test("materializeDiffBase skips a head whose archive is gone", async () => {
  const got = await materializeDiffBase(
    { repo: "r", sha: SHA, kind: "pr", ref: "pull-1" },
    { auto: "live-main", compareOk: true },
    live,
    async () => {
      throw new Error("archive 404 for secret/repo@sha");
    },
  );
  expect(got).toBe("skip");
});

test("materializeDiffBase counts a live-main pick against the served atlas and advertises no candidate", async () => {
  const got = await materializeDiffBase(
    { repo: "r", sha: SHA, kind: "branch", ref: "feature" },
    { auto: "live-main", reason: "no base branch to compare against", compareOk: true },
    live,
    async () => headSnap,
  );
  if (got === "skip") throw new Error("skip");
  expect(got.bases).toEqual({ auto: "live-main", reason: "no base branch to compare against" });
  expect(got.counts).toEqual({ added: 1, changed: 1 });
});

test("materializeDiffBase moves off a base whose tree will not load, without naming the repo", async () => {
  const repoSnap = snap([["a", "9"]]);
  const got = await materializeDiffBase(
    { repo: "acme/secret-atlas", sha: SHA, kind: "pr", ref: "pull-7", prBase: { repo: "acme/secret-atlas", ref: "develop" } },
    {
      auto: "sky",
      reason: "candidates diverged",
      sky: sky(OLD),
      repo: { key: "repo", repo: "acme/secret-atlas", ref: "develop", mergeBase: "b".repeat(40) },
      compareOk: true,
    },
    live,
    async (_repo, sha) => {
      if (sha === SHA) return headSnap;
      if (sha === "b".repeat(40)) return repoSnap;
      throw new Error(`archive 404 for acme/secret-atlas@${sha}`);
    },
  );
  if (got === "skip") throw new Error("skip");
  expect(got.bases.auto).toBe("repo");
  expect(got.bases.reason).toBe("base unavailable");
  expect(got.bases.sky).toBeUndefined();
  expect(got.bases.repo?.ref).toBe("develop");
  expect(JSON.stringify(got.bases)).not.toContain("acme/secret-atlas@");
  // Redlined against the repo tree that loaded, not against live main under that name.
  expect(got.counts).toEqual({ added: 1, changed: 0 });
});

test("fillPreviewDiffBase updates only while the columns are null, and keeps false and zero", async () => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const q = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ sql: strings.join(" "), values });
    return [{ sha: SHA }];
  };
  const meta = {
    sha: SHA,
    repo: "blimpa/next-gen-atlas",
    ref: "pull-340",
    kind: "pr",
    resolvedAt: "",
    docCount: 0,
    buildMs: 0,
    prBase: { repo: CANONICAL_REPO, ref: "main" },
    bases: { auto: "live-main" as const, reason: "PR base did not resolve" },
    baseAtlasCommit: LIVE,
    diffCounts: { added: 0, changed: 0 },
  } as PreviewMeta;
  expect(await fillPreviewDiffBase(q, SHA, meta, { prBase: { repo: CANONICAL_REPO, ref: "main" } })).toBe(true);
  const sql = calls[0]!.sql;
  expect(sql).toContain("UPDATE previews");
  expect(sql).toContain("diff_base_type IS NULL");
  expect(sql).toContain("::jsonb");
  expect(sql).not.toContain("last_access");
  expect(sql).not.toContain("created_at");
  const values = calls[0]!.values;
  expect(values).toContain(false);
  expect(values).toContain(0);
  expect(values.some((v) => typeof v === "object" && v !== null && !Array.isArray(v))).toBe(true);
  expect(values.every((v) => typeof v !== "string" || !v.startsWith("{"))).toBe(true);
  const empty = async () => [];
  expect(await fillPreviewDiffBase(empty, SHA, meta, {})).toBe(false);
});

function deps(over: Partial<BackfillDeps>): Partial<BackfillDeps> {
  return {
    token: () => "token",
    installationToken: async () => null,
    gh: () => ({ fetchJson: async () => ({ ok: true, status: 200, json: {} }) }),
    candidates: async () => ({ auto: "sky", sky: sky(), compareOk: true }) as Candidates,
    live: async () => live,
    snapshotAt: async (_repo, sha) => (sha === SHA ? headSnap : liveSnap),
    fill: async () => true,
    ...over,
  };
}

test("backfillPreviewDiffBases does not fetch an atlas when no row is empty", async () => {
  let lived = false;
  const r = await backfillPreviewDiffBases(deps({ list: async () => [], live: async () => { lived = true; return live; } }));
  expect(r).toEqual({ filled: 0, skipped: 0, failed: 0 });
  expect(lived).toBe(false);
});

test("backfillPreviewDiffBases leaves rows null when there is no GitHub token", async () => {
  let lived = false;
  const r = await backfillPreviewDiffBases(deps({
    list: async () => [row({ pr_base_repo: CANONICAL_REPO, pr_base_ref: "main" })],
    token: () => "",
    live: async () => { lived = true; return live; },
  }));
  expect(r).toEqual({ filled: 0, skipped: 1, failed: 0 });
  expect(lived).toBe(false);
});

test("backfillPreviewDiffBases records a PR against nga main as pr-base, and skips a private repo it cannot read", async () => {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (m?: unknown) => logs.push(String(m));
  const filled: PreviewMeta[] = [];
  try {
    const r = await backfillPreviewDiffBases(deps({
      list: async () => [
        row({ pr_base_repo: CANONICAL_REPO, pr_base_ref: "main" }),
        row({ sha: "p".repeat(40), repo: "acme/secret-atlas", ref: "mod", kind: "branch", pr_number: null, private: true }),
      ],
      fill: async (_sha, meta) => {
        filled.push(meta);
        return true;
      },
    }));
    expect(r).toEqual({ filled: 1, skipped: 1, failed: 0 });
  } finally {
    console.log = orig;
  }
  expect(diffBaseType(filled[0]!)).toBe("pr-base");
  expect(diffBaseHasLca(filled[0]!)).toBe(true);
  expect(diffBaseLabel(filled[0]!)).toBe(`${CANONICAL_REPO}:main@${LIVE}`);
  expect(filled[0]!.diffCounts).toEqual({ added: 1, changed: 1 });
  expect(logs.join("\n")).toContain(": backfill ");
  expect(logs.join("\n")).not.toContain("acme/secret-atlas");
  expect(logs.join("\n")).not.toContain("blimpa/next-gen-atlas");
});

test("backfillPreviewDiffBases fetches a private archive on the API tarball, with the installation token", async () => {
  const snaps: { token: string; apiTarball?: boolean }[] = [];
  const r = await backfillPreviewDiffBases(deps({
    list: async () => [row({
      sha: "p".repeat(40),
      repo: "acme/secret-atlas",
      ref: "mod",
      kind: "branch",
      pr_number: null,
      private: true,
      default_branch: "main",
    })],
    token: () => "service-token",
    installationToken: async () => "inst-token",
    gh: () => ({ fetchJson: async () => ({ ok: true, status: 200, json: {} }) }),
    candidates: async () => ({ auto: "live-main", reason: "no base branch to compare against", compareOk: true }),
    snapshotAt: async (_repo, sha, token, apiTarball) => {
      snaps.push({ token, apiTarball });
      return sha === "p".repeat(40) ? headSnap : liveSnap;
    },
    fill: async () => true,
  }));
  expect(r.filled).toBe(1);
  expect(snaps.length).toBeGreaterThan(0);
  expect(snaps.every((s) => s.token === "inst-token" && s.apiTarball === true)).toBe(true);
});

test("a public backfill keeps the public archive URL", async () => {
  const snaps: { token: string; apiTarball?: boolean }[] = [];
  await backfillPreviewDiffBases(deps({
    list: async () => [row({ pr_base_repo: CANONICAL_REPO, pr_base_ref: "main" })],
    token: () => "service-token",
    snapshotAt: async (_repo, _sha, token, apiTarball) => {
      snaps.push({ token, apiTarball });
      return headSnap;
    },
  }));
  expect(snaps.every((s) => s.token === "service-token" && s.apiTarball === false)).toBe(true);
});

test("backfillPreviewDiffBases skips a private row when the installation lookup throws", async () => {
  const r = await backfillPreviewDiffBases(deps({
    list: async () => [row({ sha: "p".repeat(40), repo: "acme/secret-atlas", ref: "mod", kind: "branch", pr_number: null, private: true })],
    installationToken: async () => {
      throw new Error("error:1E08010C:DECODER routines::acme/secret-atlas");
    },
    gh: () => { throw new Error("should not build a client"); },
  }));
  expect(r).toEqual({ filled: 0, skipped: 1, failed: 0 });
});

test("backfillPreviewDiffBases logs the error name only when a row throws", async () => {
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (m?: unknown) => warns.push(String(m));
  try {
    const r = await backfillPreviewDiffBases(deps({
      list: async () => [row({ pr_base_repo: CANONICAL_REPO, pr_base_ref: "main" })],
      candidates: async () => {
        const e = new Error("archive 404 for acme/secret-atlas@abc");
        e.name = "SourceGoneError";
        throw e;
      },
    }));
    expect(r).toEqual({ filled: 0, skipped: 0, failed: 1 });
  } finally {
    console.warn = orig;
  }
  expect(warns.join("\n")).toContain("SourceGoneError");
  expect(warns.join("\n")).not.toContain("acme/secret-atlas");
});
