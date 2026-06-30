// Orchestrator for the two HTML-era auto-resolution passes (plan §10.4). Separated
// from the pure rules (auto-curate.mjs) and from IO/CLI (the aux scripts) so it can be
// reused by BOTH entry points — the standalone `auto-curate-html-history.mjs` and the
// combined `build-history-curation.mjs --auto` — and unit-tested with a stub proposer.
//
// It performs NO file/git IO and imports no LLM client: the caller injects `propose`
// (the LLM proposer) and `log`, and passes the already-loaded `commits` so the slow
// turndown isn't repeated when the curation queue build already has them in memory.

import { forwardLinks } from "./history-forward-trace.mjs";
import { forwardAgrees, llmEligible, llmConfirms, LLM_CONFIRM_THRESHOLD } from "./auto-curate.mjs";
import { bestByContainment } from "./ordered-containment.mjs";

// Run pass 1 (forward∩reverse, deterministic) then pass 2 (LLM∩matcher, ≥threshold,
// opt-in) over a curation queue. Returns { decisions, summary, residual }.
//   data     — the curation artifact ({ meta, nodes, cases })
//   commits  — loaded HTML commits oldest→newest, nodes carrying contentHash
//   propose  — async (subject, candidates) => { chosenKey, why } (the LLM proposer)
//   haveKey  — whether an LLM key is configured (gates pass 2)
export async function runAutoCurate({
  data, commits, propose, haveKey = false,
  noLlm = false, limit = Infinity, threshold = LLM_CONFIRM_THRESHOLD, concurrency = 5,
  containment = true, containThreshold = 0.7, containMargin = 0.15,
  log = () => {},
}) {
  const cases = data.cases || [];
  const links = forwardLinks(commits);
  const decisions = [];
  const record = (kase, chosenKey, via, why) => decisions.push({
    caseKey: kase.key, kind: kase.kind, subjectKey: kase.subjectKey,
    newerSha: kase.newerSha, olderSha: kase.olderSha,
    chosenKey, agreedWithAuto: chosenKey === kase.autoKey, auto: via, ...(why ? { why } : {}),
  });

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
      const cands = kase.candidates.map((c) => ({ key: c.key, content: data.nodes[c.key]?.content ?? "" })).filter((c) => c.content);
      const { best, bestScore, margin } = bestByContainment(data.nodes[kase.subjectKey]?.content ?? "", cands);
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

  const resolvedKeys = new Set(decisions.map((d) => d.caseKey));
  const residual = cases.filter((c) => !resolvedKeys.has(c.key));
  const summary = {
    totalCases: cases.length,
    resolved: decisions.length,
    resolvedByForwardReverse: fwdResolved,
    resolvedByContainment: containResolved,
    resolvedByLlm: llm.confirmed,
    residual: residual.length,
    reductionPct: +((decisions.length / Math.max(1, cases.length)) * 100).toFixed(1),
    llm,
  };
  return { decisions, summary, residual };
}

// bounded-concurrency async map (no deps): keeps at most `n` promises in flight.
async function mapPool(items, n, fn) {
  const it = items[Symbol.iterator]();
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let next = it.next(); !next.done; next = it.next()) await fn(next.value);
  });
  await Promise.all(workers);
}
