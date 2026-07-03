// Shared, READ-ONLY scaffolding for the residual-signal discovery prototypes
// (scripts/htmlhist/signal-*.mjs). Loads the curation queue + the two decision files,
// derives the 35 residual cases and the resolved ground-truth, and offers a common
// cross-validation harness so every candidate signal is measured the same way:
//
//   (a) how many of the 35 residual cases the signal newly, CONFIDENTLY disambiguates
//   (b) its disagreement rate against ALREADY-RESOLVED ambiguous cases — a signal that
//       would have CONTRADICTED a confirmed pairing is a red flag ON THE SIGNAL.
//
// Nothing here writes to any pipeline artifact. It only reads:
//   public/history-curation.json, public/history-auto-decisions.json,
//   public/history-decisions.json.
// A signal is expressed as a pickFn(case, ctx) -> { chosenKey, confidence, reason } | null
// (null = abstain). ctx = { node, nodes, data }. `pickByScore` adapts a per-candidate
// scorer into a margin-gated pickFn.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CURATION = path.join(ROOT, "public/history-curation.json");
const AUTO_DECISIONS = path.join(ROOT, "public/history-auto-decisions.json");
const HUMAN_DECISIONS = path.join(ROOT, "public/history-decisions.json");

function readJson(f) {
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function decisionMap(file) {
  // caseKey -> chosenKey (may be null). The union across both files is the ground truth;
  // human file wins on conflict (it's the reviewed one).
  const m = new Map();
  if (!fs.existsSync(file)) return m;
  try {
    for (const dec of readJson(file).decisions || []) m.set(dec.caseKey, dec.chosenKey ?? null);
  } catch {
    /* ignore */
  }
  return m;
}

// One load, memoized, shared by every signal script.
let _cache = null;
export function loadSignalData() {
  if (_cache) return _cache;
  if (!fs.existsSync(CURATION)) {
    throw new Error(`curation queue not found: ${path.relative(ROOT, CURATION)} — run pnpm htmlhist:curate`);
  }
  const data = readJson(CURATION);
  const nodes = data.nodes || {};
  const node = (key) => nodes[key] || null;
  const caseByKey = new Map((data.cases || []).map((c) => [c.key, c]));

  const auto = decisionMap(AUTO_DECISIONS);
  const human = decisionMap(HUMAN_DECISIONS);
  // resolved = union; human overrides auto.
  const resolved = new Map([...auto, ...human]);

  const residualCases = (data.cases || []).filter((c) => !resolved.has(c.key));

  // ground-truth pool for cross-validation: resolved cases that were genuinely
  // ambiguous (>=2 candidates), had a non-null chosenKey, AND that chosenKey is
  // actually one of the offered candidates (so a picker COULD have chosen it).
  const resolvedEvaluable = [];
  for (const [caseKey, chosenKey] of resolved) {
    if (chosenKey == null) continue;
    const c = caseByKey.get(caseKey);
    if (!c || (c.candidates || []).length < 2) continue;
    if (!c.candidates.some((x) => x.key === chosenKey)) continue;
    resolvedEvaluable.push({ case: c, chosenKey });
  }

  _cache = { data, nodes, node, caseByKey, resolved, residualCases, resolvedEvaluable };
  return _cache;
}

// Deterministic sample of resolvedEvaluable (no Math.random — reproducible). Stride
// sampling across the sorted-by-key list gives a spread over kinds/commits.
export function sampleResolved(resolvedEvaluable, n) {
  if (!Number.isFinite(n) || n >= resolvedEvaluable.length) return resolvedEvaluable;
  const sorted = [...resolvedEvaluable].sort((a, b) => (a.case.key < b.case.key ? -1 : 1));
  const stride = sorted.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(sorted[Math.floor(i * stride)]);
  return out;
}

// Turn a per-candidate scorer into a margin-gated pickFn. scoreFn(subjectNode, candNode,
// { case, cand, ctx }) -> number | null (null = can't score this candidate). A pick is
// only emitted when the best candidate beats the runner-up by >= margin AND clears
// minTop. Ties / thin margins => abstain (null), which is the honest behavior for a
// disambiguator.
export function pickByScore(scoreFn, { margin = 0, minTop = -Infinity } = {}) {
  return (kase, ctx) => {
    const subj = ctx.node(kase.subjectKey);
    const scored = [];
    for (const cand of kase.candidates || []) {
      const s = scoreFn(subj, ctx.node(cand.key), { case: kase, cand, ctx });
      if (s != null && Number.isFinite(s)) scored.push({ key: cand.key, s });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.s - a.s);
    const top = scored[0];
    const runner = scored[1];
    if (top.s < minTop) return null;
    if (runner && top.s - runner.s < margin) return null;
    return {
      chosenKey: top.key,
      confidence: runner ? top.s - runner.s : top.s,
      reason: `top=${top.s.toFixed(3)}${runner ? ` runner=${runner.s.toFixed(3)} margin=${(top.s - runner.s).toFixed(3)}` : " (only scorable candidate)"}`,
    };
  };
}

// Cross-validate a pickFn against resolved ambiguous cases. Abstention is NOT counted
// as a wrong answer — only confident-but-contradicting picks are. A picked key that
// DIFFERS from chosenKey but points at a node that is byte-identical in title AND
// content (a different occurrence of the same stub row) is an OCCURRENCE-EQUIVALENT
// pick, not a real error: the resulting thread/diff is identical either way. So we
// report BOTH the raw disagreement rate and the content-aware HARD disagreement rate
// (genuinely different document picked) — the latter is the honest red-flag metric.
export function crossValidate(pickFn, ctx, resolvedPool) {
  let agree = 0;
  let occEquivalent = 0;
  let hardDisagree = 0;
  let abstain = 0;
  const disagreements = [];
  const equiv = (a, b) => {
    const na = ctx.node(a);
    const nb = ctx.node(b);
    return !!na && !!nb && (na.title || "") === (nb.title || "") && (na.content || "") === (nb.content || "");
  };
  for (const { case: c, chosenKey } of resolvedPool) {
    let pick = null;
    try {
      pick = pickFn(c, ctx);
    } catch {
      pick = null;
    }
    if (!pick || pick.chosenKey == null) {
      abstain++;
      continue;
    }
    if (pick.chosenKey === chosenKey) agree++;
    else if (equiv(pick.chosenKey, chosenKey)) occEquivalent++;
    else {
      hardDisagree++;
      disagreements.push({ caseKey: c.key, kind: c.kind, picked: pick.chosenKey, truth: chosenKey, reason: pick.reason });
    }
  }
  const decided = agree + occEquivalent + hardDisagree;
  const effectiveAgree = agree + occEquivalent; // occurrence-equivalent counts as correct
  return {
    evaluable: resolvedPool.length,
    decided,
    agree,
    occEquivalent,
    hardDisagree,
    disagree: hardDisagree, // back-compat alias: the real errors
    abstain,
    coverage: resolvedPool.length ? decided / resolvedPool.length : 0,
    disagreeRate: decided ? hardDisagree / decided : 0, // content-aware
    rawDisagreeRate: decided ? (occEquivalent + hardDisagree) / decided : 0, // key-exact
    agreeRate: decided ? effectiveAgree / decided : 0,
    disagreements: disagreements.slice(0, 40),
  };
}

// Run a pickFn over the 35 residual cases. Returns per-case verdicts (decided/abstained).
export function measureResidual(pickFn, ctx) {
  const decided = [];
  const abstained = [];
  for (const c of ctx.residualCases) {
    let pick = null;
    try {
      pick = pickFn(c, ctx);
    } catch (e) {
      pick = null;
    }
    if (pick && pick.chosenKey != null) {
      const n = ctx.node(pick.chosenKey);
      decided.push({ caseKey: c.key, kind: c.kind, chosenKey: pick.chosenKey, chosenTitle: n?.title ?? null, confidence: pick.confidence ?? null, reason: pick.reason });
    } else {
      abstained.push({ caseKey: c.key, kind: c.kind });
    }
  }
  return { total: ctx.residualCases.length, decidedCount: decided.length, decided, abstained };
}

export function writeOut(relPath, obj) {
  const out = path.resolve(ROOT, relPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(obj, null, 2));
  return path.relative(ROOT, out);
}
