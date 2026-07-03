// PROTOTYPE (throwaway) — evaluate the MATRIX curation pass on a sample of residual clusters.
// Builds residual subject↔candidate clusters, samples a spread of sizes, and runs TWO JSON-clean
// models (default deepseek-v4-flash vs deepseek-v4-pro) on each, reporting: JSON-fail, conflicts
// (a candidate assigned twice — should be 0), missing subjects, matcher-agreement (a lock proxy),
// none-rate, cross-borrow (picked a candidate NOT in that case's own list — the "best not in the
// set" win), cross-model agreement, latency, and an approx $/cluster. Writes a readable dump of a
// few full clusters (both models side-by-side) for eyeballing.
//
//   bun scripts/htmlhist/prototype-cluster-assign.mjs [--models a,b] [--clusters 16] [--concurrency 4]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { proposeClusterAssignment } from "../../src/server/history-curate.ts";
import { config } from "../../src/server/config.ts";
import { buildClusters } from "./curate-clusters.mjs";
import { buildClaimIndex, enrichSubject, enrichCandidates } from "./curate-context.mjs";

const ROOT = process.cwd();
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const MODELS = (arg("--models", "deepseek/deepseek-v4-flash,deepseek/deepseek-v4-pro")).split(",").map((s) => s.trim()).filter(Boolean);
const N_CLUSTERS = Number(arg("--clusters", "16"));
const CONC = Math.max(1, Number(arg("--concurrency", "4")));

if (!config.openrouterApiKey) { console.error("needs OPENROUTER_API_KEY in the environment."); process.exit(1); }
const q = JSON.parse(fs.readFileSync(path.join(ROOT, "public/history-curation.json"), "utf8"));
const auto = JSON.parse(fs.readFileSync(path.join(ROOT, "public/history-auto-decisions.json"), "utf8"));
const cases = q.cases || [];
const byCase = new Map(cases.map((c) => [c.key, c]));
const claimIndex = buildClaimIndex(cases);
const dec = new Map((auto.decisions || []).map((d) => [d.caseKey, d.chosenKey]));
const resolved = new Set(dec.keys());
const claimed = new Set([...dec.values()].filter((k) => k && k !== "none"));
const changeBySha = new Map();
for (const c of q.commits || []) if (c.prTitle || c.changeSummary) changeBySha.set(c.sha, { pr: c.pr, title: c.prTitle, summary: c.changeSummary });

const { clusters, stats } = buildClusters(cases, resolved, claimed, { maxSize: 12 });
console.error("cluster stats:", JSON.stringify(stats));

// sample a spread across size buckets (deterministic — clusters are size-desc then key-sorted)
const inRange = clusters.filter((c) => c.size >= 2 && c.size <= 12);
const buckets = { "7-12": [], "4-6": [], "2-3": [] };
for (const c of inRange) (c.size >= 7 ? buckets["7-12"] : c.size >= 4 ? buckets["4-6"] : buckets["2-3"]).push(c);
const take = (arr, n) => arr.slice(0, n);
const sample = [...take(buckets["7-12"], Math.ceil(N_CLUSTERS * 0.25)), ...take(buckets["4-6"], Math.ceil(N_CLUSTERS * 0.375)), ...take(buckets["2-3"], Math.floor(N_CLUSTERS * 0.375))].slice(0, N_CLUSTERS);
const nSubjects = sample.reduce((s, c) => s + c.size, 0);
console.error(`sampling ${sample.length} clusters (${nSubjects} subjects) across sizes; models: ${MODELS.join(", ")}\n`);

// prompt inputs per cluster (built once, reused by both models)
const built = sample.map((cl) => {
  const subjects = cl.caseKeys.map((k) => { const kase = byCase.get(k); const s = enrichSubject(kase.subjectKey, q.nodes); return s ? { key: k, autoKey: kase.autoKey, ownCands: new Set((kase.candidates || []).map((x) => x.key)), ...s } : null; }).filter(Boolean);
  const candidates = enrichCandidates({ candidates: cl.candidateKeys.map((key) => ({ key })) }, q.nodes, claimIndex);
  const newerSha = byCase.get(cl.caseKeys[0]).newerSha;
  return { cl, subjects, candidates, change: changeBySha.get(newerSha) };
}).filter((b) => b.subjects.length && b.candidates.length);

const approx = (s) => Math.ceil((s || "").length / 4);
let priceMap = new Map();
try { for (const m of JSON.parse(execFileSync("curl", ["-sL", "--max-time", "20", "https://openrouter.ai/api/v1/models"], { encoding: "utf8", maxBuffer: 1 << 24 })).data) priceMap.set(m.id, { in: +m.pricing.prompt, out: +m.pricing.completion }); } catch { /* skip cost */ }

async function mapPool(list, limit, fn) {
  const out = new Array(list.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => { while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); } }));
  return out;
}

const pct = (x) => (x == null ? "  —" : `${(100 * x).toFixed(0)}%`.padStart(4));
const results = {}; // model -> per-cluster assignments (for cross-model + dump)
const summary = {};
for (const model of MODELS) {
  const stat = { clusters: 0, subjects: 0, jsonFail: 0, conflicts: 0, missing: 0, agreeMatcher: 0, matcherHad: 0, none: 0, crossBorrow: 0, ms: 0, inTok: 0, outTok: 0 };
  const perCluster = await mapPool(built, CONC, async (b) => {
    const t0 = Date.now();
    stat.inTok += b.subjects.reduce((s, x) => s + approx(x.content), 0) + b.candidates.reduce((s, c) => s + approx(c.content), 0) + approx(b.change?.summary);
    try {
      const res = await proposeClusterAssignment(b.subjects, b.candidates, { model, change: b.change });
      stat.ms += Date.now() - t0; stat.outTok += 15 * b.subjects.length;
      stat.clusters++; stat.subjects += b.subjects.length; stat.conflicts += res.conflicts; stat.missing += res.missing;
      for (const a of res.assignments) {
        const subj = b.subjects.find((s) => s.key === a.subjectKey);
        if (a.chosenKey === "none") stat.none++;
        if (subj?.autoKey) { stat.matcherHad++; if (a.chosenKey === subj.autoKey) stat.agreeMatcher++; }
        if (a.chosenKey !== "none" && subj && !subj.ownCands.has(a.chosenKey)) stat.crossBorrow++;
      }
      return { clusterKey: b.cl.caseKeys[0], size: b.cl.size, assignments: res.assignments, conflicts: res.conflicts, missing: res.missing };
    } catch (e) { stat.ms += Date.now() - t0; stat.jsonFail++; return { clusterKey: b.cl.caseKeys[0], error: String(e?.message || e).slice(0, 120) }; }
  });
  results[model] = perCluster;
  const price = priceMap.get(model);
  const costPerCluster = price ? (stat.inTok / Math.max(1, stat.clusters)) * price.in + (stat.outTok / Math.max(1, stat.clusters)) * price.out : null;
  summary[model] = {
    jsonFail: stat.jsonFail, conflicts: stat.conflicts, missing: stat.missing,
    agreeMatcher: stat.matcherHad ? stat.agreeMatcher / stat.matcherHad : null,
    noneRate: stat.subjects ? stat.none / stat.subjects : 0,
    crossBorrow: stat.crossBorrow, avgMsPerCluster: Math.round(stat.ms / Math.max(1, stat.clusters)),
    costPerCluster,
  };
  const r = summary[model];
  console.error(`${model.padEnd(30)} jsonFail ${r.jsonFail}  conflicts ${r.conflicts}  missing ${r.missing}  agreeMatcher ${pct(r.agreeMatcher)}  none ${pct(r.noneRate)}  crossBorrow ${r.crossBorrow}  ${r.avgMsPerCluster}ms/cl  ${r.costPerCluster != null ? "$" + r.costPerCluster.toFixed(4) + "/cl" : ""}`);
}

// cross-model agreement per (cluster, subject)
if (MODELS.length === 2) {
  const [mA, mB] = MODELS;
  const idx = (arr) => new Map(arr.filter((c) => c.assignments).flatMap((c) => c.assignments.map((a) => [a.subjectKey, a.chosenKey])));
  const A = idx(results[mA]), B = idx(results[mB]);
  let agree = 0, total = 0;
  for (const [k, v] of A) if (B.has(k)) { total++; if (B.get(k) === v) agree++; }
  console.error(`\ncross-model agreement (${mA} vs ${mB}): ${agree}/${total} (${total ? (100 * agree / total).toFixed(0) : 0}%) of subjects assigned identically`);
}

// readable dump of the first few clusters (both models) for eyeballing
const nodeTitle = (k) => q.nodes[k]?.title || k;
const label = (k) => { const n = q.nodes[k]; const el = n?.ancestors?.length ? n.ancestors[n.ancestors.length - 1] : ""; return el && !n.title?.includes(el) ? `${el} - ${n.title}` : (n?.title || k); };
const lines = [];
for (const b of built.slice(0, 5)) {
  const cl = b.cl;
  lines.push(`\n=== cluster ${cl.caseKeys[0].slice(0, 12)} · ${cl.size} subjects · ${b.candidates.length} candidates · hop ${cl.hop.slice(0, 18)} ===`);
  lines.push(`change: ${b.change?.title || "(none)"}`);
  lines.push(`candidate pool:`);
  b.candidates.forEach((c, i) => lines.push(`  C${i + 1} ${c.key.slice(0, 14)}  ${label(c.key)}${c.context?.scope ? `  [${c.context.scope}]` : ""}${c.context?.parent ? `  under ${c.context.parent}` : ""}`));
  for (const s of b.subjects) {
    lines.push(`  SUBJECT ${label(s.key)}${s.context?.scope ? `  [${s.context.scope}]` : ""}${s.context?.parent ? `  under ${s.context.parent}` : ""}  (matcher: ${s.autoKey ? nodeTitle(s.autoKey) + " " + s.autoKey.slice(0, 12) : "—ambiguous—"})`);
    for (const model of MODELS) {
      const a = results[model].find((c) => c.clusterKey === cl.caseKeys[0])?.assignments?.find((x) => x.subjectKey === s.key);
      lines.push(`      ${model.split("/")[1].padEnd(18)} → ${a ? (a.chosenKey === "none" ? "none" : nodeTitle(a.chosenKey) + " " + a.chosenKey.slice(0, 12)) : "?"}   ${a?.why || ""}`);
    }
  }
}
fs.mkdirSync(path.join(ROOT, ".cache"), { recursive: true });
const dumpPath = path.join(ROOT, ".cache/cluster-assign-sample.txt");
fs.writeFileSync(dumpPath, lines.join("\n"));
fs.writeFileSync(path.join(ROOT, ".cache/cluster-assign-proto.json"), JSON.stringify({ stats, sample: sample.map((c) => ({ key: c.caseKeys[0], size: c.size })), summary, results }, null, 2));
console.error(`\nwrote .cache/cluster-assign-proto.json + ${path.relative(ROOT, dumpPath)} (first 5 clusters, both models)`);
