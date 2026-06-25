// Measured audit of the HTML-era threading (plan §10.2). Turns "I estimate ~90%"
// into "94.2% ± 2%, measured." Runs OFFLINE, never in the build path; output is a
// review report, never artifact data (so determinism/reproducibility are intact).
//
//   bun scripts/aux/audit-html-history.mjs            # dry: sample + show prompts, no LLM
//   OPENROUTER_API_KEY=… bun scripts/aux/audit-html-history.mjs --live   # measure
//
// It stratified-samples the deterministic decisions (seed close-calls vs decisive
// control, tier-2.5/2.7/3 sibling pairings, flagged-ambiguous), asks the LLM
// "is this identity choice correct?", and reports a per-batch error rate with a
// 95% Wilson interval. Sampling is deterministic (content-hash sort, no RNG).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "../lib/atlas-html.mjs";
import { matchNodes } from "../lib/history-identity.mjs";
import { getClient, getModel } from "../../src/server/llm.ts";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const LIVE = process.argv.includes("--live");
const git = (a) => execSync(`git -C "${REPO}" ${a}`, { maxBuffer: 1 << 30 }).toString();
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const SH = 8;
const shA = (c) => { const w = norm(c).split(" ").filter(Boolean), o = []; for (let i = 0; i + SH <= w.length; i++) o.push(w.slice(i, i + SH).join(" ")); return o; };
const clip = (s, n = 600) => (s || "").slice(0, n);

function parseMd(b) {
  const HRE = /^(#{1,6}) (\S+) - (.*?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->/;
  const ns = []; let c = null;
  for (const l of b.split("\n")) { const m = l.match(HRE); if (m) { if (c) c.content = norm(c._b.join(" ")); c = { uuid: m[5], title: m[3].trim(), content: "", _b: [] }; ns.push(c); } else if (c) c._b.push(l); }
  if (c) c.content = norm(c._b.join(" "));
  for (const n of ns) delete n._b;
  return ns;
}

// ---- collect the real decisions, tagged by batch, with evidence ----------------
function collect() {
  const md = parseMd(git("show 22cc27b5:'Sky Atlas/Sky Atlas.md'"));
  const shas = git("log --reverse --format=%H 7b43d159 -- 'Sky Atlas/Sky Atlas.html'").trim().split("\n");
  const commits = shas.map((sha) => ({ sha: sha.slice(0, 8), nodes: loadHtmlAt(sha, REPO) }));
  const order = commits.slice().reverse();
  const lastHtml = commits[commits.length - 1].nodes;

  // seed with evidence: chosen md + runner-up
  const mdSh = md.map((m) => new Set(shA(m.content)));
  const inv = new Map();
  md.forEach((_, i) => { for (const s of mdSh[i]) { let a = inv.get(s); if (!a) inv.set(s, (a = [])); a.push(i); } });
  const seedClose = [], seedDecisive = [], uuidByRow = new Map();
  for (const row of lastHtml) {
    const rSh = shA(row.content); if (!rSh.length) continue;
    const tally = new Map();
    for (const s of rSh) { const l = inv.get(s); if (l) for (const mi of l) tally.set(mi, (tally.get(mi) || 0) + 1); }
    if (!tally.size) continue;
    const ranked = [...tally].map(([mi, c]) => [mi, c / Math.min(rSh.length, mdSh[mi].size)]).sort((a, b) => b[1] - a[1]);
    const [bestMi, best] = ranked[0], second = ranked[1]?.[1] ?? 0;
    if (best < 0.5) continue;
    uuidByRow.set(row, md[bestMi].uuid);
    const ev = { batch: best - second < 0.1 ? "seed-close" : "seed-decisive", row: clip(row.content), chosen: { id: "A", text: clip(md[bestMi].content) }, alts: ranked.slice(1, 4).map(([mi], k) => ({ id: "BCD"[k], text: clip(md[mi].content, 300) })) };
    (ev.batch === "seed-close" ? seedClose : seedDecisive).push(ev);
  }

  // backward thread → collect tier-2.5/2.7/3 pairings + flagged ambiguous
  for (const n of order[0].nodes) n.uuid = uuidByRow.get(n) || ("syn:" + n.contentHash);
  const tier25 = [], tier27 = [], tier3 = [], ambiguous = [];
  let curr = order[0].nodes;
  for (let i = 1; i < order.length; i++) {
    const r = matchNodes(order[i].nodes, curr);
    for (const p of r.pairs) {
      p.older.uuid = p.newer.uuid;
      const ev = { sha: order[i].sha, older: clip(p.older.content), newer: clip(p.newer.content), title: p.older.title };
      if (p.tier === 2.5) tier25.push(ev); else if (p.tier === 2.7) tier27.push(ev); else if (p.tier === 3) tier3.push(ev);
    }
    for (const a of r.ambiguous) ambiguous.push({ sha: order[i].sha, older: clip(a.older.content), cand: clip((a.candidates?.[0]?.content) || ""), reason: a.reason });
    for (const o of r.olderUnmatched) o.uuid = "syn:" + o.contentHash;
    curr = order[i].nodes;
  }
  return { "seed-close": seedClose, "seed-decisive": seedDecisive, "tier-2.5": tier25, "tier-2.7": tier27, "tier-3": tier3, ambiguous };
}

// deterministic stratified sample: stable sort by content hash, take first n
const sample = (arr, n) => arr.map((x) => [md5(JSON.stringify(x)), x]).sort((a, b) => a[0] < b[0] ? -1 : 1).slice(0, n).map(([, x]) => x);

// ---- prompts -------------------------------------------------------------------
const SYS_SEED = "You verify a document match made when an atlas was migrated from HTML to markdown. Given an HTML-era row's text and candidate markdown documents (A is the chosen match, B/C/D alternatives), decide if A is the best continuation of the row's content. Reply ONLY JSON: {\"verdict\":\"correct\"|\"incorrect\"|\"uncertain\",\"bestId\":\"A|B|C|D\",\"why\":\"<short>\"}.";
const SYS_PAIR = "You verify document-identity threading between two consecutive atlas commits. The OLDER and NEWER texts were judged to be the SAME document (edited in place). Decide if that is right. Reply ONLY JSON: {\"verdict\":\"correct\"|\"incorrect\"|\"uncertain\",\"why\":\"<short>\"}.";
const SYS_AMB = "The matcher could not confidently thread a document. Given the OLDER text and the top candidate NEWER text, decide whether they are the same document. Reply ONLY JSON: {\"verdict\":\"correct\"|\"incorrect\"|\"uncertain\",\"why\":\"<short>\"}.";

function buildPrompt(batch, c) {
  if (batch.startsWith("seed")) return { system: SYS_SEED, user: `ROW:\n${c.row}\n\nA (chosen):\n${c.chosen.text}\n\n${c.alts.map((a) => `${a.id}:\n${a.text}`).join("\n\n")}` };
  if (batch === "ambiguous") return { system: SYS_AMB, user: `OLDER:\n${c.older}\n\nNEWER (candidate):\n${c.cand}` };
  return { system: SYS_PAIR, user: `OLDER:\n${c.older}\n\nNEWER:\n${c.newer}` };
}

async function verdict(prompt) {
  const r = await getClient().chat.completions.create({
    model: getModel(), temperature: 0, response_format: { type: "json_object" },
    messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
  });
  try { return JSON.parse(r.choices[0].message.content); } catch { return { verdict: "uncertain", why: "unparseable" }; }
}

// Wilson 95% interval for a proportion (errors/n)
function wilson(e, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = e / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

// ---- run -----------------------------------------------------------------------
const SAMPLE_SIZES = { "seed-close": 80, "seed-decisive": 40, "tier-2.5": 40, "tier-2.7": 33, "tier-3": 40, ambiguous: 40 };
const cases = collect();
console.error("collected decision pool:", Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v.length])));
const sampled = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, sample(v, SAMPLE_SIZES[k])]));

if (!LIVE) {
  const totalPool = Object.values(cases).reduce((a, v) => a + v.length, 0);
  const totalSample = Object.values(sampled).reduce((a, v) => a + v.length, 0);
  console.error(`\n--dry: would audit ${totalSample} cases (of ${totalPool}) via ${LIVE ? getModel() : "OpenRouter (set OPENROUTER_API_KEY + --live)"}.`);
  const ex = sampled["seed-close"][0];
  const p = buildPrompt("seed-close", ex);
  console.error("\n=== example prompt (seed-close) ===\nsystem:", p.system, "\nuser:\n", p.user.slice(0, 500));
  fs.writeFileSync(path.join(ROOT, ".cache/audit-html-cases.json"), JSON.stringify(sampled, null, 1));
  console.error("\nwrote .cache/audit-html-cases.json (the exact cases that would be audited).");
} else {
  const report = {};
  for (const [batch, items] of Object.entries(sampled)) {
    let err = 0, unc = 0; const misses = [];
    for (const c of items) {
      const v = await verdict(buildPrompt(batch, c));
      const wrong = v.verdict === "incorrect" || (batch.startsWith("seed") && v.bestId && v.bestId !== "A");
      if (wrong) { err++; if (misses.length < 5) misses.push({ ...c, why: v.why }); }
      if (v.verdict === "uncertain") unc++;
    }
    const n = items.length, [lo, hi] = wilson(err, n);
    report[batch] = { n, errors: err, uncertain: unc, errorRate: +(err / n).toFixed(3), ci95: [+lo.toFixed(3), +hi.toFixed(3)], accuracy: +(1 - err / n).toFixed(3), misses };
    console.error(`${batch.padEnd(14)} n=${n}  errors=${err}  accuracy=${(100 * (1 - err / n)).toFixed(1)}%  95%CI[${(100 * (1 - hi)).toFixed(1)}–${(100 * (1 - lo)).toFixed(1)}%]  uncertain=${unc}`);
  }
  fs.writeFileSync(path.join(ROOT, ".cache/audit-html-report.json"), JSON.stringify(report, null, 2));
  console.error("\nwrote .cache/audit-html-report.json");
}
