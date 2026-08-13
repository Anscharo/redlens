// Orchestrator for the two HTML-era auto-resolution passes (plan §10.4). Separated
// from the pure rules (auto-curate.mjs) and from IO/CLI (the aux scripts) so it can be
// reused by BOTH entry points — the standalone `auto-curate-html-history.mjs` and the
// combined `build-history-curation.mjs --auto` — and unit-tested with a stub proposer.
//
// It performs NO file/git IO and imports no LLM client: the caller injects `propose`
// (the LLM proposer) and `log`, and passes the already-loaded `commits` so the slow
// turndown isn't repeated when the curation queue build already has them in memory.

import { forwardLinks } from "./history-forward-trace.mjs";
import {
  forwardAgrees, llmEligible, llmConfirms, LLM_CONFIRM_THRESHOLD,
  frontierTriggers, frontierCorroborator,
} from "./auto-curate.mjs";
import { bestByContainment } from "../lib/ordered-containment.mjs";
import { positionalPick, positionalSelfCorroborates } from "./history-positional.mjs";
import { buildClaimIndex, enrichSubject, enrichCandidates } from "./curate-context.mjs";
import { buildClusters } from "./curate-clusters.mjs";

// Run pass 1 (forward∩reverse, deterministic), pass 1.5 (reverse∩containment), pass 2
// (LLM∩matcher, ≥threshold, opt-in), then pass 3 (frontier-model escalation on the uncertain
// residual, opt-in) over a curation queue. Returns { decisions, proposals, summary, residual }.
//   data     — the curation artifact ({ meta, nodes, cases })
//   commits  — loaded HTML commits oldest→newest, nodes carrying contentHash
//   propose  — async (subject, candidates, opts?) => { chosenKey, why } (the LLM proposer;
//              opts.model lets pass 3 route to the frontier model)
//   haveKey  — whether an LLM key is configured (gates passes 2 & 3)
export async function runAutoCurate({
  data, commits, propose, haveKey = false,
  noLlm = false, limit = Infinity, threshold = LLM_CONFIRM_THRESHOLD, concurrency = 5,
  containment = true, containThreshold = 0.7, containMargin = 0.15,
  positional = true,
  cluster = false, proposeCluster = null, clusterModels = [], clusterMaxSize = 12, clusterConcurrency = 4, clusterMaxSweeps = 4,
  frontier = false, frontierModel = null, frontierLimit = Infinity, frontierConcurrency = 3,
  cache = new Map(), cheapModel = null,
  log = () => {},
}) {
  const cases = data.cases || [];
  const claimIndex = buildClaimIndex(cases); // sole-home signal for the LLM (curate-context)
  // per-commit change description (PR title + forum edit-list) keyed by the newer sha, for the LLM.
  const changeBySha = new Map();
  for (const c of data.commits || []) if (c.prTitle || c.changeSummary) changeBySha.set(c.sha, { pr: c.pr, title: c.prTitle, summary: c.changeSummary });
  const links = forwardLinks(commits);
  const decisions = [];
  // resume cache (plan §10.4): prior LLM/frontier asks keyed `${pass}|${caseKey}` → {chosenKey,
  // why, model}. A capped run REUSES earlier results (no re-spend) and spends the cap only on
  // NEW cases, so the frontier can be completed in batches across sessions/deploys. Mutated in
  // place + returned for the caller to persist. Per-entry model → a model change re-asks; the
  // caseKey is content-addressed, so the cache stays valid as long as the queue is unchanged.
  const ckey = (pass, caseKey) => `${pass}|${caseKey}`;
  const cacheGet = (pass, caseKey, model) => { const c = cache.get(ckey(pass, caseKey)); return c && c.model === model ? c : null; };
  const cacheSet = (pass, caseKey, chosenKey, why, model) => cache.set(ckey(pass, caseKey), { chosenKey, why, model });
  const record = (kase, chosenKey, via, why, extra) => decisions.push({
    caseKey: kase.key, kind: kase.kind, subjectKey: kase.subjectKey,
    newerSha: kase.newerSha, olderSha: kase.olderSha,
    chosenKey, agreedWithAuto: chosenKey === kase.autoKey, auto: via,
    ...(why ? { why } : {}), ...(extra || {}),
  });
  // candidate keys (content) for a case, in display/score order — used by containment.
  const candContents = (kase) =>
    (kase.candidates || []).map((c) => ({ key: c.key, content: data.nodes[c.key]?.content ?? "" })).filter((c) => c.content);
  const containBestKey = (kase) => {
    if (!kase.candidates?.length) return null;
    const { best } = bestByContainment(data.nodes[kase.subjectKey]?.content ?? "", candContents(kase));
    return best?.key ?? null;
  };
  const cheapPicks = new Map(); // caseKey -> the cheap LLM's pick (pass 2), for T3

  // pass 1 — lock every case the independent forward pass corroborates.
  // pass 1.5 — reverse∩containment: an INDEPENDENT, order-sensitive, typo-tolerant match
  //   (ordered-containment.mjs, ported from the UUID-swap detector) that ALSO lands on the
  //   matcher's autoKey with a clear margin over the runner-up. Different failure modes from
  //   shingle-Jaccard, so the agreement is real corroboration — and, unlike the forward pass,
  //   it reaches across the #117 seed seam. Deterministic + free, so it runs before the LLM.
  //   The remaining ≥threshold-confident cases go to the (optional) LLM cross-check.
  // pass 0 — bijection: N byte-identical md docs that share ONE html predecessor duplicate-group
  // (the same element used in N scopes, e.g. "Ambiguity" in Governance + Support; or a boilerplate
  // doc repeated per process). #117 was a reformat, not a content addition, so each md doc almost
  // certainly HAD an html predecessor — but identical content collapses them to one identity and
  // drops the rest's history. The html rows in the group are identical and share one history, so any
  // 1:1 assignment reconstructs identically; what matters is that they map one-to-one. Assign md docs
  // (by document order) to the M identical html occurrences (by order) when N ≤ M. N > M would need
  // #117 to have ADDED docs — unlikely — so those defer to review.
  const bijectionDone = new Set();
  let bijResolved = 0, splitResolved = 0, bijDeferred = 0;
  {
    const mdGroups = new Map(); // md content -> its seed cases
    for (const kase of cases) {
      if (kase.kind !== "seed-close") continue;
      const content = data.nodes[kase.subjectKey]?.content;
      if (!content) continue;
      let g = mdGroups.get(content); if (!g) mdGroups.set(content, (g = [])); g.push(kase);
    }
    // Resolve each qualifying group's best-match html content (addr) UP FRONT, then detect CONTENTION:
    // an addr that is the top match for >1 distinct md-content group means DIFFERENT documents compete
    // for the same occurrences — a joint-assignment problem the per-group order heuristic gets WRONG
    // (each group independently grabs occ #0, double-booking it: measured 31 collisions). Determinism
    // is trustworthy ONLY for the FORCED case: an EXACT content match (score ≈ 1.0) on an UNCONTENDED
    // addr, where the N identical md docs map 1:1 to the M identical html occurrences with no rival
    // claimant. CONTENDED or FUZZY groups are left UNRESOLVED so the richer passes decide — the cluster
    // pass does mutual-exclusion joint assignment over exactly these shared-candidate siblings (they
    // connect into one cluster), then LLM/frontier. Determinism claims the obvious; the AI decides the
    // ambiguous. N>M within a forced group still SPLITS the extras (created-at-#117): only M existed.
    const EXACT = 0.999;
    const qualifying = []; // { groupCases, addr, exact }
    const addrGroups = new Map(); // addr -> # of distinct md-content groups that top-match it
    for (const [, groupCases] of mdGroups) {
      if (groupCases.length < 2) continue; // a single md doc → an ordinary case
      const top = (groupCases[0].candidates || [])[0];
      if (!top || (top.score ?? 0) < 0.5) continue; // no confident content match → leave for review
      const addr = top.key.split("#")[0];
      qualifying.push({ groupCases, addr, exact: (top.score ?? 0) >= EXACT });
      addrGroups.set(addr, (addrGroups.get(addr) || 0) + 1);
    }
    for (const { groupCases, addr, exact } of qualifying) {
      if (!exact || (addrGroups.get(addr) || 0) > 1) { bijDeferred += groupCases.length; continue; } // ambiguous → richer passes
      const occKeys = [...new Set(groupCases.flatMap((k) => (k.candidates || []).filter((c) => c.key.split("#")[0] === addr).map((c) => c.key)))].sort();
      groupCases.slice()
        .sort((a, b) => (a.subjectOrder ?? 0) - (b.subjectOrder ?? 0) || a.key.localeCompare(b.key))
        .forEach((kase, i) => {
          if (i < occKeys.length) { record(kase, occKeys[i], "bijection"); bijResolved++; }
          else { record(kase, "none", "split"); splitResolved++; }
          bijectionDone.add(kase.key);
        });
    }
    if (bijResolved || splitResolved || bijDeferred)
      log(`pass 0 (bijection + split): ${bijResolved} identical docs threaded 1:1 · ${splitResolved} split copies marked created-at-#117${bijDeferred ? ` · ${bijDeferred} contended/fuzzy → richer passes` : ""}`);
  }

  // pass 1.6 — positional∩{matcher,forward,containment}: an INDEPENDENT structural signal
  //   (ancestry + neighbour-title + reference overlap; history-positional.mjs) that reads a
  //   doc's POSITION, not its body, so it's strongest exactly where the three content passes
  //   are blind — near-identical siblings. It only LOCKS when its pick lines up with an
  //   existing content signal (matcher/forward/containment via frontierCorroborator), so it
  //   stays within the two-independent-signals invariant. Deterministic + free → runs with
  //   the other deterministic passes, before the LLM. Measured ~0 genuinely-wrong-document
  //   locks on the resolved pool; its incremental value is cases forward/containment miss.
  const llmQueue = [];
  let fwdResolved = 0, containResolved = 0, posResolved = 0;
  for (const kase of cases) {
    if (bijectionDone.has(kase.key)) continue; // already assigned by the bijection pass
    const fwd = links.get(kase.key) ?? null;
    if (forwardAgrees(kase, fwd)) { record(kase, kase.autoKey, "forward-reverse"); fwdResolved++; continue; }
    // compute the containment best ONCE — reused by the containment lock (score/margin-gated
    // on the matcher's autoKey) and, unconditionally, as a positional corroborator.
    const contain = containment ? bestByContainment(data.nodes[kase.subjectKey]?.content ?? "", candContents(kase)) : null;
    if (contain?.best && kase.autoKey && contain.best.key === kase.autoKey && contain.bestScore >= containThreshold && contain.margin >= containMargin) {
      record(kase, kase.autoKey, "containment"); containResolved++; continue;
    }
    if (positional) {
      const pick = positionalPick(data.nodes[kase.subjectKey], (kase.candidates || []).map((c) => c.key), data.nodes);
      const corr = pick && frontierCorroborator(pick.chosenKey, { autoKey: kase.autoKey, fwdKey: fwd, containKey: contain?.best?.key ?? null });
      if (corr) { record(kase, pick.chosenKey, "positional", "", { corroborator: corr }); posResolved++; continue; }
    }
    if (llmEligible(kase, threshold)) llmQueue.push(kase); // counted regardless; --no-llm just won't ask
  }
  log(`pass 1 (forward∩reverse): ${fwdResolved} locked${containment ? `  ·  pass 1.5 (reverse∩containment): ${containResolved} locked` : ""}${positional ? `  ·  pass 1.6 (positional∩signal): ${posResolved} locked` : ""}  ·  ${llmQueue.length} ≥${threshold}-confident left for the LLM`);

  // pass 1.7 — CLUSTER (matrix) joint assignment. The per-doc LLM (pass 2) judges each case
  // alone, so it can't honour "one older row is the predecessor of AT MOST ONE newer row";
  // near-identical siblings that share candidates get collapsed onto the same predecessor (a
  // matcher failure we measured: e.g. 9 identical "Rate Limits" docs all mapped to one occurrence).
  // This groups the residual into CLUSTERS (connected components of the subject↔candidate graph)
  // and assigns each JOINTLY under mutual-exclusion, LOCKING a subject only when TWO DIFFERENT-family
  // models AGREE and the pick is globally conflict-free — a stronger, more independent corroborator
  // than LLM∩matcher (the matcher is exactly what fails here). Disagreements stay residual (frontier/
  // human). OVERSIZED clusters (too many subjects for one prompt) are DECOMPOSED into position-ordered
  // subject WINDOWS: each window carries the candidate-complete union of its subjects' own candidates
  // (guarantees a subject never loses its true ancestor — no margin to tune) and locked candidates are
  // removed between sweeps (mutual-exclusion across windows); sweeps repeat until no new locks (loop-
  // until-dry). Cluster members are excluded from pass 2 — the per-doc weak signal shouldn't relock.
  const clusterMembers = new Set(); // every case in a multi-cluster — kept off pass 2
  const clu = { multiClusters: 0, windowed: 0, cases: 0, locked: 0, lockedNone: 0, disagreed: 0, conflicts: 0, errors: 0, cached: 0, models: cluster ? clusterModels : null };
  const cluKey = (model, anchor) => `cluster|${model}|${anchor}`;
  if (cluster && !noLlm && haveKey && proposeCluster && clusterModels.length >= 2) {
    const byKey = new Map(cases.map((c) => [c.key, c]));
    const doneNow = new Set(decisions.map((d) => d.caseKey));
    const claimed = new Set(decisions.filter((d) => d.chosenKey && d.chosenKey !== "none").map((d) => d.chosenKey));
    const { clusters } = buildClusters(cases, doneNow, claimed, { maxSize: clusterMaxSize });
    const multi = clusters.filter((c) => c.size >= 2);
    for (const cl of multi) for (const k of cl.caseKeys) clusterMembers.add(k);
    clu.multiClusters = multi.length;
    clu.windowed = multi.filter((c) => c.oversized).length;
    clu.cases = multi.reduce((s, c) => s + c.size, 0);
    log(`pass 1.7 (cluster ${clusterModels.join(" ∩ ")}): ${multi.length} multi-clusters, ${clu.cases} cases${clu.windowed ? `  ·  ${clu.windowed} oversized → windowed decomposition` : ""}…`);
    const occN = (k) => { const s = k.split("#")[1]; return s ? Number(s) : Number.POSITIVE_INFINITY; };

    // Resolve ONE window: run every family model (cached), reconcile to the subjects all models agree
    // on and no other agreed subject claims. Returns the locks (caller records + removes) + counters.
    // Never throws — a model error drops the window (its subjects stay residual for the frontier/human).
    const resolveWindow = async (subjKeys, candKeys, change) => {
      const subjects = subjKeys.map((k) => { const s = enrichSubject(byKey.get(k).subjectKey, data.nodes); return s ? { key: k, order: byKey.get(k).subjectOrder, ...s } : null; }).filter(Boolean);
      const candidates = enrichCandidates({ candidates: candKeys.map((key) => ({ key })) }, data.nodes, claimIndex);
      if (subjects.length < 1 || !candidates.length) return { locks: [], disagreed: 0, conflicts: 0 };
      const anchor = [...subjKeys].sort().join(","); // self-invalidating cache key: a changed window ⇒ miss
      const votes = new Map();
      try {
        for (const model of clusterModels) {
          const hit = cache.get(cluKey(model, anchor));
          let assignments;
          if (hit) { assignments = hit.assignments; clu.cached++; }
          else { assignments = (await proposeCluster(subjects, candidates, { model, change })).assignments; cache.set(cluKey(model, anchor), { model, assignments }); }
          for (const a of assignments) { const arr = votes.get(a.subjectKey) || []; arr.push(a.chosenKey); votes.set(a.subjectKey, arr); }
        }
      } catch (e) {
        clu.errors++;
        if (clu.errors <= 3) log(`  cluster error on ${subjKeys[0]}: ${String(e?.message || e).slice(0, 120)}`);
        return { locks: [], disagreed: 0, conflicts: 0 };
      }
      const agreed = [];
      let disagreed = 0;
      for (const [subjectKey, arr] of votes) {
        if (arr.length === clusterModels.length && arr.every((v) => v === arr[0])) agreed.push({ subjectKey, chosenKey: arr[0] });
        else disagreed++;
      }
      // conflict guard (defensive — each model self-dedupes, so within one window this ~never fires):
      const claimCount = new Map();
      for (const a of agreed) if (a.chosenKey !== "none") claimCount.set(a.chosenKey, (claimCount.get(a.chosenKey) || 0) + 1);
      const locks = []; let conflicts = 0;
      for (const a of agreed) {
        if (a.chosenKey !== "none" && claimCount.get(a.chosenKey) > 1) { conflicts++; continue; }
        locks.push(a);
      }
      return { locks, disagreed, conflicts };
    };

    const commitLocks = (locks) => {
      for (const a of locks) {
        record(byKey.get(a.subjectKey), a.chosenKey, "cluster", "", { corroborator: "family-agreement" });
        if (a.chosenKey === "none") clu.lockedNone++; else clu.locked++;
      }
    };

    await mapPool(multi, clusterConcurrency, async (cl) => {
      const change = changeBySha.get(byKey.get(cl.caseKeys[0]).newerSha);
      if (!cl.oversized) { // fits one prompt → assign whole
        const { locks, disagreed, conflicts } = await resolveWindow(cl.caseKeys, cl.candidateKeys, change);
        commitLocks(locks); clu.disagreed += disagreed; clu.conflicts += conflicts;
        return;
      }
      // oversized → position-ordered subject windows, candidate-complete per window, remove locked
      // candidates between sweeps, loop-until-dry (no new locks in a full sweep ⇒ the rest is residual).
      let remaining = cl.caseKeys.slice().sort((a, b) => (byKey.get(a).subjectOrder ?? 0) - (byKey.get(b).subjectOrder ?? 0) || a.localeCompare(b));
      const avail = new Set(cl.candidateKeys);
      const W = clusterMaxSize, MAX_SWEEPS = clusterMaxSweeps;
      for (let sweep = 0; sweep < MAX_SWEEPS && remaining.length; sweep++) {
        let progressed = false;
        const survivors = [];
        for (let i = 0; i < remaining.length; i += W) {
          const win = remaining.slice(i, i + W);
          // candidate-complete: the union of THIS window's subjects' own candidates, still available.
          const cand = [...new Set(win.flatMap((k) => (byKey.get(k).candidates || []).map((c) => c.key)).filter((k) => avail.has(k)))].sort((a, b) => occN(a) - occN(b) || a.localeCompare(b));
          const { locks, disagreed, conflicts } = await resolveWindow(win, cand, change);
          clu.conflicts += conflicts;
          const lockedSet = new Set(locks.map((l) => l.subjectKey));
          commitLocks(locks);
          for (const l of locks) if (l.chosenKey !== "none") avail.delete(l.chosenKey);
          if (locks.length) progressed = true;
          for (const k of win) if (!lockedSet.has(k)) survivors.push(k); // unlocked → retry next sweep (fewer candidates)
        }
        remaining = survivors;
        if (!progressed) break; // a full sweep locked nothing new → remaining is genuinely residual
      }
      clu.disagreed += remaining.length; // whatever survived every sweep stays for the frontier/human
    });
    log(`pass 1.7 (cluster): ${clu.locked} locked · ${clu.lockedNone} created-here · ${clu.disagreed} residual/disagreed · ${clu.conflicts} conflicts · ${clu.cached} cached · ${clu.errors} errors`);
  }

  // pass 2 — LLM second opinion on the eligible cases; lock the ones it independently
  // agrees with. Skipped (left for a human) when --no-llm or no key is configured. Multi-cluster
  // members are excluded — pass 1.7 owns them; if two families couldn't agree there, the weaker
  // per-doc signal shouldn't lock them either (they stay residual for the frontier / a human).
  const pass2Queue = llmQueue.filter((k) => !clusterMembers.has(k.key));
  const llm = { eligible: pass2Queue.length, considered: 0, cached: 0, confirmed: 0, disagreed: 0, limited: 0, errors: 0, threshold };
  // applying a cheap result: remember the pick for pass 3's T3, and lock on agreement.
  const applyCheap = (kase, chosenKey, why) => {
    cheapPicks.set(kase.key, chosenKey);
    if (llmConfirms(kase, chosenKey)) { record(kase, kase.autoKey, "llm-90", why); llm.confirmed++; }
    else llm.disagreed++;
  };
  if (noLlm) {
    log(`pass 2 skipped (--no-llm) — ${pass2Queue.length} LLM-eligible cases left for a human`);
    llm.limited = pass2Queue.length;
  } else if (!haveKey || !propose) {
    log("pass 2 skipped — no OpenRouter key configured (set OPENROUTER_API_KEY to run the LLM cross-check)");
    llm.limited = pass2Queue.length;
  } else {
    // reuse cached cheap results first; ask only the uncached, up to `limit`.
    const uncached = [];
    for (const kase of pass2Queue) {
      const c = cacheGet("cheap", kase.key, cheapModel);
      if (c) { applyCheap(kase, c.chosenKey, c.why); llm.cached++; } else uncached.push(kase);
    }
    const toAsk = uncached.slice(0, Number.isFinite(limit) ? limit : uncached.length);
    llm.limited = uncached.length - toAsk.length;
    log(`pass 2 (LLM∩matcher): ${llm.cached} cached · asking ${toAsk.length}/${uncached.length} new (concurrency ${concurrency})…`);
    let done = 0;
    await mapPool(toAsk, concurrency, async (kase) => {
      const subject = enrichSubject(kase.subjectKey, data.nodes);
      const candidates = enrichCandidates(kase, data.nodes, claimIndex);
      if (!subject || !candidates.length) return;
      llm.considered++;
      try {
        const { chosenKey, why } = await propose(subject, candidates, { model: cheapModel, change: changeBySha.get(kase.newerSha) });
        cacheSet("cheap", kase.key, chosenKey, why, cheapModel);
        applyCheap(kase, chosenKey, why);
      } catch (e) {
        llm.errors++;
        if (llm.errors <= 3) log(`  llm error on ${kase.key}: ${String(e?.message || e).slice(0, 120)}`);
      }
      if (++done % 25 === 0) log(`  …${done}/${toAsk.length} asked (${llm.confirmed} confirmed)`);
    });
    log(`pass 2 (LLM∩matcher): ${llm.confirmed} locked · ${llm.disagreed} disagreed · ${llm.cached} cached · ${llm.errors} errors`);
  }

  // pass 3 — frontier-model escalation on the UNCERTAIN residual (opt-in via `frontier`).
  // Route only trigger-matching cases (hardest-first, capped) to a stronger model; LOCK on
  // agreement with an independent signal (matcher/forward/containment), else record a HINT
  // the curation UI surfaces to the human. Never locks on the cheap LLM alone (not independent).
  const proposals = [];
  const front = { eligible: 0, considered: 0, cached: 0, locked: 0, hints: 0, errors: 0, limited: 0, model: frontier ? frontierModel : null };
  // applying a frontier result: lock on an independent corroborator, else record a hint.
  const applyFrontier = (kase, fwdKey, containKey, chosenKey, why) => {
    const corroborator = frontierCorroborator(chosenKey, { autoKey: kase.autoKey, fwdKey, containKey });
    if (corroborator) { record(kase, chosenKey, "frontier", why, { corroborator }); front.locked++; }
    else { proposals.push({ caseKey: kase.key, chosenKey, why }); front.hints++; }
  };
  if (frontier && !noLlm && haveKey && propose) {
    const done2 = new Set(decisions.map((d) => d.caseKey));
    const eligible = [];
    for (const kase of cases) {
      if (done2.has(kase.key)) continue;
      const fwdKey = links.get(kase.key) ?? null;
      const containKey = containment ? containBestKey(kase) : null;
      const triggers = frontierTriggers(kase, { fwdKey, containKey, cheapKey: cheapPicks.get(kase.key) });
      if (triggers.size) eligible.push({ kase, fwdKey, containKey });
    }
    front.eligible = eligible.length;
    // reuse cached frontier results first (no re-spend); ask only the uncached.
    const uncached = [];
    for (const e of eligible) {
      const c = cacheGet("frontier", e.kase.key, frontierModel);
      if (c) { applyFrontier(e.kase, e.fwdKey, e.containKey, c.chosenKey, c.why); front.cached++; } else uncached.push(e);
    }
    // hardest-first: the #117 seed seam, then newest commit first (matches the queue order),
    // so a --frontier-limit spends on the trickiest UNCACHED cases first.
    const rank = new Map(commits.map((c, i) => [c.sha, i]));
    uncached.sort((a, b) =>
      (a.kase.kind === "seed-close" ? 0 : 1) - (b.kase.kind === "seed-close" ? 0 : 1) ||
      (rank.get(b.kase.newerSha) ?? -1) - (rank.get(a.kase.newerSha) ?? -1));
    const toAsk = uncached.slice(0, Number.isFinite(frontierLimit) ? frontierLimit : uncached.length);
    front.limited = uncached.length - toAsk.length;
    log(`pass 3 (frontier ${frontierModel}): ${front.cached} cached · asking ${toAsk.length}/${uncached.length} new (concurrency ${frontierConcurrency})…`);
    let done = 0;
    await mapPool(toAsk, frontierConcurrency, async ({ kase, fwdKey, containKey }) => {
      const subject = enrichSubject(kase.subjectKey, data.nodes);
      const candidates = enrichCandidates(kase, data.nodes, claimIndex);
      if (!subject || !candidates.length) return;
      front.considered++;
      try {
        const { chosenKey, why } = await propose(subject, candidates, { model: frontierModel, change: changeBySha.get(kase.newerSha) });
        cacheSet("frontier", kase.key, chosenKey, why, frontierModel);
        applyFrontier(kase, fwdKey, containKey, chosenKey, why);
      } catch (e) {
        front.errors++;
        if (front.errors <= 3) log(`  frontier error on ${kase.key}: ${String(e?.message || e).slice(0, 120)}`);
      }
      if (++done % 25 === 0) log(`  …${done}/${toAsk.length} asked (${front.locked} locked, ${front.hints} hints)`);
    });
    log(`pass 3 (frontier): ${front.locked} locked · ${front.hints} hints · ${front.cached} cached · ${front.errors} errors`);
  }

  // Mutual-exclusion safety net. Only the cluster pass globally enforces "one older occurrence is the
  // predecessor of AT MOST ONE newer doc"; the per-case passes (forward/containment/llm/frontier) each
  // lock in isolation and CAN independently claim an occurrence another already took. Resolve any residual
  // double-book deterministically: keep the strongest claimant (tier priority, then agreed-with-matcher),
  // demote the rest to residual so a human/frontier decides — never a silent last-writer-wins in apply.
  const TIER_RANK = { bijection: 0, cluster: 1, "forward-reverse": 2, containment: 3, positional: 4, "llm-90": 5, frontier: 6, split: 9 };
  const occClaims = new Map(); // `${olderSha}|${chosenKey}` -> claimant decisions
  for (const d of decisions) {
    if (!d.chosenKey || d.chosenKey === "none") continue;
    const k = `${d.olderSha}|${d.chosenKey}`;
    let a = occClaims.get(k); if (!a) occClaims.set(k, (a = [])); a.push(d);
  }
  const demoted = new Set();
  for (const claimants of occClaims.values()) {
    if (claimants.length < 2) continue;
    claimants.sort((x, y) => (TIER_RANK[x.auto] ?? 8) - (TIER_RANK[y.auto] ?? 8) || Number(y.agreedWithAuto) - Number(x.agreedWithAuto));
    for (const d of claimants.slice(1)) demoted.add(d); // keep strongest, drop the rest
  }
  const keptDecisions = demoted.size ? decisions.filter((d) => !demoted.has(d)) : decisions;
  if (demoted.size) log(`conflict sweep: demoted ${demoted.size} double-booked claim(s) to residual (kept the strongest per occurrence)`);
  // hard invariant — must hold after resolution, else apply would silently drop histories.
  {
    const seen = new Set();
    for (const d of keptDecisions) {
      if (!d.chosenKey || d.chosenKey === "none") continue;
      const k = `${d.olderSha}|${d.chosenKey}`;
      if (seen.has(k)) throw new Error(`mutual-exclusion violated: older occurrence ${k} claimed by >1 decision after conflict sweep`);
      seen.add(k);
    }
  }

  const resolvedKeys = new Set(keptDecisions.map((d) => d.caseKey));
  const residual = cases.filter((c) => !resolvedKeys.has(c.key));

  // positional HINTS (advisory) — for the still-residual cases the content passes + LLM
  // couldn't lock (typically matcher-null identical siblings, where there is NO content
  // signal to corroborate against), surface the positional pick as a suggested predecessor
  // the human confirms in the curation UI. Gated on SELF-corroboration (P1 ancestor AND P2
  // neighbour both independently favour the pick) to stand in for the missing content
  // signal. NEVER a lock — written to the advisory proposals file only, alongside any
  // frontier hints (never overwriting one already recorded for the same case).
  let posHints = 0;
  if (positional) {
    const hinted = new Set(proposals.map((p) => p.caseKey));
    for (const kase of residual) {
      if (hinted.has(kase.key)) continue;
      const pick = positionalPick(data.nodes[kase.subjectKey], (kase.candidates || []).map((c) => c.key), data.nodes);
      if (positionalSelfCorroborates(pick)) {
        proposals.push({ caseKey: kase.key, chosenKey: pick.chosenKey, via: "positional", why: `positional: ancestor + neighbour agree (P1=${pick.p1.toFixed(2)}, P2=${pick.p2.toFixed(2)}, margin=${pick.margin.toFixed(2)})` });
        posHints++;
      }
    }
    if (posHints) log(`positional hints: ${posHints} advisory suggestion(s) for residual cases (curation UI, not locked)`);
  }

  const summary = {
    totalCases: cases.length,
    resolved: keptDecisions.length,
    conflictsDemoted: demoted.size,
    resolvedByBijection: bijResolved,
    resolvedBySplit: splitResolved,
    resolvedByForwardReverse: fwdResolved,
    resolvedByContainment: containResolved,
    resolvedByPositional: posResolved,
    positionalHints: posHints,
    resolvedByCluster: clu.locked + clu.lockedNone,
    clusterDisagreed: clu.disagreed,
    clusterWindowed: clu.windowed,
    resolvedByLlm: llm.confirmed,
    resolvedByFrontier: front.locked,
    frontierHints: front.hints,
    frontierCalls: front.considered,
    frontierCached: front.cached,
    llmCached: llm.cached,
    frontierModel: front.model,
    residual: residual.length,
    reductionPct: +((keptDecisions.length / Math.max(1, cases.length)) * 100).toFixed(1),
    llm,
    cluster: clu,
    frontier: front,
  };
  return { decisions: keptDecisions, proposals, summary, residual, cache };
}

// bounded-concurrency async map (no deps): keeps at most `n` promises in flight.
async function mapPool(items, n, fn) {
  const it = items[Symbol.iterator]();
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let next = it.next(); !next.done; next = it.next()) await fn(next.value);
  });
  await Promise.all(workers);
}
