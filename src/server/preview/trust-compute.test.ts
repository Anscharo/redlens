// computeTrust: the async GitHub-driven half of trust.ts (tierFor/effectivePrTier
// are covered as pure functions in preview.test.ts). Drives computeTrust with a
// fake GhClient — no network, no module mocking needed since the function takes
// gh as a parameter.
import { test, expect } from "bun:test";
import { computeTrust, TRUSTED_FORK_OWNERS } from "./trust.ts";
import type { GhClient } from "./resolve.ts";

function fakeGh(handlers: Record<string, { ok?: boolean; json: any }>, calls?: string[]): GhClient {
  return {
    async fetchJson(p) {
      calls?.push(p);
      const h = handlers[p];
      if (!h) return { ok: false, status: 404, json: null };
      return { ok: h.ok ?? true, status: h.ok === false ? 500 : 200, json: h.json };
    },
  };
}

// Builds the exact three request paths computeTrust issues for `owner`.
function handlersFor(
  owner: string,
  opts: { orgMerged?: number; atlasMerged?: number; createdAt?: string; orgOk?: boolean; atlasOk?: boolean; userOk?: boolean },
): Record<string, { ok?: boolean; json: any }> {
  const orgPath = `/search/issues?q=${encodeURIComponent(`is:pr is:merged org:sky-ecosystem author:${owner}`)}&per_page=1`;
  const atlasPath = `/search/issues?q=${encodeURIComponent(`is:pr is:merged repo:sky-ecosystem/next-gen-atlas author:${owner}`)}&per_page=1`;
  const userPath = `/users/${owner}`;
  return {
    [orgPath]: { ok: opts.orgOk ?? true, json: { total_count: opts.orgMerged ?? 0 } },
    [atlasPath]: { ok: opts.atlasOk ?? true, json: { total_count: opts.atlasMerged ?? 0 } },
    [userPath]: opts.userOk === false ? { ok: false, json: null } : { json: { created_at: opts.createdAt ?? "2020-01-01T00:00:00Z" } },
  };
}

test("whitelisted owner is trusted without any GitHub calls", async () => {
  const owner = [...TRUSTED_FORK_OWNERS][0]!;
  const calls: string[] = [];
  const gh = fakeGh({}, calls);
  const wt = await computeTrust(owner, gh);
  expect(wt.tier).toBe("trusted");
  expect(calls).toHaveLength(0);
  expect(wt.orgMerged).toBe(0);
  expect(wt.atlasMerged).toBe(0);
});

test("owner with an atlas-merged PR is trusted; org-only merges are known", async () => {
  const atlasOwner = "atlas-merged-owner";
  const gh = fakeGh(handlersFor(atlasOwner, { orgMerged: 2, atlasMerged: 1 }));
  const t = await computeTrust(atlasOwner, gh);
  expect(t.tier).toBe("trusted");
  expect(t.atlasMerged).toBe(1);
  expect(t.orgMerged).toBe(2);

  const knownOwner = "org-only-owner";
  const gh2 = fakeGh(handlersFor(knownOwner, { orgMerged: 4, atlasMerged: 0 }));
  const t2 = await computeTrust(knownOwner, gh2);
  expect(t2.tier).toBe("known");
});

test("no merged history: old account is unknown, fresh account is refused", async () => {
  const oldOwner = "old-no-history-owner";
  const oldGh = fakeGh(handlersFor(oldOwner, { createdAt: "2000-01-01T00:00:00Z" }));
  const oldT = await computeTrust(oldOwner, oldGh);
  expect(oldT.tier).toBe("unknown");
  expect(oldT.accountAgeDays).toBeGreaterThan(1000);

  const freshOwner = "fresh-no-history-owner";
  const freshGh = fakeGh(handlersFor(freshOwner, { createdAt: new Date().toISOString() }));
  const freshT = await computeTrust(freshOwner, freshGh);
  expect(freshT.tier).toBe("refused");
});

test("a failed /users lookup degrades account age to 0 (refused, absent other history)", async () => {
  const owner = "user-lookup-fails-owner";
  const gh = fakeGh(handlersFor(owner, { userOk: false }));
  const t = await computeTrust(owner, gh);
  expect(t.accountAgeDays).toBe(0);
  expect(t.tier).toBe("refused");
});

test("failed search count reads as 0 (conservative degrade), not a throw", async () => {
  const owner = "search-fails-owner";
  const gh = fakeGh(handlersFor(owner, { orgOk: false, atlasOk: false }));
  const t = await computeTrust(owner, gh);
  expect(t.orgMerged).toBe(0);
  expect(t.atlasMerged).toBe(0);
});

test("caches by owner: a second call within TTL does not re-hit GitHub", async () => {
  const owner = "cached-owner";
  const calls: string[] = [];
  const gh = fakeGh(handlersFor(owner, { orgMerged: 1 }), calls);
  const first = await computeTrust(owner, gh);
  const callsAfterFirst = calls.length;
  expect(callsAfterFirst).toBeGreaterThan(0);
  const second = await computeTrust(owner, gh);
  expect(calls.length).toBe(callsAfterFirst); // no new calls
  expect(second).toEqual(first);
});
