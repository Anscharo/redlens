// SIGNAL PROTOTYPE (read-only): doc-type / structural priors.
//
// Question: per atlas document type (Core, Type Specification, Scenario, ...), how often
// does a doc of that type get REWORDED vs stay byte-stable across a hop? And can knowing
// the type sharpen confidence on a residual case?
//
// Method:
//   1. Descriptive prior — over every RESOLVED case with a true pairing (chosenKey), compare
//      the subject's content to the chosen predecessor's content. Byte-identical => "stable";
//      otherwise => "reworded". Group by the subject's document type to get a per-type
//      reword rate. (score==1 in the queue is a fuzzy top bucket, not strict equality, so we
//      use raw content equality — verified: content-identical always lands in score==1, but
//      ~19% of score==1 pairs actually differ.)
//   2. Disambiguator test — a Bayesian-ish per-candidate likelihood driven by the type prior:
//        identical content  -> P(stable | type)              = 1 - rewordRate
//        differing content  -> P(reword | type) * cand.score  (fuzzy sim as reword closeness)
//      margin-gated pick. This is EXPECTED to be weak: residual candidates almost always
//      share the subject's type, so a per-type prior cannot separate same-type siblings.
//      We measure and say so rather than assume.
//
// Writes .cache/signal-type-priors.json only.
//   node scripts/aux/signal-type-priors.mjs

import { loadSignalData, pickByScore, crossValidate, measureResidual, writeOut } from "./residual-signal-lib.mjs";

function main() {
  const ctx = loadSignalData();
  const { node, resolved, caseByKey } = ctx;

  // ---- 1. Per-type reword-rate prior over resolved true pairings ----
  // pool = every resolved case with a non-null chosenKey that is an offered candidate.
  const priorPool = [];
  for (const [caseKey, chosenKey] of resolved) {
    if (chosenKey == null) continue;
    const c = caseByKey.get(caseKey);
    if (!c) continue;
    if (!(c.candidates || []).some((x) => x.key === chosenKey)) continue;
    priorPool.push({ case: c, chosenKey });
  }

  const byType = new Map(); // type -> { stable, reworded }
  for (const { case: c, chosenKey } of priorPool) {
    const subj = node(c.subjectKey);
    const chosen = node(chosenKey);
    if (!subj || !chosen) continue;
    const type = subj.type || "(unknown)";
    const rec = byType.get(type) || { stable: 0, reworded: 0 };
    if ((subj.content || "") === (chosen.content || "")) rec.stable++;
    else rec.reworded++;
    byType.set(type, rec);
  }

  const typeTable = [...byType.entries()]
    .map(([type, r]) => {
      const n = r.stable + r.reworded;
      return { type, n, stable: r.stable, reworded: r.reworded, rewordRate: n ? r.reworded / n : null };
    })
    .sort((a, b) => b.n - a.n);
  const rewordRateOf = new Map(typeTable.map((t) => [t.type, t.rewordRate ?? 0.5]));

  // ---- 2. Type-prior scorer as a disambiguator ----
  const scoreFn = (subj, cn, { cand }) => {
    if (!subj || !cn) return null;
    const type = cn.type || subj.type || "(unknown)";
    const rr = rewordRateOf.has(type) ? rewordRateOf.get(type) : 0.5;
    const identical = (subj.content || "") === (cn.content || "");
    return identical ? 1 - rr : rr * (cand.score ?? 0);
  };
  // require a real gap so same-type / same-content siblings abstain
  const pickFn = pickByScore(scoreFn, { margin: 0.15, minTop: 0 });

  const residual = measureResidual(pickFn, ctx);
  const cv = crossValidate(pickFn, ctx, ctx.resolvedEvaluable);

  // structural fact: do residual candidates ever differ in type from the subject?
  let residualTypeSeparable = 0;
  for (const c of ctx.residualCases) {
    const s = node(c.subjectKey);
    const types = new Set(c.candidates.map((x) => node(x.key)?.type));
    if (!(types.size === 1 && types.has(s?.type))) residualTypeSeparable++;
  }

  const out = {
    signal: "doc-type-structural-priors",
    priorPoolSize: priorPool.length,
    typeRewordTable: typeTable,
    residualCandidatesTypeSeparable: `${residualTypeSeparable}/${ctx.residualCases.length}`,
    residual,
    crossValidation: cv,
  };
  const rel = writeOut(".cache/signal-type-priors.json", out);

  console.log(`[type-priors] prior pool = ${priorPool.length} resolved pairings`);
  console.log(`[type-priors] per-type reword rate (n = stable+reworded):`);
  for (const t of typeTable) {
    console.log(
      `    ${t.type.padEnd(22)} n=${String(t.n).padStart(5)}  stable=${String(t.stable).padStart(5)}  reworded=${String(t.reworded).padStart(4)}  rewordRate=${(t.rewordRate * 100).toFixed(1)}%`
    );
  }
  console.log(`[type-priors] residual cases where type could even separate candidates: ${residualTypeSeparable}/${ctx.residualCases.length}`);
  console.log(`[type-priors] RESIDUAL: disambiguated ${residual.decidedCount}/${residual.total}`);
  for (const dd of residual.decided) console.log(`    ${dd.caseKey.slice(0, 24)} -> "${dd.chosenTitle}"  (${dd.reason})`);
  console.log(`[type-priors] CROSS-VAL: decided ${cv.decided}/${cv.evaluable}  agree=${cv.agree} disagree=${cv.disagree}  disagreeRate=${(cv.disagreeRate * 100).toFixed(1)}%`);
  console.log(`[type-priors] wrote ${rel}`);
}

main();
