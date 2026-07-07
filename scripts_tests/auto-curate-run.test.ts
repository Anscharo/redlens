// Orchestration of the two auto-resolution passes (plan §10.4), driven with a STUB
// proposer + hand-built commits so it runs offline. Verifies pass 1 (forward∩reverse)
// locks a corroborated case, pass 2 (LLM∩matcher) locks only on agreement, and --no-llm
// leaves the eligible cases for a human.
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
// @ts-expect-error — .mjs without types
import { runAutoCurate } from "../scripts/htmlhist/auto-curate-run.mjs";

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
    } as Record<string, { title: string; content: string }>,
    cases: [{
      key: "new00000:zzzz", kind: "tier-3", newerSha: "new00000", olderSha: "old00000",
      subjectKey: "new00000:zzzz", autoKey: goodKey, candidates: [{ key: goodKey, score: 0.92 }],
    }],
  });
  // stub: the cheap pass (model ≠ the frontier model) DECLINES so the case stays residual; the
  // frontier pass (opts.model === the frontier model) answers `frontierPick`. Distinguishes the
  // two passes by the model VALUE, not presence — pass 2 now also carries a (cheap) model.
  const proposer = (frontierPick: string) => {
    const calls: string[] = [];
    const propose = async (_s: unknown, _c: unknown, opts?: { model?: string }) => {
      const isFrontier = opts?.model === "test-frontier";
      calls.push(isFrontier ? "test-frontier" : "cheap");
      return isFrontier ? { chosenKey: frontierPick, why: "frontier" } : { chosenKey: "none", why: "cheap declines" };
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
      const isFrontier = opts?.model === "test-frontier";
      calls.push(isFrontier ? "test-frontier" : "cheap");
      return isFrontier ? { chosenKey: goodKey, why: "f" } : { chosenKey: "ghost00:dead", why: "cheap disagrees" };
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
      calls.push(opts?.model === "test-frontier" ? "test-frontier" : "cheap");
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
        const isFrontier = opts?.model === "test-frontier";
        calls.push(isFrontier ? "test-frontier" : "cheap");
        return isFrontier ? { chosenKey: goodKey, why: "f" } : { chosenKey: "none", why: "c" };
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

describe("runAutoCurate — pass 1.7 (cluster joint assignment)", () => {
  // Two residual cases sharing candidates cX/cY → one multi-cluster. The matcher wrongly picks cX
  // for BOTH (the mutual-exclusion failure the cluster pass fixes). Subjects/candidates use shas
  // absent from `commits`, so forward can't link and containment can't hit → they reach pass 1.7.
  const s1 = "new11111:aaaa", s2 = "new11111:bbbb", cX = "old11111:xxxx", cY = "old11111:yyyy";
  const clusterData = () => ({
    meta: {},
    nodes: {
      [s1]: { title: "Rate Limits", content: "subject one body distinct enough to dodge containment alpha" },
      [s2]: { title: "Rate Limits", content: "subject two body distinct enough to dodge containment beta" },
      [cX]: { title: "Rate Limits", content: "candidate ex body unrelated gamma" },
      [cY]: { title: "Rate Limits", content: "candidate why body unrelated delta" },
    },
    cases: [
      { key: s1, kind: "tier-3", newerSha: "new11111", olderSha: "old11111", subjectKey: s1, autoKey: cX, candidates: [{ key: cX, score: 0.95 }, { key: cY, score: 0.6 }] },
      { key: s2, kind: "tier-3", newerSha: "new11111", olderSha: "old11111", subjectKey: s2, autoKey: cX, candidates: [{ key: cX, score: 0.95 }, { key: cY, score: 0.6 }] },
    ],
  });
  const MODELS = ["fam-a", "fam-b"];

  it("locks each subject when both families agree on a conflict-free assignment", async () => {
    let asked = 0;
    // both families (called once each) return the SAME conflict-free distribution s1→cX, s2→cY
    const proposeCluster = async () => ({ assignments: [{ subjectKey: s1, chosenKey: cX, why: "ex→s1" }, { subjectKey: s2, chosenKey: cY, why: "why→s2" }], conflicts: 0, missing: 0 });
    const { decisions, summary } = await runAutoCurate({
      data: clusterData(), commits, haveKey: true, cluster: true, clusterModels: MODELS,
      proposeCluster, propose: async () => (asked++, { chosenKey: "x", why: "" }),
    });
    expect(summary.resolvedByCluster).toBe(2);
    expect(decisions.every((d: { auto: string }) => d.auto === "cluster")).toBe(true);
    expect(decisions.find((d: { caseKey: string }) => d.caseKey === s1)).toMatchObject({ chosenKey: cX, corroborator: "family-agreement" });
    expect(decisions.find((d: { caseKey: string }) => d.caseKey === s2)?.chosenKey).toBe(cY);
    expect(asked).toBe(0); // cluster members never reach the per-doc pass 2
  });

  it("leaves a subject residual (and OFF pass 2) when the families disagree", async () => {
    let asked = 0;
    // family A: s1→cX,s2→cY ; family B swaps them → disagreement on both subjects
    const proposeCluster = async (_s: unknown, _c: unknown, opts: { model?: string }) => {
      const a = opts.model === "fam-a";
      return { assignments: [{ subjectKey: s1, chosenKey: a ? cX : cY, why: "" }, { subjectKey: s2, chosenKey: a ? cY : cX, why: "" }], conflicts: 0, missing: 0 };
    };
    const { summary } = await runAutoCurate({
      data: clusterData(), commits, haveKey: true, cluster: true, clusterModels: MODELS,
      proposeCluster, propose: async () => (asked++, { chosenKey: "x", why: "" }),
    });
    expect(summary.resolvedByCluster).toBe(0);
    expect(summary.clusterDisagreed).toBe(2);
    expect(summary.resolved).toBe(0); // stays for the frontier / a human
    expect(asked).toBe(0); // NOT downgraded to the per-doc pass 2
  });

  it("blocks a lock when two agreed subjects claim the same candidate (conflict guard)", async () => {
    // both families agree but assign BOTH subjects to cX → global conflict → neither locks
    const proposeCluster = async () => ({ assignments: [{ subjectKey: s1, chosenKey: cX, why: "" }, { subjectKey: s2, chosenKey: cX, why: "" }], conflicts: 0, missing: 0 });
    const { summary } = await runAutoCurate({
      data: clusterData(), commits, haveKey: true, cluster: true, clusterModels: MODELS,
      proposeCluster, propose: async () => ({ chosenKey: "x", why: "" }),
    });
    expect(summary.resolvedByCluster).toBe(0);
    expect(summary.cluster.conflicts).toBe(2);
  });

  it("decomposes an OVERSIZED cluster into position-ordered windows and removes locked candidates between them", async () => {
    // 4 dense-blob subjects each listing all 4 candidates; maxSize 2 → oversized → windowed (W=2).
    const ws = ["w:1", "w:2", "w:3", "w:4"], wc = ["o:1", "o:2", "o:3", "o:4"];
    const map: Record<string, string> = { "w:1": "o:1", "w:2": "o:2", "w:3": "o:3", "w:4": "o:4" };
    const windowedData = () => ({
      meta: {},
      nodes: Object.fromEntries([...ws, ...wc].map((k) => [k, { title: "Blob", content: `body ${k} distinct enough to dodge containment` }])),
      cases: ws.map((k, i) => ({ key: k, kind: "tier-3", newerSha: "nw", olderSha: "ow", subjectKey: k, subjectOrder: i, autoKey: "o:1", candidates: wc.map((c) => ({ key: c, score: 0.6 })) })),
    });
    const seenCands: string[][] = [];
    const proposeCluster = async (subjects: { key: string }[], candidates: { key: string }[]) => {
      seenCands.push(candidates.map((c) => c.key).sort());
      return { assignments: subjects.map((s) => ({ subjectKey: s.key, chosenKey: map[s.key], why: "" })), conflicts: 0, missing: 0 };
    };
    const { summary, decisions } = await runAutoCurate({
      data: windowedData(), commits, haveKey: true, cluster: true, clusterModels: MODELS, clusterMaxSize: 2,
      proposeCluster, propose: async () => ({ chosenKey: "x", why: "" }),
    });
    expect(summary.clusterWindowed).toBe(1); // the 4-subject cluster was windowed
    expect(summary.resolvedByCluster).toBe(4); // every subject locked across the windows
    expect(decisions.filter((d: { auto: string }) => d.auto === "cluster")).toHaveLength(4);
    // removal worked: a later window was offered a REDUCED candidate pool (o:1/o:2 already used)
    expect(seenCands.some((cs) => cs.length < 4)).toBe(true);
  });

  it("does not cluster a singleton — it falls through to the per-doc pass 2", async () => {
    let clusterCalled = 0, asked = 0;
    const single = {
      meta: {}, nodes: { "new1:a": { title: "z", content: "zzz body" }, "old1:b": { title: "z", content: "qqq body" } },
      cases: [{ key: "new1:a", kind: "tier-3", newerSha: "new1", olderSha: "old1", subjectKey: "new1:a", autoKey: "old1:b", candidates: [{ key: "old1:b", score: 0.95 }] }],
    };
    const { summary } = await runAutoCurate({
      data: single, commits, haveKey: true, cluster: true, clusterModels: MODELS,
      proposeCluster: async () => (clusterCalled++, { assignments: [], conflicts: 0, missing: 0 }),
      propose: async () => (asked++, { chosenKey: "old1:b", why: "" }),
    });
    expect(clusterCalled).toBe(0); // size-1 component → not a cluster
    expect(asked).toBe(1); // handled by the per-doc pass 2
    expect(summary.resolvedByLlm).toBe(1);
  });
});

describe("runAutoCurate — pass 0 (bijection narrowed to obvious cases)", () => {
  // Two identical-content md docs, EXACT match on ONE uncontended html boilerplate with two
  // occurrences → the forced case: deterministic 1:1 by document order (order 0 → #0, order 1 → #1).
  it("locks an EXACT, UNCONTENDED identical-stub group 1:1 by order", async () => {
    const d = {
      meta: {},
      nodes: {
        "mig00000:s0": { title: "Boiler", content: "shared boilerplate body identical across scopes" },
        "mig00000:s1": { title: "Boiler", content: "shared boilerplate body identical across scopes" },
        "old00000:hhhh#0": { title: "Boiler", content: "old boiler" },
        "old00000:hhhh#1": { title: "Boiler", content: "old boiler" },
      },
      cases: [
        { key: "mig00000:s0", kind: "seed-close", newerSha: "mig00000", olderSha: "old00000", subjectKey: "mig00000:s0", subjectOrder: 0, autoKey: "old00000:hhhh#0", candidates: [{ key: "old00000:hhhh#0", score: 1 }, { key: "old00000:hhhh#1", score: 1 }] },
        { key: "mig00000:s1", kind: "seed-close", newerSha: "mig00000", olderSha: "old00000", subjectKey: "mig00000:s1", subjectOrder: 1, autoKey: "old00000:hhhh#0", candidates: [{ key: "old00000:hhhh#0", score: 1 }, { key: "old00000:hhhh#1", score: 1 }] },
      ],
    };
    const { decisions, summary } = await runAutoCurate({ data: d, commits, haveKey: true });
    expect(summary.resolvedByBijection).toBe(2);
    expect(decisions.find((x: { caseKey: string }) => x.caseKey === "mig00000:s0")).toMatchObject({ chosenKey: "old00000:hhhh#0", auto: "bijection" });
    expect(decisions.find((x: { caseKey: string }) => x.caseKey === "mig00000:s1")?.chosenKey).toBe("old00000:hhhh#1"); // NOT double-booked onto #0
  });

  // Two DIFFERENT-content md groups both top-match the SAME boilerplate (contention). The old order
  // heuristic double-booked #0; now they are DEFERRED past bijection and handled by the cluster decider.
  it("defers a CONTENDED shared-boilerplate set to the cluster pass (not bijection)", async () => {
    const occ = ["old00000:shared#0", "old00000:shared#1", "old00000:shared#2", "old00000:shared#3"];
    const cand = occ.map((key) => ({ key, score: 1 }));
    const nodes: Record<string, { title: string; content: string }> = {
      "mig00000:x0": { title: "Tmpl", content: "group A body one flavour" },
      "mig00000:x1": { title: "Tmpl", content: "group A body one flavour" },
      "mig00000:y0": { title: "Tmpl", content: "group B body other flavour" },
      "mig00000:y1": { title: "Tmpl", content: "group B body other flavour" },
    };
    for (const k of occ) nodes[k] = { title: "Tmpl", content: "old template row" };
    const mk = (key: string, order: number) => ({ key, kind: "seed-close", newerSha: "mig00000", olderSha: "old00000", subjectKey: key, subjectOrder: order, autoKey: occ[0], candidates: cand });
    const d = { meta: {}, nodes, cases: [mk("mig00000:x0", 0), mk("mig00000:x1", 1), mk("mig00000:y0", 2), mk("mig00000:y1", 3)] };
    const assign: Record<string, string> = { "mig00000:x0": occ[0], "mig00000:x1": occ[1], "mig00000:y0": occ[2], "mig00000:y1": occ[3] };
    const proposeCluster = async (subjects: { key: string }[]) => ({ assignments: subjects.map((s) => ({ subjectKey: s.key, chosenKey: assign[s.key], why: "" })), conflicts: 0, missing: 0 });
    const { decisions, summary } = await runAutoCurate({
      data: d, commits, haveKey: true, cluster: true, clusterModels: ["fam-a", "fam-b"], proposeCluster,
      propose: async () => ({ chosenKey: "x", why: "" }),
    });
    expect(summary.resolvedByBijection).toBe(0); // NOT grabbed deterministically
    expect(summary.resolvedByCluster).toBe(4); // routed to the AI decider, distributed 1:1
    expect(new Set(decisions.map((x: { chosenKey: string }) => x.chosenKey)).size).toBe(4); // four distinct occurrences — no double-book
  });
});

describe("runAutoCurate — pass 1.6 (positional∩signal)", () => {
  // Two byte-similar sibling candidates that content signals can't separate ("Review" under
  // Spark vs under Grove); only the STRUCTURAL signal (subject.parentTitle vs candidate
  // ancestors) distinguishes them. Shas absent from `commits` so forward can't link; contents
  // are mutually non-containing so containment can't lock → the case reaches pass 1.6.
  const nbr = { "p:init": { title: "Initial Planning", content: "x" }, "p:data": { title: "Data Repository", content: "y" }, "p:foo": { title: "Foo", content: "z" }, "p:bar": { title: "Bar", content: "w" } };
  const positionalData = (autoKey: string | null) => ({
    meta: {},
    nodes: {
      ...nbr,
      "pn:subj": { title: "Review", content: "subject review body one alpha", parentTitle: "Spark", prev: ["p:init"], next: ["p:data"] },
      "po:spark": { title: "Review", content: "candidate review body two beta", ancestors: ["Spark"], section: "DB", prev: ["p:init"], next: ["p:data"] },
      "po:grove": { title: "Review", content: "candidate review body three gamma", ancestors: ["Grove"], section: "DB", prev: ["p:foo"], next: ["p:bar"] },
    },
    cases: [{
      key: "pn:subj", kind: "seed-close", newerSha: "pn", olderSha: "po",
      subjectKey: "pn:subj", autoKey, subjectOrder: 0,
      candidates: [{ key: "po:spark", score: 1 }, { key: "po:grove", score: 1 }],
    }],
  });

  it("locks the ancestor-matching sibling when positional agrees with the matcher", async () => {
    let asked = 0;
    const { decisions, summary } = await runAutoCurate({
      data: positionalData("po:spark"), commits, haveKey: true, propose: async () => (asked++, { chosenKey: "x", why: "" }),
    });
    expect(summary.resolvedByPositional).toBe(1);
    const d = decisions.find((x: { auto: string }) => x.auto === "positional");
    expect(d).toMatchObject({ chosenKey: "po:spark" }); // the Spark ancestor, not Grove
    expect(d.corroborator).toBeTruthy();
    expect(asked).toBe(0); // deterministic lock — never reached the LLM
  });

  it("--no-positional disables pass 1.6", async () => {
    const { summary } = await runAutoCurate({
      data: positionalData("po:spark"), commits, haveKey: true, positional: false,
      propose: async () => ({ chosenKey: "po:spark", why: "" }),
    });
    expect(summary.resolvedByPositional).toBe(0);
    expect(summary.resolvedByLlm).toBe(1); // falls through to the LLM instead
  });

  it("emits an advisory HINT (no lock) for a matcher-null case when P1 and P2 self-corroborate", async () => {
    // containment off so there is genuinely NO content signal to corroborate against — the
    // only path left is the self-corroborated advisory hint (P1 ancestor + P2 neighbour agree).
    const { decisions, proposals, summary } = await runAutoCurate({
      data: positionalData(null), commits, haveKey: true, noLlm: true, containment: false, propose: async () => ({ chosenKey: "x", why: "" }),
    });
    expect(summary.resolvedByPositional).toBe(0); // no matcher pick to corroborate → not locked
    expect(summary.resolved).toBe(0);
    expect(summary.positionalHints).toBe(1);
    expect(decisions.some((d: { auto: string }) => d.auto === "positional")).toBe(false);
    expect(proposals.find((p: { caseKey: string }) => p.caseKey === "pn:subj")).toMatchObject({ chosenKey: "po:spark", via: "positional" });
  });
});

describe("runAutoCurate — mutual-exclusion conflict sweep", () => {
  it("demotes a cross-case double-book to residual and keeps the invariant", async () => {
    // two different newer docs whose matcher BOTH collapses onto one older occurrence; the LLM agrees
    // with each → both would lock (llm-90) on the same chosenKey. The sweep keeps one, demotes the other.
    const dup = {
      meta: {},
      nodes: {
        "n1:p": { title: "P", content: "subject paragraph p wordy enough to avoid containment collapse now" },
        "n1:q": { title: "Q", content: "subject paragraph q wordy enough to avoid containment collapse now" },
        "old00000:zzzz": { title: "Z", content: "an unrelated older candidate body neither subject contains at all" },
      },
      cases: [
        { key: "n1:p", kind: "tier-3", newerSha: "n1", olderSha: "old00000", subjectKey: "n1:p", autoKey: "old00000:zzzz", candidates: [{ key: "old00000:zzzz", score: 0.96 }] },
        { key: "n1:q", kind: "tier-3", newerSha: "n1", olderSha: "old00000", subjectKey: "n1:q", autoKey: "old00000:zzzz", candidates: [{ key: "old00000:zzzz", score: 0.96 }] },
      ],
    };
    const { decisions, summary } = await runAutoCurate({
      data: dup, commits, haveKey: true, propose: async () => ({ chosenKey: "old00000:zzzz", why: "" }),
    });
    expect(summary.conflictsDemoted).toBe(1);
    expect(summary.resolved).toBe(1); // only one survives the sweep
    expect(decisions).toHaveLength(1);
    const claimed = decisions.filter((d: { chosenKey: string }) => d.chosenKey === "old00000:zzzz");
    expect(claimed).toHaveLength(1); // the occurrence is claimed exactly once
  });
});
