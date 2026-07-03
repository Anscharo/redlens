// SIGNAL PROTOTYPE (read-only): rename-announcement mining.
//
// Scans every cached PR/forum text (.cache/github-prs/*.json) for explicit rename /
// introduce / replace phrasing and builds a ledger of { oldName, newName, pr }. Then,
// for a case whose SUBJECT title contains a newName, it prefers the CANDIDATE whose
// title contains the corresponding oldName (an old→new rename means the older-side doc
// still carries the old name). Symmetric fallback: subject carries oldName, candidate
// carries newName (older side already renamed, rare).
//
// Measured with the shared harness: residual newly-disambiguated + disagreement rate
// against resolved ambiguous cases. Writes .cache/signal-rename-mining.json only.
//
//   node scripts/aux/signal-rename-mining.mjs

import fs from "node:fs";
import path from "node:path";
import { loadSignalData, crossValidate, measureResidual, writeOut } from "./residual-signal-lib.mjs";

const PR_DIR = path.join(process.cwd(), ".cache/github-prs");

// Rename phrasings, most explicit first. Each returns [oldName, newName] from its match.
// Names are Title-Case-ish spans that stop at sentence/bullet punctuation.
const NAME = "([A-Z0-9][^.•\\n\"“”]{1,60}?)";
const RENAME_PATTERNS = [
  new RegExp(`rename[sd]?(?:\\s+the\\s+term)?\\s+${NAME}\\s+(?:to|with)\\s+${NAME}(?=[\\s.,•]|$)`, "ig"),
  new RegExp(`renaming of\\s+${NAME}\\s+to\\s+${NAME}`, "ig"),
  new RegExp(`update the term\\s+${NAME}\\s+with\\s+${NAME}`, "ig"),
  new RegExp(`${NAME}\\s+is now known as\\s+${NAME}`, "ig"),
  new RegExp(`${NAME}\\s*,?\\s+formerly\\s+${NAME}`, "ig"), // note: reversed (new, formerly old)
];

const clean = (s) => s.replace(/^["'“”\s]+|["'“”\s:.-]+$/g, "").replace(/\s+/g, " ").trim();
const quote = (s) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

function mineLedger() {
  const ledger = [];
  if (!fs.existsSync(PR_DIR)) return ledger;
  for (const f of fs.readdirSync(PR_DIR).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(fs.readFileSync(path.join(PR_DIR, f), "utf8"));
    const pr = j.number ?? j.pr ?? Number(path.basename(f, ".json"));
    const txt = quote(`${j.title || ""}. ${j.summary || j.body || ""}`);
    RENAME_PATTERNS.forEach((re, idx) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(txt))) {
        let oldName = clean(m[1]);
        let newName = clean(m[2]);
        if (idx === 4) [oldName, newName] = [newName, oldName]; // "X, formerly Y" => old=Y new=X
        if (oldName && newName && oldName.toLowerCase() !== newName.toLowerCase() && oldName.length >= 2 && newName.length >= 2) {
          ledger.push({ oldName, newName, pr });
        }
      }
    });
  }
  return ledger;
}

// Case-insensitive whole-phrase containment (word-boundary-ish) so "Star" doesn't hit
// "Restart"; also matches the exact title.
function contains(hay, needle) {
  if (!hay || !needle) return false;
  const h = hay.toLowerCase();
  const n = needle.toLowerCase();
  const i = h.indexOf(n);
  if (i < 0) return false;
  const before = i === 0 ? " " : h[i - 1];
  const after = i + n.length >= h.length ? " " : h[i + n.length];
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}

function main() {
  const ctx = loadSignalData();
  const ledger = mineLedger();
  // dedupe ledger entries for reporting
  const seen = new Set();
  const uniq = [];
  for (const e of ledger) {
    const k = `${e.oldName.toLowerCase()}=>${e.newName.toLowerCase()}`;
    if (!seen.has(k)) { seen.add(k); uniq.push(e); }
  }

  // pickFn: prefer candidate whose title carries the OLD name of a rename whose NEW
  // name the subject carries (or the symmetric case). Score = specificity (longer name
  // match wins), so "Launch Agent 1 Development Company" beats a bare "Agent".
  const pickFn = (kase) => {
    const subj = ctx.node(kase.subjectKey);
    if (!subj) return null;
    const subjTitle = subj.title || "";
    const hits = [];
    for (const cand of kase.candidates || []) {
      const cn = ctx.node(cand.key);
      if (!cn) continue;
      const ct = cn.title || "";
      for (const r of uniq) {
        // forward: subject has new name, candidate has old name
        if (contains(subjTitle, r.newName) && contains(ct, r.oldName)) {
          hits.push({ key: cand.key, spec: r.oldName.length + r.newName.length, dir: "fwd", rule: `${r.oldName}→${r.newName} (PR${r.pr})` });
        }
        // reverse: subject has old name, candidate has new name
        if (contains(subjTitle, r.oldName) && contains(ct, r.newName)) {
          hits.push({ key: cand.key, spec: r.oldName.length + r.newName.length, dir: "rev", rule: `${r.oldName}→${r.newName} (PR${r.pr})` });
        }
      }
    }
    if (!hits.length) return null;
    // one distinct candidate must dominate; if two different candidates both match, abstain.
    hits.sort((a, b) => b.spec - a.spec);
    const best = hits[0];
    const distinct = new Set(hits.map((h) => h.key));
    if (distinct.size > 1) {
      // allow if the top-spec candidate is unique at the max spec level
      const topSpec = best.spec;
      const topKeys = new Set(hits.filter((h) => h.spec === topSpec).map((h) => h.key));
      if (topKeys.size > 1) return null;
    }
    return { chosenKey: best.key, confidence: best.spec, reason: `${best.dir} ${best.rule}` };
  };

  const residual = measureResidual(pickFn, ctx);
  const cv = crossValidate(pickFn, ctx, ctx.resolvedEvaluable);

  const out = {
    signal: "rename-announcement-mining",
    ledgerSize: uniq.length,
    ledger: uniq,
    residual,
    crossValidation: cv,
  };
  const rel = writeOut(".cache/signal-rename-mining.json", out);
  console.log(`[rename-mining] ledger=${uniq.length} rename pairs`);
  console.log(`[rename-mining] RESIDUAL: disambiguated ${residual.decidedCount}/${residual.total}`);
  for (const dd of residual.decided) console.log(`    ${dd.caseKey.slice(0, 20)} -> "${dd.chosenTitle}"  (${dd.reason})`);
  console.log(`[rename-mining] CROSS-VAL: decided ${cv.decided}/${cv.evaluable}  agree=${cv.agree} disagree=${cv.disagree}  disagreeRate=${(cv.disagreeRate * 100).toFixed(1)}%`);
  console.log(`[rename-mining] wrote ${rel}`);
}

main();
