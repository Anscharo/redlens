// Orchestration of the two auto-resolution passes (plan §10.4), driven with a STUB
// proposer + hand-built commits so it runs offline. Verifies pass 1 (forward∩reverse)
// locks a corroborated case, pass 2 (LLM∩matcher) locks only on agreement, and --no-llm
// leaves the eligible cases for a human.
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
// @ts-expect-error — .mjs without types
import { runAutoCurate } from "../scripts/lib/auto-curate-run.mjs";

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");
const node = (content: string, structuralKey: string, order: number) => ({
  title: content.slice(0, 10), doc_no: null, type: "Core", section: "S", ancestors: [],
  content, contentHash: md5(content), structuralKey, order,
});

// Two commits, one hop. The older "alpha" doc is lightly edited in the newer commit
// (shares 8-shingle prose) so the forward mutual-best pass links them; "beta" is new.
const stableOld = "the quick brown fox jumps over the lazy dog every single morning here";
const stableNew = "the quick brown fox jumps over the lazy dog every single morning today";
const oldA = node(stableOld, "kA", 0);
const newA = node(stableNew, "kA", 0);
const newB = node("a totally unrelated freshly authored paragraph with no shared shingles", "kB", 1);
const commits = [{ sha: "old00000", nodes: [oldA] }, { sha: "new00000", nodes: [newA, newB] }];

// curation queue: one case whose subject is newA, matcher auto-pick = oldA (the forward
// pass also lands on oldA → forward∩reverse should lock it).
const oldKey = `old00000:${oldA.contentHash}`;
const data = {
  meta: { migrationSha: "mig", lastHtmlSha: "old00000" },
  nodes: {
    [`new00000:${newA.contentHash}`]: { title: "alpha", content: stableNew },
    [oldKey]: { title: "alpha", content: stableOld },
  },
  cases: [{
    key: `new00000:${newA.contentHash}`, kind: "tier-3", newerSha: "new00000", olderSha: "old00000",
    subjectKey: `new00000:${newA.contentHash}`, autoKey: oldKey,
    candidates: [{ key: oldKey, score: 0.95 }],
  }],
};

describe("runAutoCurate", () => {
  it("locks a forward-corroborated case in pass 1 without consulting the LLM", async () => {
    let asked = 0;
    const { decisions, summary } = await runAutoCurate({
      data, commits, haveKey: true, propose: async () => (asked++, { chosenKey: "x", why: "" }),
    });
    expect(summary.resolvedByForwardReverse).toBe(1);
    expect(decisions[0].auto).toBe("forward-reverse");
    expect(decisions[0].chosenKey).toBe(oldKey);
    expect(asked).toBe(0); // forward agreed → never reached the LLM
  });

  it("falls back to the LLM cross-check only when forward did not corroborate", async () => {
    // break the forward link by giving the matcher a pick the forward pass won't reach
    const phantom = "phantom00:deadbeef";
    const d2 = { ...data, nodes: { ...data.nodes, [phantom]: { title: "z", content: "z" } },
      cases: [{ ...data.cases[0], autoKey: phantom, candidates: [{ key: phantom, score: 0.95 }] }] };
    const agree = await runAutoCurate({ data: d2, commits, haveKey: true, propose: async () => ({ chosenKey: phantom, why: "same" }) });
    expect(agree.summary.resolvedByForwardReverse).toBe(0);
    expect(agree.summary.resolvedByLlm).toBe(1);
    expect(agree.decisions[0].auto).toBe("llm-90");

    const disagree = await runAutoCurate({ data: d2, commits, haveKey: true, propose: async () => ({ chosenKey: "none", why: "different" }) });
    expect(disagree.summary.resolved).toBe(0); // LLM declined → stays human
  });

  it("locks via reverse∩containment (pass 1.5) before reaching the LLM", async () => {
    // forward can't corroborate (the subject isn't a node in `commits`), but ordered
    // containment lands on autoKey with a clear margin over the unrelated sibling.
    const subj = "the operational executor agent settles integrator rewards each epoch in usdc";
    const goodKey = "old00000:cccccccc", sibKey = "old00000:dddddddd";
    const d = {
      meta: {},
      nodes: {
        "new00000:eeee": { title: "exec", content: subj },
        [goodKey]: { title: "exec", content: "the operational executor agent settles integrator rewards each epoch" },
        [sibKey]: { title: "penalty", content: "the penalty module reverses unrelated charges for a different actor entirely" },
      },
      cases: [{
        key: "new00000:eeee", kind: "tier-2.5", newerSha: "new00000", olderSha: "old00000",
        subjectKey: "new00000:eeee", autoKey: goodKey,
        candidates: [{ key: goodKey, score: 0.92 }, { key: sibKey, score: 0.5 }],
      }],
    };
    let asked = 0;
    const { decisions, summary } = await runAutoCurate({ data: d, commits, haveKey: true, propose: async () => (asked++, { chosenKey: "x", why: "" }) });
    expect(summary.resolvedByContainment).toBe(1);
    expect(decisions[0].auto).toBe("containment");
    expect(asked).toBe(0); // containment locked it; the LLM was never consulted
  });

  it("--no-containment disables pass 1.5", async () => {
    const subj = "the operational executor agent settles integrator rewards each epoch in usdc";
    const goodKey = "old00000:cccccccc";
    const d = {
      meta: {}, nodes: { "new00000:eeee": { title: "exec", content: subj }, [goodKey]: { title: "exec", content: "the operational executor agent settles integrator rewards each epoch" } },
      cases: [{ key: "new00000:eeee", kind: "tier-2.5", newerSha: "new00000", olderSha: "old00000", subjectKey: "new00000:eeee", autoKey: goodKey, candidates: [{ key: goodKey, score: 0.92 }] }],
    };
    const { summary } = await runAutoCurate({ data: d, commits, haveKey: true, containment: false, propose: async () => ({ chosenKey: goodKey, why: "" }) });
    expect(summary.resolvedByContainment).toBe(0);
    expect(summary.resolvedByLlm).toBe(1); // falls through to the LLM instead
  });

  it("--no-llm leaves the eligible cases for a human", async () => {
    const phantom = "phantom00:deadbeef";
    const d2 = { ...data, cases: [{ ...data.cases[0], autoKey: phantom, candidates: [{ key: phantom, score: 0.95 }] }] };
    let asked = 0;
    const { summary } = await runAutoCurate({ data: d2, commits, haveKey: true, noLlm: true, propose: async () => (asked++, { chosenKey: phantom, why: "" }) });
    expect(asked).toBe(0);
    expect(summary.resolved).toBe(0);
    expect(summary.llm.limited).toBe(1); // 1 eligible, none asked
  });
});

describe("runAutoCurate — pass 3 (frontier escalation)", () => {
  // a residual, frontier-eligible case: its subject isn't a node in `commits` (so the
  // forward pass abstains), its lone candidate is unrelated prose (containment can't lock),
  // and the matcher pick is 0.92-confident (<0.95 → T1 low-confidence fires).
  const subjC = "some moderately wordy subject paragraph that exists only to be curated here";
  const goodKey = "old00000:aaaa1111";
  const baseData = () => ({
    meta: {},
    nodes: {
      "new00000:zzzz": { title: "subj", content: subjC },
      [goodKey]: { title: "cand", content: "an entirely unrelated older candidate body text now" },
    },
    cases: [{
      key: "new00000:zzzz", kind: "tier-3", newerSha: "new00000", olderSha: "old00000",
      subjectKey: "new00000:zzzz", autoKey: goodKey, candidates: [{ key: goodKey, score: 0.92 }],
    }],
  });
  // stub: the cheap pass (no opts.model) DECLINES so the case stays residual; the frontier
  // pass (opts.model set) answers `frontierPick`. Records every model it was called with.
  const proposer = (frontierPick: string) => {
    const calls: string[] = [];
    const propose = async (_s: unknown, _c: unknown, opts?: { model?: string }) => {
      calls.push(opts?.model ?? "cheap");
      return opts?.model ? { chosenKey: frontierPick, why: "frontier" } : { chosenKey: "none", why: "cheap declines" };
    };
    return { propose, calls };
  };

  it("locks a residual case when the frontier agrees with an independent signal (matcher)", async () => {
    const { propose, calls } = proposer(goodKey);
    const { decisions, proposals, summary } = await runAutoCurate({
      data: baseData(), commits, haveKey: true, frontier: true, frontierModel: "test-frontier", propose,
    });
    expect(calls).toContain("test-frontier"); // the frontier model was actually used
    expect(summary.resolvedByFrontier).toBe(1);
    expect(proposals).toHaveLength(0);
    expect(decisions.find((d: { auto: string }) => d.auto === "frontier")).toMatchObject({ chosenKey: goodKey, corroborator: "matcher" });
  });

  it("records a HINT (no lock) when the frontier pick has no independent corroborator", async () => {
    const { propose } = proposer("none"); // frontier abstains → nothing to corroborate
    const { decisions, proposals, summary } = await runAutoCurate({
      data: baseData(), commits, haveKey: true, frontier: true, frontierModel: "test-frontier", propose,
    });
    expect(summary.resolvedByFrontier).toBe(0);
    expect(summary.frontierHints).toBe(1);
    expect(decisions.some((d: { auto: string }) => d.auto === "frontier")).toBe(false);
    expect(proposals[0]).toMatchObject({ caseKey: "new00000:zzzz", chosenKey: "none" });
  });

  it("does NOT call the frontier model when --frontier is off (default)", async () => {
    const { propose, calls } = proposer(goodKey);
    const { summary, proposals } = await runAutoCurate({ data: baseData(), commits, haveKey: true, propose });
    expect(calls).not.toContain("test-frontier");
    expect(summary.resolvedByFrontier).toBe(0);
    expect(proposals).toHaveLength(0);
  });

  it("honours --frontier-limit, leaving the overflow for a human", async () => {
    const d = baseData();
    d.nodes["new00000:yyyy"] = { title: "subj2", content: subjC + " and a second variant for shingles" };
    d.nodes["old00000:bbbb2222"] = { title: "cand2", content: "another wholly unrelated older candidate body" };
    d.cases.push({
      key: "new00000:yyyy", kind: "tier-3", newerSha: "new00000", olderSha: "old00000",
      subjectKey: "new00000:yyyy", autoKey: "old00000:bbbb2222", candidates: [{ key: "old00000:bbbb2222", score: 0.92 }],
    });
    const { propose, calls } = proposer(goodKey);
    const { summary } = await runAutoCurate({
      data: d, commits, haveKey: true, frontier: true, frontierLimit: 1, frontierModel: "test-frontier", propose,
    });
    expect(calls.filter((m) => m === "test-frontier")).toHaveLength(1); // capped at 1
    expect(summary.frontier.eligible).toBe(2);
    expect(summary.frontier.limited).toBe(1);
  });

  it("routes a >0.95-confident case to the frontier when the cheap LLM disagreed (T3)", async () => {
    const d = baseData();
    d.cases[0].candidates = [{ key: goodKey, score: 0.98 }]; // T1 (conf<0.95) does NOT fire
    const calls: string[] = [];
    // cheap returns a phantom (≠ autoKey, ≠ none) → T3 makes it eligible; frontier picks autoKey
    const propose = async (_s: unknown, _c: unknown, opts?: { model?: string }) => {
      calls.push(opts?.model ?? "cheap");
      return opts?.model ? { chosenKey: goodKey, why: "f" } : { chosenKey: "ghost00:dead", why: "cheap disagrees" };
    };
    const { summary, decisions } = await runAutoCurate({
      data: d, commits, haveKey: true, frontier: true, frontierModel: "test-frontier", propose,
    });
    expect(calls).toContain("test-frontier"); // T3 routed it despite 0.98 confidence
    expect(summary.resolvedByFrontier).toBe(1);
    expect(decisions.find((x: { auto: string; corroborator?: string }) => x.auto === "frontier")?.corroborator).toBe("matcher");
  });

  it("reuses cached cheap + frontier results without re-asking (resume)", async () => {
    const calls: string[] = [];
    const propose = async (_s: unknown, _c: unknown, opts?: { model?: string }) => {
      calls.push(opts?.model ?? "cheap");
      return { chosenKey: "x", why: "" };
    };
    const cache = new Map<string, { chosenKey: string; why: string; model: string }>([
      ["cheap|new00000:zzzz", { chosenKey: "none", why: "c", model: "test-cheap" }],
      ["frontier|new00000:zzzz", { chosenKey: goodKey, why: "f", model: "test-frontier" }],
    ]);
    const { summary, decisions } = await runAutoCurate({
      data: baseData(), commits, haveKey: true, frontier: true,
      frontierModel: "test-frontier", cheapModel: "test-cheap", cache, propose,
    });
    expect(calls).toHaveLength(0); // both passes served from cache — nothing re-asked
    expect(summary.llmCached).toBe(1);
    expect(summary.frontierCached).toBe(1);
    expect(summary.resolvedByFrontier).toBe(1);
    expect(decisions.find((d: { auto: string; corroborator?: string }) => d.auto === "frontier")?.corroborator).toBe("matcher");
  });

  it("a capped run caches its asks; a second run continues where it left off (accumulate)", async () => {
    const d = baseData();
    d.nodes["new00000:yyyy"] = { title: "subj2", content: subjC + " and a second variant for shingles" };
    d.nodes["old00000:bbbb2222"] = { title: "cand2", content: "another wholly unrelated older candidate body" };
    d.cases.push({
      key: "new00000:yyyy", kind: "tier-3", newerSha: "new00000", olderSha: "old00000",
      subjectKey: "new00000:yyyy", autoKey: "old00000:bbbb2222", candidates: [{ key: "old00000:bbbb2222", score: 0.92 }],
    });
    const cache = new Map();
    const mkRun = () => {
      const calls: string[] = [];
      const propose = async (_s: unknown, _c: unknown, opts?: { model?: string }) => {
        calls.push(opts?.model ?? "cheap");
        return opts?.model ? { chosenKey: goodKey, why: "f" } : { chosenKey: "none", why: "c" };
      };
      return { propose, calls };
    };
    const r1 = mkRun();
    const s1 = (await runAutoCurate({
      data: d, commits, haveKey: true, frontier: true, frontierLimit: 1,
      frontierModel: "test-frontier", cheapModel: "test-cheap", cache, propose: r1.propose,
    })).summary;
    expect(r1.calls.filter((m) => m === "cheap")).toHaveLength(2); // both cheap asked first run
    expect(s1.frontier.considered).toBe(1); // one new frontier ask (capped)
    expect(s1.frontier.limited).toBe(1); // one frontier case left for next time

    const r2 = mkRun();
    const s2 = (await runAutoCurate({
      data: d, commits, haveKey: true, frontier: true, frontierLimit: 1,
      frontierModel: "test-frontier", cheapModel: "test-cheap", cache, propose: r2.propose,
    })).summary;
    expect(r2.calls.filter((m) => m === "cheap")).toHaveLength(0); // cheap fully cached → no re-spend
    expect(s2.frontier.cached).toBe(1); // first frontier case reused from the cache
    expect(s2.frontier.considered).toBe(1); // the SECOND case asked this run
    expect(r2.calls.filter((m) => m === "test-frontier")).toHaveLength(1);
  });
});
