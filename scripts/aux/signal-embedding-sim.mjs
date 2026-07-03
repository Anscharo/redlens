// SIGNAL PROTOTYPE (read-only): embedding-based semantic similarity.
//
// Scores each candidate by cosine(subjectVec, candidateVec), where the vector is the
// OpenRouter embedding of `title + "\n" + content` (content truncated to ~2000 chars).
// embedBatch returns L2-normalized unit vectors, so cosine == dot product.
//
// The margin threshold is CALIBRATED empirically on a deterministic resolved sample
// (raw argmax accuracy + a margin sweep), then the chosen margin is measured on the 35
// residual cases and cross-validated on the FULL resolvedEvaluable pool.
//
// Read-only. Reads the curation queue via residual-signal-lib; embeds through the shared
// client. Vectors cache to .cache/signal-embedding-vectors.json; results to
// .cache/signal-embedding-sim.json. Nothing else is written.
//
// RUN WITH BUN so .env.local + the .ts embed client load:
//   bun scripts/aux/signal-embedding-sim.mjs

import fs from "node:fs";
import path from "node:path";
import {
  loadSignalData,
  sampleResolved,
  pickByScore,
  crossValidate,
  measureResidual,
  writeOut,
} from "./residual-signal-lib.mjs";
import { embedBatch } from "../../src/server/embed.ts";

const ROOT = process.cwd();
const VEC_CACHE = path.join(ROOT, ".cache/signal-embedding-vectors.json");
const CONTENT_CHARS = 2000;
const BATCH = 48;
const SAMPLE_N = 250;
const SWEEP = [0, 0.01, 0.02, 0.03, 0.05, 0.08];

function embedText(node) {
  if (!node) return null;
  const title = node.title || "";
  const content = (node.content || "").slice(0, CONTENT_CHARS);
  const t = `${title}\n${content}`.trim();
  return t || null;
}

function loadVecCache() {
  if (!fs.existsSync(VEC_CACHE)) return {};
  try {
    return JSON.parse(fs.readFileSync(VEC_CACHE, "utf8"));
  } catch {
    return {};
  }
}

function saveVecCache(cache) {
  fs.mkdirSync(path.dirname(VEC_CACHE), { recursive: true });
  fs.writeFileSync(VEC_CACHE, JSON.stringify(cache));
}

function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

function stats(arr) {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const sum = s.reduce((x, y) => x + y, 0);
  return {
    n: s.length,
    min: +s[0].toFixed(4),
    p10: +pct(s, 10).toFixed(4),
    median: +pct(s, 50).toFixed(4),
    mean: +(sum / s.length).toFixed(4),
    p90: +pct(s, 90).toFixed(4),
    max: +s[s.length - 1].toFixed(4),
  };
}

async function main() {
  const ctx = loadSignalData();
  const sample = sampleResolved(ctx.resolvedEvaluable, SAMPLE_N);

  // ---- collect the FULL distinct node-key set we need to embed ----
  const needed = new Set();
  const addCase = (c) => {
    if (c.subjectKey) needed.add(c.subjectKey);
    for (const cand of c.candidates || []) needed.add(cand.key);
  };
  for (const c of ctx.residualCases) addCase(c);
  for (const { case: c } of sample) addCase(c);

  // Only embed keys that map to a node with usable text.
  const cache = loadVecCache();
  const toEmbed = [];
  for (const key of needed) {
    if (cache[key]) continue;
    const txt = embedText(ctx.node(key));
    if (txt == null) continue; // missing node / empty -> scoreFn will return null later
    toEmbed.push({ key, txt });
  }

  console.log(
    `[embed-sim] distinct keys needed=${needed.size}  cached=${needed.size - toEmbed.length}  toEmbed=${toEmbed.length}`,
  );

  for (let i = 0; i < toEmbed.length; i += BATCH) {
    const chunk = toEmbed.slice(i, i + BATCH);
    const vecs = await embedBatch(chunk.map((c) => c.txt));
    chunk.forEach((c, j) => {
      cache[c.key] = vecs[j];
    });
    saveVecCache(cache);
    console.log(`  embedded ${Math.min(i + BATCH, toEmbed.length)}/${toEmbed.length}`);
  }

  const vecOf = (key) => cache[key] || null;

  // ---- scorer: cosine(subject, candidate) ----
  const scoreFn = (subjNode, candNode, { case: kase, cand }) => {
    const sv = vecOf(kase.subjectKey);
    const cv = vecOf(cand.key);
    if (!sv || !cv) return null;
    return dot(sv, cv);
  };

  // ---- CALIBRATION on the resolved sample ----
  // For each evaluable sample case with vectors available:
  //   correctSim  = cosine(subject, chosenKey)
  //   bestRejSim  = max cosine over the OTHER candidates
  //   margin      = correctSim - bestRejSim
  //   argmaxHit   = top-cosine candidate IS chosenKey
  const correctSims = [];
  const bestRejSims = [];
  const margins = [];
  let argmaxHit = 0;
  let calibN = 0;
  for (const { case: c, chosenKey } of sample) {
    const sv = vecOf(c.subjectKey);
    if (!sv) continue;
    const scored = [];
    for (const cand of c.candidates || []) {
      const cv = vecOf(cand.key);
      if (!cv) continue;
      scored.push({ key: cand.key, s: dot(sv, cv) });
    }
    if (scored.length < 2) continue;
    const correct = scored.find((x) => x.key === chosenKey);
    if (!correct) continue;
    calibN++;
    scored.sort((a, b) => b.s - a.s);
    if (scored[0].key === chosenKey) argmaxHit++;
    const bestRej = Math.max(...scored.filter((x) => x.key !== chosenKey).map((x) => x.s));
    correctSims.push(correct.s);
    bestRejSims.push(bestRej);
    margins.push(correct.s - bestRej);
  }

  // margin sweep on the sample using the shared harness
  const sweep = [];
  for (const m of SWEEP) {
    const pickFn = pickByScore(scoreFn, { margin: m });
    const cv = crossValidate(pickFn, ctx, sample);
    sweep.push({
      margin: m,
      decided: cv.decided,
      agree: cv.agree,
      disagree: cv.disagree,
      abstain: cv.abstain,
      coverage: +cv.coverage.toFixed(3),
      agreeRate: +cv.agreeRate.toFixed(3),
      disagreeRate: +cv.disagreeRate.toFixed(3),
    });
  }

  // Choose the margin: maximize agree while keeping disagreeRate low. Heuristic —
  // among margins whose sample disagreeRate <= 0.10, pick the one with the most agrees;
  // if none qualify, pick the min disagreeRate.
  const LOW = 0.1;
  const qualifying = sweep.filter((r) => r.disagreeRate <= LOW && r.decided > 0);
  let chosen;
  let why;
  if (qualifying.length) {
    chosen = qualifying.reduce((a, b) => (b.agree > a.agree ? b : a));
    why = `max agrees (${chosen.agree}) among margins with sample disagreeRate<=${LOW} (this margin=${(chosen.disagreeRate * 100).toFixed(1)}%)`;
  } else {
    chosen = sweep.reduce((a, b) => (b.disagreeRate < a.disagreeRate ? b : a));
    why = `no margin kept disagreeRate<=${LOW}; picked min disagreeRate (${(chosen.disagreeRate * 100).toFixed(1)}%)`;
  }
  const chosenMargin = chosen.margin;

  // ---- residual @ chosen margin ----
  const pickFn = pickByScore(scoreFn, { margin: chosenMargin });
  const residual = measureResidual(pickFn, ctx);

  // ---- cross-validate on the FULL resolvedEvaluable pool ----
  const cvFull = crossValidate(pickFn, ctx, ctx.resolvedEvaluable);

  const out = {
    signal: "embedding-cosine-similarity",
    config: { embedText: "title + content", contentChars: CONTENT_CHARS, sampleN: SAMPLE_N, batch: BATCH },
    calibration: {
      sampleEvaluable: calibN,
      rawArgmaxAccuracy: calibN ? +(argmaxHit / calibN).toFixed(4) : null,
      argmaxHit,
      correctSimDist: stats(correctSims),
      bestRejectedSimDist: stats(bestRejSims),
      correctMinusBestRejectedMarginDist: stats(margins),
      sweep,
    },
    chosenMargin,
    chosenMarginWhy: why,
    residual,
    crossValidationFull: {
      evaluable: cvFull.evaluable,
      decided: cvFull.decided,
      agree: cvFull.agree,
      disagree: cvFull.disagree,
      abstain: cvFull.abstain,
      coverage: +cvFull.coverage.toFixed(4),
      agreeRate: +cvFull.agreeRate.toFixed(4),
      disagreeRate: +cvFull.disagreeRate.toFixed(4),
      disagreements: cvFull.disagreements,
    },
  };
  const rel = writeOut(".cache/signal-embedding-sim.json", out);

  // ---- concise stdout summary ----
  console.log(`\n[embed-sim] CALIBRATION (sample n=${calibN})`);
  console.log(`  raw argmax accuracy (margin=0): ${(out.calibration.rawArgmaxAccuracy * 100).toFixed(1)}% (${argmaxHit}/${calibN})`);
  console.log(`  correctSim     ${JSON.stringify(out.calibration.correctSimDist)}`);
  console.log(`  bestRejected   ${JSON.stringify(out.calibration.bestRejectedSimDist)}`);
  console.log(`  margin(c-rej)  ${JSON.stringify(out.calibration.correctMinusBestRejectedMarginDist)}`);
  console.log(`  sweep:`);
  for (const r of sweep) {
    console.log(
      `    margin=${r.margin.toFixed(2)}  decided=${r.decided}  agree=${r.agree}  disagree=${r.disagree}  abstain=${r.abstain}  disagreeRate=${(r.disagreeRate * 100).toFixed(1)}%`,
    );
  }
  console.log(`\n[embed-sim] chosen margin=${chosenMargin} — ${why}`);
  console.log(`[embed-sim] RESIDUAL: disambiguated ${residual.decidedCount}/${residual.total}`);
  for (const d of residual.decided) {
    console.log(`    ${d.caseKey.slice(0, 22)} -> "${d.chosenTitle}"  (${d.reason})`);
  }
  console.log(
    `[embed-sim] CROSS-VAL (full, n=${cvFull.evaluable}): decided=${cvFull.decided} agree=${cvFull.agree} disagree=${cvFull.disagree} abstain=${cvFull.abstain} disagreeRate=${(cvFull.disagreeRate * 100).toFixed(1)}%`,
  );
  console.log(`[embed-sim] wrote ${rel}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
