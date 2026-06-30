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
import { bestByContainment } from "./ordered-containment.mjs";

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
  frontier = false, frontierModel = null, frontierLimit = Infinity, frontierConcurrency = 3,
  log = () => {},
}) {
  const cases = data.cases || [];
  const links = forwardLinks(commits);
  const decisions = [];
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
  const llmQueue = [];
  let fwdResolved = 0, containResolved = 0;
  for (const kase of cases) {
    const fwd = links.get(kase.key) ?? null;
    if (forwardAgrees(kase, fwd)) { record(kase, kase.autoKey, "forward-reverse"); fwdResolved++; continue; }
    if (containment && kase.autoKey) {
      const { best, bestScore, margin } = bestByContainment(data.nodes[kase.subjectKey]?.content ?? "", candContents(kase));
      if (best && best.key === kase.autoKey && bestScore >= containThreshold && margin >= containMargin) {
        record(kase, kase.autoKey, "containment"); containResolved++; continue;
      }
    }
    if (llmEligible(kase, threshold)) llmQueue.push(kase); // counted regardless; --no-llm just won't ask
  }
  log(`pass 1 (forward∩reverse): ${fwdResolved} locked${containment ? `  ·  pass 1.5 (reverse∩containment): ${containResolved} locked` : ""}  ·  ${llmQueue.length} ≥${threshold}-confident left for the LLM`);

  // pass 2 — LLM second opinion on the eligible cases; lock the ones it independently
  // agrees with. Skipped (left for a human) when --no-llm or no key is configured.
  const llm = { eligible: llmQueue.length, considered: 0, confirmed: 0, disagreed: 0, limited: 0, errors: 0, threshold };
  if (noLlm) {
    log(`pass 2 skipped (--no-llm) — ${llmQueue.length} LLM-eligible cases left for a human`);
    llm.limited = llmQueue.length;
  } else if (!haveKey || !propose) {
    log("pass 2 skipped — no OpenRouter key configured (set OPENROUTER_API_KEY to run the LLM cross-check)");
    llm.limited = llmQueue.length;
  } else {
    const toAsk = llmQueue.slice(0, Number.isFinite(limit) ? limit : llmQueue.length);
    llm.limited = llmQueue.length - toAsk.length;
    log(`pass 2 (LLM∩matcher): asking ${toAsk.length}/${llmQueue.length} eligible cases (concurrency ${concurrency})…`);
    let done = 0;
    await mapPool(toAsk, concurrency, async (kase) => {
      const subject = data.nodes[kase.subjectKey];
      const candidates = kase.candidates
        .map((c) => ({ key: c.key, node: data.nodes[c.key] }))
        .filter((c) => c.node)
        .map((c) => ({ key: c.key, title: c.node.title, content: c.node.content }));
      if (!subject || !candidates.length) return;
      llm.considered++;
      try {
        const { chosenKey, why } = await propose({ title: subject.title, content: subject.content }, candidates);
        cheapPicks.set(kase.key, chosenKey); // remembered for pass 3's T3 (cheap≠matcher)
        if (llmConfirms(kase, chosenKey)) { record(kase, kase.autoKey, "llm-90", why); llm.confirmed++; }
        else llm.disagreed++;
      } catch (e) {
        llm.errors++;
        if (llm.errors <= 3) log(`  llm error on ${kase.key}: ${String(e?.message || e).slice(0, 120)}`);
      }
      if (++done % 25 === 0) log(`  …${done}/${toAsk.length} asked (${llm.confirmed} confirmed)`);
    });
    log(`pass 2 (LLM∩matcher): ${llm.confirmed} locked · ${llm.disagreed} LLM disagreed · ${llm.errors} errors`);
  }

  // pass 3 — frontier-model escalation on the UNCERTAIN residual (opt-in via `frontier`).
  // Route only trigger-matching cases (hardest-first, capped) to a stronger model; LOCK on
  // agreement with an independent signal (matcher/forward/containment), else record a HINT
  // the curation UI surfaces to the human. Never locks on the cheap LLM alone (not independent).
  const proposals = [];
  const front = { eligible: 0, considered: 0, locked: 0, hints: 0, errors: 0, limited: 0, model: frontier ? frontierModel : null };
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
    // hardest-first: the #117 seed seam, then newest commit first (matches the queue order),
    // so a --frontier-limit spends on the trickiest cases first.
    const rank = new Map(commits.map((c, i) => [c.sha, i]));
    eligible.sort((a, b) =>
      (a.kase.kind === "seed-close" ? 0 : 1) - (b.kase.kind === "seed-close" ? 0 : 1) ||
      (rank.get(b.kase.newerSha) ?? -1) - (rank.get(a.kase.newerSha) ?? -1));
    const toAsk = eligible.slice(0, Number.isFinite(frontierLimit) ? frontierLimit : eligible.length);
    front.limited = eligible.length - toAsk.length;
    log(`pass 3 (frontier ${frontierModel}): asking ${toAsk.length}/${eligible.length} uncertain residual cases (concurrency ${frontierConcurrency})…`);
    let done = 0;
    await mapPool(toAsk, frontierConcurrency, async ({ kase, fwdKey, containKey }) => {
      const subject = data.nodes[kase.subjectKey];
      const candidates = kase.candidates
        .map((c) => ({ key: c.key, node: data.nodes[c.key] }))
        .filter((c) => c.node)
        .map((c) => ({ key: c.key, title: c.node.title, content: c.node.content }));
      if (!subject || !candidates.length) return;
      front.considered++;
      try {
        const { chosenKey, why } = await propose({ title: subject.title, content: subject.content }, candidates, { model: frontierModel });
        const corroborator = frontierCorroborator(chosenKey, { autoKey: kase.autoKey, fwdKey, containKey });
        if (corroborator) { record(kase, chosenKey, "frontier", why, { corroborator }); front.locked++; }
        else { proposals.push({ caseKey: kase.key, chosenKey, why }); front.hints++; }
      } catch (e) {
        front.errors++;
        if (front.errors <= 3) log(`  frontier error on ${kase.key}: ${String(e?.message || e).slice(0, 120)}`);
      }
      if (++done % 25 === 0) log(`  …${done}/${toAsk.length} asked (${front.locked} locked, ${front.hints} hints)`);
    });
    log(`pass 3 (frontier): ${front.locked} locked · ${front.hints} hints · ${front.errors} errors`);
  }

  const resolvedKeys = new Set(decisions.map((d) => d.caseKey));
  const residual = cases.filter((c) => !resolvedKeys.has(c.key));
  const summary = {
    totalCases: cases.length,
    resolved: decisions.length,
    resolvedByForwardReverse: fwdResolved,
    resolvedByContainment: containResolved,
    resolvedByLlm: llm.confirmed,
    resolvedByFrontier: front.locked,
    frontierHints: front.hints,
    frontierCalls: front.considered,
    frontierModel: front.model,
    residual: residual.length,
    reductionPct: +((decisions.length / Math.max(1, cases.length)) * 100).toFixed(1),
    llm,
    frontier: front,
  };
  return { decisions, proposals, summary, residual };
}

// bounded-concurrency async map (no deps): keeps at most `n` promises in flight.
async function mapPool(items, n, fn) {
  const it = items[Symbol.iterator]();
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let next = it.next(); !next.done; next = it.next()) await fn(next.value);
  });
  await Promise.all(workers);
}
