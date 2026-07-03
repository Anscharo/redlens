// Build the HARD gold set for the model bakeoff (plan §10.4). Selects the genuinely-ambiguous
// curation cases — the ones the whole disambiguation effort targets — across four buckets, writes a
// human-readable worksheet with the FULL context per case, and a gold JSON pre-filled with a
// heuristic guess + confidence. A human then verifies/edits `gold` (this is the "hand-labeled"
// step). caseKeys are content-addressed subjects, so labels survive a queue rebuild.
//
//   bun scripts/aux/curation-hard-set.mjs [--per 10]
import fs from "node:fs";
import path from "node:path";
import { buildClaimIndex, enrichSubject, enrichCandidates } from "../lib/curate-context.mjs";

const ROOT = process.cwd();
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const PER = Number(arg("--per", "10"));
const QUEUE = path.join(ROOT, "public/history-curation.json");
if (!fs.existsSync(QUEUE)) { console.error("missing public/history-curation.json — run pnpm htmlhist:curate first"); process.exit(1); }
const data = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
// The hard set is drawn from the RESIDUAL — the cases a human actually reviews. The auto-resolved
// ones (bijection / split / forward / containment) already have deterministic answers and serve as
// the bakeoff's EASY gold; they're not what discriminates models.
const AUTO = path.join(ROOT, "public/history-auto-decisions.json");
const resolved = new Set(fs.existsSync(AUTO) ? (JSON.parse(fs.readFileSync(AUTO, "utf8")).decisions || []).map((d) => d.caseKey) : []);
const claimIndex = buildClaimIndex(data.cases);
const N = data.nodes;
const titleOf = (k) => (k === "none" ? "(none)" : N[k]?.title || k);
const changeBySha = new Map();
for (const c of data.commits || []) if (c.prTitle || c.changeSummary) changeBySha.set(c.sha, { title: c.prTitle, summary: c.changeSummary });

// enriched view per case
const view = (c) => ({ kase: c, subject: enrichSubject(c.subjectKey, N), candidates: enrichCandidates(c, N, claimIndex), change: changeBySha.get(c.newerSha) });

// bucket predicates over the enriched candidates
const allTitlesEqual = (cs) => cs.length >= 2 && new Set(cs.map((c) => c.title)).size === 1;
const parentDisambig = (cs) => cs.some((c) => c.context?.parent) && new Set(cs.map((c) => c.context?.parent || "")).size >= 2;
const scopeMixed = (v) => v.subject?.context?.scope && new Set(v.candidates.map((c) => c.context?.scope).filter(Boolean)).size >= 2;

// A case belongs in the gold ONLY if SOME signal separates its candidates — else there is no
// determinable answer (byte-identical interchangeable duplicates) and labeling it is a coin flip.
const distinguishable = (cs) =>
  new Set(cs.map((c) => c.content)).size > 1 ||
  new Set(cs.map((c) => c.context?.scope).filter(Boolean)).size > 1 ||
  new Set(cs.map((c) => c.context?.parent).filter(Boolean)).size > 1 ||
  cs.some((c) => c.diff);

// Buckets over the RESIDUAL, matched to what it actually contains (seed-close + ambiguous + tier-2.5
// hop cases), each requiring a distinguishing signal so there's a determinable answer to label.
const buckets = {
  "scope-mixed": (v) => scopeMixed(v), // seed: the subject scope + candidates spanning scopes decide it
  "seed-resolvable": (v) => v.kase.kind === "seed-close" && distinguishable(v.candidates), // element/content/parent
  "hop-diff": (v) => (v.kase.kind === "ambiguous" || v.kase.kind === "tier-2.5") && v.candidates.some((c) => c.diff), // judged on the changed lines
  "seed-degenerate": (v) => v.kase.kind === "seed-close" && allTitlesEqual(v.candidates) && distinguishable(v.candidates), // same-title, told apart by parent/scope
};

// heuristic proposal (the human OVERRIDES this): the highest-score candidate that matches the
// subject scope, else the auto-pick, else the top candidate. Flag low-confidence for review.
function propose(v) {
  const subjScope = v.subject?.context?.scope;
  const scoped = v.candidates.filter((c) => c.context?.scope === subjScope);
  const pick = (scoped[0] || v.candidates.find((c) => c.key === v.kase.autoKey) || v.candidates[0]);
  const confident = !!(subjScope && scoped.length === 1);
  return { gold: pick?.key ?? "none", confident };
}

const seen = new Set();
const chosen = [];
for (const [bucket, pred] of Object.entries(buckets)) {
  let n = 0;
  for (const c of data.cases) {
    if (n >= PER) break;
    if (seen.has(c.key) || resolved.has(c.key)) continue; // residual only
    const v = view(c);
    if (!v.subject || v.candidates.length < 2 || !pred(v)) continue;
    seen.add(c.key); n++;
    const { gold, confident } = propose(v);
    chosen.push({ bucket, v, gold, confident });
  }
  console.error(`  ${bucket}: ${n}`);
}

// ---- hard-set keys for the UI: label the 40 in the curation page's "Hard set" filter ----------
// The nicest labeling UX is the curation UI itself (full content, diffs, scope, peek). This file
// tells the page which cases to isolate; you pick each there and ⤒ save, and the bakeoff reads those
// picks (history-decisions.json) as the gold — no by-hand JSON needed.
const HARDSET = path.join(ROOT, "public/history-hard-set.json");
fs.writeFileSync(HARDSET, JSON.stringify({
  kind: "html-era-curation-hard-set",
  caseKeys: chosen.map(({ v }) => v.kase.key),
  buckets: Object.fromEntries(chosen.map(({ v, bucket }) => [v.kase.key, bucket])),
}, null, 1));

// ---- gold JSON: SELF-CONTAINED, label by NUMBER (fallback if you prefer editing JSON) ---------
// Each case lists its candidate `options` numbered 1..n and a pre-filled `gold` guess. To label:
// set `gold` to the NUMBER of the true previous version, or "none" (newer doc is brand-new here),
// or "skip" (drop this case — genuinely unresolvable). Read .cache/curation-hard-set.md for the full
// content + diffs when a case isn't obvious from the option titles.
fs.mkdirSync(path.join(ROOT, ".cache"), { recursive: true });
const GOLD = path.join(ROOT, ".cache/curation-hard-gold.json");
const optLabel = (c) => `${c.title}${c.context?.scope ? ` [${c.context.scope}]` : ""}${c.context?.parent ? ` · under ${c.context.parent}` : ""}`;
fs.writeFileSync(GOLD, JSON.stringify({
  HOW_TO_LABEL: "Set each `gold` to the NUMBER of the correct option (the true previous version), or \"none\", or \"skip\". A guess is pre-filled — just fix the wrong ones. Details + diffs: .cache/curation-hard-set.md",
  cases: chosen.map(({ bucket, v, gold }) => ({
    caseKey: v.kase.key, bucket, subject: v.subject.title,
    gold: v.candidates.findIndex((c) => c.key === gold) + 1 || "none", // 1-based index of the guess, else "none"
    options: v.candidates.map((c, i) => `${i + 1}. ${optLabel(c)}`),
  })),
}, null, 2));

// ---- worksheet (markdown, for reading + labeling) --------------------------------
const clip = (s, n = 200) => (s || "").replace(/\s+/g, " ").slice(0, n);
const lines = ["# Curation hard set — label the `gold` in .cache/curation-hard-gold.json", ""];
for (const { bucket, v, gold } of chosen) {
  const s = v.subject;
  lines.push(`## [${bucket}] ${s.title}   \`${v.kase.key}\``);
  lines.push(`- **subject** scope=${s.context?.scope || "—"} under=${s.context?.parent || "—"} path=${(s.context?.path || []).join(" › ") || "—"}`);
  lines.push(`  - ${clip(s.content, 240)}`);
  if (v.change) lines.push(`- **change**: ${clip(v.change.title)} — ${clip(v.change.summary, 200)}`);
  const scoreByKey = new Map((v.kase.candidates || []).map((x) => [x.key, x.score]));
  const guessNum = v.candidates.findIndex((c) => c.key === gold) + 1 || "none";
  lines.push(`- **candidates** — set \`gold\` to a number (guess: **${guessNum}**):`);
  v.candidates.forEach((c, i) => {
    const mark = c.key === gold ? "◀ guess" : c.key === v.kase.autoKey ? "auto" : "";
    lines.push(`  - **${i + 1}.** \`${(scoreByKey.get(c.key) ?? 0).toFixed(2)}\` **${c.title}** scope=${c.context?.scope || "—"} under=${c.context?.parent || "—"}${c.soleHome ? " · SOLE-HOME" : ""} ${mark}${c.diff ? `\n      diff: ${clip(c.diff, 160)}` : ""}`);
  });
  lines.push("");
}
const WS = path.join(ROOT, ".cache/curation-hard-set.md");
fs.writeFileSync(WS, lines.join("\n"));
console.error(`\nselected ${chosen.length} hard cases → ${path.relative(ROOT, HARDSET)} (UI "Hard set" filter — label + ⤒ save) · ${path.relative(ROOT, GOLD)} (JSON fallback) · ${path.relative(ROOT, WS)} (worksheet)`);
