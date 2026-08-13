// Shared setup: load the pre-#117 HTML commits (root 4e931dfd → 7b43d159) and thread
// REAL uuids backward from the #117 markdown seed, applying the committed curation
// decisions (plan §10.4) exactly as the shipped `public/history-html-era.json` does.
//
// Extracted from prepare-html-history.mjs so a second consumer (scripts/prehist/
// genesis-bridge.mjs) can get commits[0].nodes — the ROOT commit's nodes, each
// carrying its real (or synthetic) uuid — without re-deriving that mapping via a
// heuristic (docNo|title) join against the frozen JSON artifact, which silently
// assumes event order matches node order for colliding keys (see pre-git-history.md,
// "ride-along decisions"). Same inputs + same flags ⇒ byte-identical thread state to
// what's actually shipped in atlas_history, since threading is deterministic (no
// randomUUID, pure git-log + content matching).
//
// prepare-html-history.mjs calls threadHtmlEra() and proceeds with buildEvents/lineage/
// artifact-writing exactly as before — this module changes nothing about its output.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "./atlas-html.mjs";
import { seedFromMd, threadBackward } from "../htmlhist/history-html-era.mjs";
import { mechanismToMethod } from "../htmlhist/auto-curate.mjs";
import { contentDupCounts, occKey } from "../htmlhist/history-occkey.mjs";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const HTML = "Sky Atlas/Sky Atlas.html", MD = "Sky Atlas/Sky Atlas.md";
export const SEED_HTML = "7b43d159", MD117 = "22cc27b5";

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const git = (a) => execSync(`git -C "${REPO}" ${a}`, { maxBuffer: 1 << 30 }).toString();
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// git's %cI spells a UTC commit's offset `+00:00`, but the frozen artifact has always
// carried `Z` for those — meaning the two forms depend on which machine ran the freeze,
// and a rerun elsewhere silently reformats ~1.5k historical event dates (same instants,
// pure diff noise, against the "historical diffs must not change" bar). Non-UTC offsets
// are untouched. Canonicalize here so the freeze is byte-stable across environments.
const canonicalDate = (d) => (typeof d === "string" ? d.replace(/\+00:00$/, "Z") : d);

// #117 markdown monolith → nodes with real uuid4 + body prose (for the seed).
function parseMd117(blob) {
  const HRE = /^(#{1,6}) (\S+) - (.*?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->/;
  const nodes = []; let cur = null;
  for (const line of blob.split("\n")) {
    const m = line.match(HRE);
    if (m) { if (cur) cur.content = norm(cur._b.join(" ")); cur = { uuid: m[5], doc_no: m[2], title: m[3].trim(), type: m[4], _b: [] }; nodes.push(cur); }
    else if (cur) cur._b.push(line);
  }
  if (cur) cur.content = norm(cur._b.join(" "));
  for (const n of nodes) delete n._b;
  return nodes;
}

/** Load the html-era commits (oldest = commits[0] = repo root 4e931dfd) + the #117 md seed. */
function loadHtmlEraCommits() {
  const seqBySha = new Map();
  git("log --reverse --format=%H").trim().split("\n").forEach((h, i) => h && seqBySha.set(h.slice(0, 7), i + 1));

  const commitMeta = new Map();
  for (const line of git(`log --format=%H%x09%cI%x09%s ${SEED_HTML} -- '${HTML}'`).trim().split("\n")) {
    const [full, date, ...rest] = line.split("\t");
    const subject = rest.join("\t");
    const pr = (subject.match(/\(#(\d+)\)/) || [])[1] || null;
    commitMeta.set(full.slice(0, 7), { date: canonicalDate(date), pr: pr ? Number(pr) : null, subject });
  }

  const md = parseMd117(git(`show ${MD117}:'${MD}'`));
  const shas = git(`log --reverse --format=%H ${SEED_HTML} -- '${HTML}'`).trim().split("\n");
  const commits = shas.map((full) => {
    const sha = full.slice(0, 7);
    return { sha, seq: seqBySha.get(sha) ?? null, nodes: loadHtmlAt(full, REPO) };
  });
  return { commits, shas, seqBySha, commitMeta, md };
}

/** Resolve the committed curation decisions (plan §10.4) into seed/hop override maps. */
function resolveDecisionOverrides(decisionsPath, { commits, shas, md }) {
  const file = JSON.parse(fs.readFileSync(decisionsPath, "utf8"));
  const rawUuid = new Map();
  const mdContentByUuid = new Map();
  { const HRE = /^(#{1,6}) (\S+) - (.*?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->/;
    let cur = null, body = [];
    const flush = () => { if (cur) { const b = body.join("\n").trim(); rawUuid.set(md5(b), cur); mdContentByUuid.set(cur, b); } };
    for (const line of execSync(`git -C "${REPO}" show ${MD117}:'${MD}'`, { maxBuffer: 1 << 30 }).toString().split("\n")) {
      const m = line.match(HRE);
      if (m) { flush(); cur = m[5]; body = []; }
      else if (cur) body.push(line);
    }
    flush();
  }
  const nodeIndex = new Map();
  shas.forEach((full, idx) => {
    const sha8 = full.slice(0, 8);
    const dupCounts = contentDupCounts(commits[idx].nodes);
    for (const n of commits[idx].nodes) {
      nodeIndex.set(`${sha8}:${n.contentHash}`, n);
      nodeIndex.set(occKey(sha8, n, dupCounts), n);
    }
  });

  const seedOverrides = new Map(), hopOverrides = new Map();
  const methodPins = [];
  const splitOf = new Map();
  let unresolved = 0;
  for (const d of file.decisions || []) {
    const chosen = d.chosenKey === "none" ? null : nodeIndex.get(d.chosenKey);
    if (d.chosenKey !== "none" && !chosen) { unresolved++; continue; }
    const method = d.method ?? mechanismToMethod(d.auto);
    if (d.newerSha === MD117) {
      const part = String(d.subjectKey).split(":")[1];
      const mdUuid = /^[0-9a-f-]{36}$/.test(part) ? part : rawUuid.get(part);
      if (!mdUuid) { unresolved++; continue; }
      seedOverrides.set(mdUuid, chosen);
      if (method === "ai" || method === "human") methodPins.push({ kind: "seed", mdUuid, method });
    } else {
      const newer = nodeIndex.get(d.subjectKey);
      if (!newer) { unresolved++; continue; }
      hopOverrides.set(newer, chosen);
      if (method === "ai" || method === "human") methodPins.push({ kind: "hop", newer, newerSha: d.newerSha, method });
    }
  }
  const applied = { total: (file.decisions || []).length, seed: seedOverrides.size, hop: hopOverrides.size, unresolved };

  const uuidOf = (sk) => { const p = String(sk).split(":")[1]; return /^[0-9a-f-]{36}$/.test(p) ? p : rawUuid.get(p); };
  const byContent = new Map();
  for (const d of file.decisions || []) {
    if (d.newerSha !== MD117) continue;
    const uuid = uuidOf(d.subjectKey);
    const content = uuid && mdContentByUuid.get(uuid);
    if (content == null) continue;
    let g = byContent.get(content); if (!g) byContent.set(content, (g = { kept: [], none: [] }));
    (d.chosenKey === "none" ? g.none : g.kept).push(uuid);
  }
  for (const { kept, none } of byContent.values()) {
    if (!kept.length || !none.length) continue;
    const source = kept.slice().sort()[0];
    for (const u of none) splitOf.set(u, source);
  }

  return { seedOverrides, hopOverrides, methodPins, splitOf, applied };
}

/** Just the cross-format seam seed — the #117 md docs, the last HTML commit's rows, and
 *  the correspondence between them — WITHOUT the backward thread over the other 78
 *  commits. For passes that only reason about the seam itself (thread-structural.mjs).
 *  Shares loadHtmlEraCommits + resolveDecisionOverrides with threadHtmlEra, so the seed
 *  it returns is the same one the shipped artifact is built from. */
export function seedHtmlEra({ decisionsPath = null } = {}) {
  const { commits, shas, commitMeta, md } = loadHtmlEraCommits();
  const resolved = decisionsPath ? resolveDecisionOverrides(decisionsPath, { commits, shas, md }) : null;
  const last = commits[commits.length - 1];
  const seed = seedFromMd(md, last.nodes, resolved?.seedOverrides ? { overrides: resolved.seedOverrides } : {});
  return { md, htmlNodes: last.nodes, seed, lastSha: last.sha, commitMeta, applied: resolved?.applied ?? null };
}

/** Load the html-era commits + thread real uuids backward from the #117 seed, applying
 *  curation overrides. `decisionsPath` null ⇒ plain auto-threaded (no curation). Returns
 *  everything prepare-html-history.mjs needs to build events, plus `commits` (commits[0]
 *  = root, nodes carry `.uuid`) for any other consumer that just needs root identity. */
export function threadHtmlEra({ decisionsPath = null, recover = true, diff = true } = {}) {
  const { commits, shas, commitMeta, md } = loadHtmlEraCommits();
  const { seedOverrides, hopOverrides, methodPins, splitOf, applied } = decisionsPath
    ? resolveDecisionOverrides(decisionsPath, { commits, shas, md })
    : { seedOverrides: null, hopOverrides: null, methodPins: [], splitOf: new Map(), applied: null };

  const lastSha = commits[commits.length - 1].sha;
  const seed = seedFromMd(md, commits[commits.length - 1].nodes, seedOverrides ? { overrides: seedOverrides } : {});
  const thread = threadBackward(commits, {
    seed: seed.uuidByRow, recover, diff, ...(hopOverrides ? { overrides: hopOverrides } : {}),
  });

  return { commits, commitMeta, md, seed, thread, methodPins, splitOf, applied, lastSha };
}
