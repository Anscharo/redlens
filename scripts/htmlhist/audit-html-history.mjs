// Measured audit of the HTML-era threading (plan §10.2). Turns "I estimate ~90%"
// into "98.7% ± 2%, measured." Runs OFFLINE, never in the build path; the output is
// a review report, never artifact data (so determinism/reproducibility are intact).
//
//   bun scripts/htmlhist/audit-html-history.mjs            # dry: sample + show prompts, no LLM
//   OPENROUTER_API_KEY=… bun scripts/htmlhist/audit-html-history.mjs --live   # measure
//
// What it does, end to end:
//   1. collect()  — replay the real seed + backward-thread decisions and bucket each
//                   one into a "batch" (seed-close, tier-2.5, ambiguous, …) with the
//                   exact evidence the matcher saw.
//   2. sample()   — take a deterministic stratified sample of each batch.
//   3. verdict()  — ask an LLM judge, per case, "is this identity decision correct?"
//   4. report     — per-batch error rate + 95% Wilson interval, then a pool-weighted
//                   overall accuracy (the headline number).
//
// A "decision" = the matcher choosing which document an HTML-era row continues.
// Sampling is deterministic (content-hash sort, no RNG) so reruns audit the same cases.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "./atlas-html.mjs";
import { matchNodes } from "./history-identity.mjs";
import { getClient, getModel } from "../../src/server/llm.ts";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const LIVE = process.argv.includes("--live");
console.error(`[audit] model=${getModel()} live=${LIVE}`);

// run a git command inside the atlas submodule and return its stdout
const git = (args) => execSync(`git -C "${REPO}" ${args}`, { maxBuffer: 1 << 30 }).toString();
// lower-case, strip punctuation, collapse whitespace → bare comparable prose tokens
const normalize = (text) => (text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const md5 = (text) => crypto.createHash("md5").update(text).digest("hex");

// A "shingle" is a sliding window of N consecutive words. Two documents that share
// many shingles share long verbatim runs of prose — this is how the seed measures
// content overlap across the HTML→markdown boundary.
const SHINGLE_WORDS = 8;
const shingles = (text) => {
  const words = normalize(text).split(" ").filter(Boolean);
  const out = [];
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) out.push(words.slice(i, i + SHINGLE_WORDS).join(" "));
  return out;
};

const clip = (text, max = 900) => (text || "").slice(0, max);

// Render one document as an evidence block for the LLM prompt. `formatBlock` keeps
// the doc_no (stable WITHIN the HTML era → useful for pair/ambiguous threading);
// `formatSeedBlock` DROPS it — the HTML→md migration renumbered every document
// (e.g. A.2.10 → A.2.9.1.1.2.1.4), so across the seed boundary the number is pure
// noise that a weak judge over-weights into wrong picks. Title+type+prose only.
const formatBlock = (doc) => `[${doc.doc_no || "—"}] ${doc.title || "(untitled)"}${doc.type ? ` <${doc.type}>` : ""}\n${doc.text || "(no prose)"}`;
const formatSeedBlock = (doc) => `${doc.title || "(untitled)"}${doc.type ? ` <${doc.type}>` : ""}\n${doc.text || "(no prose)"}`;

// progress logging (everything to stderr so stdout stays clean for piping)
const START_TIME = Date.now();
const elapsed = () => `${((Date.now() - START_TIME) / 1000).toFixed(1)}s`;
const log = (message) => console.error(`[${elapsed().padStart(6)}] ${message}`);

// Parse the #117 markdown monolith into nodes carrying the real UUID minted at the
// migration (groups: 1=heading hashes, 2=doc_no, 3=title, 4=type, 5=uuid).
function parseMarkdownDocs(blob) {
  const HEADING_RE = /^(#{1,6}) (\S+) - (.*?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->/;
  const nodes = [];
  let current = null;
  for (const line of blob.split("\n")) {
    const match = line.match(HEADING_RE);
    if (match) {
      if (current) current.content = normalize(current._body.join(" "));
      current = { uuid: match[5], doc_no: match[2], title: match[3].trim(), type: match[4].trim(), content: "", _body: [] };
      nodes.push(current);
    } else if (current) {
      current._body.push(line);
    }
  }
  if (current) current.content = normalize(current._body.join(" "));
  for (const node of nodes) delete node._body;
  return nodes;
}

// Jaccard similarity of two token SETS: |intersection| / |union|, where
// |union| = |A| + |B| − |intersection|. 0 = nothing in common, 1 = identical sets.
// Used to score how much two TITLES overlap when content alone can't separate them.
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
};

// ---- collect the real decisions, tagged by batch, with evidence ----------------
function collect() {
  log("collect: parsing #117 markdown…");
  const markdownDocs = parseMarkdownDocs(git("show 22cc27b5:'Sky Atlas/Sky Atlas.md'"));
  const htmlCommitShas = git("log --reverse --format=%H 7b43d159 -- 'Sky Atlas/Sky Atlas.html'").trim().split("\n");
  log(`collect: converting ${htmlCommitShas.length} HTML commits (slow — turndown per row)…`);
  const htmlCommits = htmlCommitShas.map((sha, i) => {
    if (i % 20 === 0) log(`  …converted ${i}/${htmlCommitShas.length} commits`);
    return { sha: sha.slice(0, 8), nodes: loadHtmlAt(sha, REPO) };
  });
  const newestFirst = htmlCommits.slice().reverse();
  const lastHtmlNodes = htmlCommits[htmlCommits.length - 1].nodes;
  log(`collect: ${markdownDocs.length} md docs, ${lastHtmlNodes.length} last-HTML rows — seeding…`);

  // --- SEED: map each last-HTML row to the markdown doc it became at #117 --------
  // Build a shingle → [markdownDocIndex] inverted index, so a row can find every md
  // doc it shares prose with in one pass. This MIRRORS seedFromMd in
  // scripts/htmlhist/history-html-era.mjs, including the title tiebreak below — keep in sync.
  const markdownShingles = markdownDocs.map((doc) => new Set(shingles(doc.content)));
  const markdownTitleTokens = markdownDocs.map((doc) => new Set(normalize(doc.title).split(" ").filter(Boolean)));
  const shingleIndex = new Map();
  markdownDocs.forEach((_, index) => {
    for (const shingle of markdownShingles[index]) {
      let list = shingleIndex.get(shingle);
      if (!list) shingleIndex.set(shingle, (list = []));
      list.push(index);
    }
  });

  // Title tiebreak: content shingles can't separate near-identical siblings that
  // differ only by chain/instance ("Base USDC Deposit Maximum" vs "Unichain USDC
  // Deposit Maximum") — their prose is boilerplate. When several md docs cover the
  // row within TITLE_TIE_WINDOW, prefer the one whose TITLE best matches the row's
  // title, but only override the top content pick past TITLE_TIE_MARGIN so an
  // already-exact content match is never regressed. (`ranked` is sorted by coverage.)
  const TITLE_TIE_WINDOW = 0.1, TITLE_TIE_MARGIN = 0.34;
  const tiebreak = (ranked, rowTitle) => {
    const [bestIndex, bestCoverage] = ranked[0];
    const rowTitleTokens = new Set(normalize(rowTitle).split(" ").filter(Boolean));
    if (!rowTitleTokens.size) return bestIndex;
    const baseTitleScore = jaccard(rowTitleTokens, markdownTitleTokens[bestIndex]);
    let altIndex = bestIndex, altTitleScore = baseTitleScore;
    for (const [index, coverage] of ranked) {
      if (bestCoverage - coverage > TITLE_TIE_WINDOW) break; // ranked desc → rest are further
      const titleScore = jaccard(rowTitleTokens, markdownTitleTokens[index]);
      if (titleScore > altTitleScore + 1e-9) { altTitleScore = titleScore; altIndex = index; }
    }
    return (altIndex !== bestIndex && altTitleScore - baseTitleScore >= TITLE_TIE_MARGIN) ? altIndex : bestIndex;
  };

  const seedClose = [], seedDecisive = [], uuidByRow = new Map();
  for (const row of lastHtmlNodes) {
    const rowShingles = shingles(row.content);
    if (!rowShingles.length) continue;
    // tally how many shingles this row shares with each candidate md doc
    const overlapByDoc = new Map();
    for (const shingle of rowShingles) {
      const docList = shingleIndex.get(shingle);
      if (docList) for (const index of docList) overlapByDoc.set(index, (overlapByDoc.get(index) || 0) + 1);
    }
    if (!overlapByDoc.size) continue;
    // coverage = shared shingles / the smaller of the two shingle counts (containment)
    const ranked = [...overlapByDoc]
      .map(([index, shared]) => [index, shared / Math.min(rowShingles.length, markdownShingles[index].size)])
      .sort((a, b) => b[1] - a[1]);
    const [, bestCoverage] = ranked[0], secondCoverage = ranked[1]?.[1] ?? 0;
    if (bestCoverage < 0.5) continue; // too little overlap to seed at all
    const bestIndex = tiebreak(ranked, row.title); // post-tiebreak pick = what production seeds
    uuidByRow.set(row, markdownDocs[bestIndex].uuid);

    // one evidence block per candidate; `chash` lets the scorer detect a swap between
    // byte-identical docs (change-neutral). `id` is the A/B/C/D label in the prompt.
    const markdownEvidence = (index, id, maxChars) => ({
      id, doc_no: markdownDocs[index].doc_no, title: markdownDocs[index].title, type: markdownDocs[index].type,
      chash: md5(markdownDocs[index].content), text: clip(markdownDocs[index].content, maxChars),
    });
    const altIndexes = ranked.map(([index]) => index).filter((index) => index !== bestIndex).slice(0, 3);
    // "close" = top two candidates within 0.1 coverage (the hard calls); else "decisive"
    const evidence = {
      batch: bestCoverage - secondCoverage < 0.1 ? "seed-close" : "seed-decisive",
      row: { doc_no: row.doc_no, title: row.title, type: row.type, text: clip(row.content) },
      chosen: markdownEvidence(bestIndex, "A"),
      alts: altIndexes.map((index, k) => markdownEvidence(index, "BCD"[k], 300)),
    };
    (evidence.batch === "seed-close" ? seedClose : seedDecisive).push(evidence);
  }

  // --- BACKWARD THREAD: walk newest→oldest, collecting each matcher decision -----
  // Seed the newest commit's uuids, then matchNodes() each older commit against the
  // one after it. We bucket the resulting same-doc pairings by which tier matched
  // them (2.5/2.7/3) and separately collect the rows the matcher FLAGGED as ambiguous.
  for (const node of newestFirst[0].nodes) node.uuid = uuidByRow.get(node) || ("syn:" + node.contentHash);
  const tier25 = [], tier27 = [], tier3 = [], ambiguous = [];
  let newer = newestFirst[0].nodes;
  for (let i = 1; i < newestFirst.length; i++) {
    const result = matchNodes(newestFirst[i].nodes, newer, { recoverByContent: !process.argv.includes("--no-recover") });
    const htmlEvidence = (node) => ({ doc_no: node.doc_no, title: node.title, type: node.type, text: clip(node.content) });
    for (const pair of result.pairs) {
      pair.older.uuid = pair.newer.uuid; // carry identity backward
      const evidence = { sha: newestFirst[i].sha, older: htmlEvidence(pair.older), newer: htmlEvidence(pair.newer) };
      if (pair.tier === 2.5) tier25.push(evidence);
      else if (pair.tier === 2.7) tier27.push(evidence);
      else if (pair.tier === 3) tier3.push(evidence);
    }
    for (const flagged of result.ambiguous) {
      ambiguous.push({
        sha: newestFirst[i].sha, older: htmlEvidence(flagged.older),
        cand: flagged.candidates?.[0] ? htmlEvidence(flagged.candidates[0]) : null, reason: flagged.reason,
      });
    }
    for (const older of result.olderUnmatched) older.uuid = "syn:" + older.contentHash;
    newer = newestFirst[i].nodes;
  }
  return { "seed-close": seedClose, "seed-decisive": seedDecisive, "tier-2.5": tier25, "tier-2.7": tier27, "tier-3": tier3, ambiguous };
}

// Deterministic stratified sample: stable-sort each batch by a content hash of the
// case, take the first n. No RNG → the same cases are audited on every run.
const sample = (cases, n) =>
  cases.map((item) => [md5(JSON.stringify(item)), item]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([, item]) => item);

// ---- prompts -------------------------------------------------------------------
const SYS_SEED = "You verify a document match made when an atlas was migrated from HTML to markdown. Each block is `title <type>` followed by prose. Document NUMBERS were fully renumbered during the migration, so they are omitted — judge ONLY by title, type, and prose. Given an HTML-era ROW and candidate markdown documents (A is the chosen match, B/C/D alternatives), pick the candidate whose title and prose best continue the ROW. Minor lowercasing/whitespace/punctuation differences are migration artifacts, NOT content changes. Set bestId to your pick. Reply ONLY JSON: {\"verdict\":\"correct\"|\"incorrect\"|\"uncertain\",\"bestId\":\"A|B|C|D\",\"why\":\"<short>\"}.";
const SYS_PAIR = "You verify document-IDENTITY threading between two consecutive atlas commits. Each block is `[doc_no] title <type>` followed by prose. OLDER and NEWER were judged to be the SAME document, edited in place. CONTENT IS EXPECTED TO CHANGE between versions — values, actors, amounts, wording, even a rename or renumber are NORMAL edits to one document over time, NOT evidence of a different document. Answer 'incorrect' ONLY if these are genuinely DIFFERENT documents (a different subject/role/concept entirely), not merely because the text was edited. Reply ONLY JSON: {\"verdict\":\"correct\"|\"incorrect\"|\"uncertain\",\"why\":\"<short>\"}.";
const SYS_AMB = "The matcher could not confidently thread a document. Each block is `[doc_no] title <type>` followed by prose. Given OLDER and the top candidate NEWER, decide whether they are the same document, weighing title/doc_no/type first then prose. Reply ONLY JSON: {\"verdict\":\"correct\"|\"incorrect\"|\"uncertain\",\"why\":\"<short>\"}.";

function buildPrompt(batch, item) {
  if (batch.startsWith("seed")) {
    const alts = item.alts.map((alt) => `${alt.id}:\n${formatSeedBlock(alt)}`).join("\n\n");
    return { system: SYS_SEED, user: `ROW:\n${formatSeedBlock(item.row)}\n\nA (chosen):\n${formatSeedBlock(item.chosen)}\n\n${alts}` };
  }
  if (batch === "ambiguous") {
    return { system: SYS_AMB, user: `OLDER:\n${formatBlock(item.older)}\n\nNEWER (candidate):\n${item.cand ? formatBlock(item.cand) : "(no candidate)"}` };
  }
  return { system: SYS_PAIR, user: `OLDER:\n${formatBlock(item.older)}\n\nNEWER:\n${formatBlock(item.newer)}` };
}

// One LLM judgement, with retry. A stalled request is failed fast (35s timeout) so a
// hung connection can't block its concurrency slot; transient errors back off + retry.
async function verdict(prompt, tries = 4) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await getClient().chat.completions.create({
        model: getModel(), temperature: 0, response_format: { type: "json_object" },
        messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      }, { timeout: 35000, maxRetries: 0 });
      let parsed;
      try { parsed = JSON.parse(response.choices[0].message.content); }
      catch { return { verdict: "uncertain", why: "unparseable" }; }
      return parsed && typeof parsed === "object" ? parsed : { verdict: "uncertain", why: "non-object" };
    } catch (error) {
      if (attempt === tries - 1) return { verdict: "uncertain", why: "api-error: " + (error?.message || error) };
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
}

// Run `fn` over `items` with at most `limit` in flight at once (the LLM calls are the
// bottleneck; running them sequentially blew past the 10-minute timeout). Order preserved.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; out[index] = await fn(items[index], index); }
  }));
  return out;
}

// Wilson 95% confidence interval for a proportion (errors / total) — a binomial
// interval that stays sensible for small samples and rates near 0 or 1.
function wilson(errors, total) {
  if (!total) return [0, 0];
  const z = 1.96, rate = errors / total, denom = 1 + (z * z) / total;
  const center = rate + (z * z) / (2 * total);
  const margin = z * Math.sqrt((rate * (1 - rate)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, (center - margin) / denom), Math.min(1, (center + margin) / denom)];
}

// ---- run -----------------------------------------------------------------------
const SAMPLE_SIZES = { "seed-close": 80, "seed-decisive": 40, "tier-2.5": 40, "tier-2.7": 33, "tier-3": 40, ambiguous: 40 };
const pool = collect();
console.error("collected decision pool:", Object.fromEntries(Object.entries(pool).map(([batch, cases]) => [batch, cases.length])));
const sampled = Object.fromEntries(Object.entries(pool).map(([batch, cases]) => [batch, sample(cases, SAMPLE_SIZES[batch])]));

if (!LIVE) {
  // dry mode: write the exact cases that WOULD be audited + show one example prompt
  const totalPool = Object.values(pool).reduce((sum, cases) => sum + cases.length, 0);
  const totalSample = Object.values(sampled).reduce((sum, cases) => sum + cases.length, 0);
  console.error(`\n--dry: would audit ${totalSample} cases (of ${totalPool}) via ${LIVE ? getModel() : "OpenRouter (set OPENROUTER_API_KEY + --live)"}.`);
  const example = sampled["seed-close"][0];
  const prompt = buildPrompt("seed-close", example);
  console.error("\n=== example prompt (seed-close) ===\nsystem:", prompt.system, "\nuser:\n", prompt.user.slice(0, 500));
  fs.writeFileSync(path.join(ROOT, ".cache/audit-html-cases.json"), JSON.stringify(sampled, null, 1));
  console.error("\nwrote .cache/audit-html-cases.json (the exact cases that would be audited).");
} else {
  const CONCURRENCY = 20;
  const report = {};
  for (const [batch, items] of Object.entries(sampled)) {
    let errors = 0, strictErrors = 0, uncertain = 0, equivalentSwaps = 0, done = 0;
    const misses = [];
    log(`${batch}: ${items.length} cases @ concurrency ${CONCURRENCY}…`);
    const verdicts = await mapLimit(items, CONCURRENCY, async (item) => {
      const result = await verdict(buildPrompt(batch, item));
      if (++done % 20 === 0) log(`  ${batch}: ${done}/${items.length}`);
      return result;
    });

    // The error definition is batch-specific — it must mirror what the matcher DID:
    //  • seed: matcher mapped ROW→A. A STRICT error = judge picks a different doc
    //    (bestId≠A); the verdict string is advisory (a self-contradictory "incorrect"
    //    + bestId:A still agrees A is the match). The CHANGE-AWARE error additionally
    //    forgives picking a CONTENT-IDENTICAL alternative (same chash): swapping
    //    byte-identical docs yields identical change-history, so it cannot produce a
    //    wrong/missing change — the user's bar. Both are reported; equivalentSwaps
    //    counts the forgiven ones.
    //  • pair (2.5/2.7/3): matcher declared older==newer. Error = judge says "not the same".
    //  • ambiguous: matcher DECLINED to thread (flag, never guess). Error = judge says
    //    they ARE the same → a real MISSED thread. "not same"/uncertain = matcher was right.
    const isStrictSeedError = (result) =>
      batch.startsWith("seed") && (result.bestId ? result.bestId !== "A" : result.verdict === "incorrect");
    const isChangeError = (result, item) => {
      if (batch.startsWith("seed")) {
        if (!isStrictSeedError(result)) return false;
        const picked = result.bestId && item.alts.find((alt) => alt.id === result.bestId);
        return !(picked && picked.chash === item.chosen.chash); // identical-content swap → not a change error
      }
      return batch === "ambiguous" ? result.verdict === "correct" : result.verdict === "incorrect";
    };

    items.forEach((item, index) => {
      const result = verdicts[index] || { verdict: "uncertain", why: "null-verdict" };
      const strict = isStrictSeedError(result) || (!batch.startsWith("seed") && isChangeError(result, item));
      if (strict) strictErrors++;
      if (isChangeError(result, item)) {
        errors++;
        if (misses.length < 8) misses.push({ ...item, verdict: result.verdict, bestId: result.bestId, why: result.why });
      } else if (strict) {
        equivalentSwaps++; // strict-wrong but change-neutral (identical-content swap)
      }
      if (result.verdict === "uncertain") uncertain++;
    });

    const total = items.length, [low, high] = wilson(errors, total);
    report[batch] = {
      n: total, errors, errorsStrict: strictErrors, equivSwaps: equivalentSwaps, uncertain,
      errorRate: +(errors / total).toFixed(3), ci95: [+low.toFixed(3), +high.toFixed(3)],
      accuracy: +(1 - errors / total).toFixed(3), accuracyStrict: +(1 - strictErrors / total).toFixed(3), misses,
    };
    console.error(`${batch.padEnd(14)} n=${total}  err=${errors}(strict ${strictErrors}, equiv ${equivalentSwaps})  acc=${(100 * (1 - errors / total)).toFixed(1)}%  95%CI[${(100 * (1 - high)).toFixed(1)}–${(100 * (1 - low)).toFixed(1)}%]  unc=${uncertain}`);
  }

  // Pool-weighted overall accuracy: each batch's measured error RATE is scaled up to
  // its TRUE pool size, so big batches dominate — this is the headline number measured
  // against the zero-tolerance bar. Reported both change-aware and strict-identity.
  let weightedPool = 0, weightedErrors = 0, weightedStrictErrors = 0, weightedUncertain = 0;
  for (const [batch, batchReport] of Object.entries(report)) {
    const poolSize = pool[batch].length;
    weightedPool += poolSize;
    weightedErrors += poolSize * (batchReport.errors / batchReport.n);
    weightedStrictErrors += poolSize * (batchReport.errorsStrict / batchReport.n);
    weightedUncertain += poolSize * (batchReport.uncertain / batchReport.n);
  }
  const overall = {
    pool: weightedPool, estErrors: +weightedErrors.toFixed(1), estErrorsStrict: +weightedStrictErrors.toFixed(1),
    estUncertain: +weightedUncertain.toFixed(1),
    accuracy: +(1 - weightedErrors / weightedPool).toFixed(4), accuracyStrict: +(1 - weightedStrictErrors / weightedPool).toFixed(4),
  };
  report.__overall = overall;
  console.error(`\n${"OVERALL".padEnd(14)} pool=${weightedPool}  weighted-accuracy=${(100 * overall.accuracy).toFixed(2)}% (change-aware) / ${(100 * overall.accuracyStrict).toFixed(2)}% (strict identity)  est-mis-threads≈${overall.estErrors}  est-uncertain≈${overall.estUncertain}`);
  fs.writeFileSync(path.join(ROOT, ".cache/audit-html-report.json"), JSON.stringify(report, null, 2));
  console.error("\nwrote .cache/audit-html-report.json");
}
