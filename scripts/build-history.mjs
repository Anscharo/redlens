#!/usr/bin/env node
/**
 * Walks the git history of vendor/next-gen-atlas and emits per-node history
 * files at public/history/<uuid>.json.
 *
 * Only processes commits that touch Sky Atlas.md. For each commit, parses the
 * atlas at that revision and the previous revision, diffs per-node content
 * hashes, and records which nodes changed.
 *
 * PR metadata (title, body, author, review/comment counts) is fetched via
 * `gh api` and cached in .cache/github-prs/<pr>.json.
 *
 * For "Atlas Edit Proposal" PRs, the script attempts to match each bullet in
 * the PR body to the specific nodes it affected (by keyword overlap between
 * the bullet title and node titles).
 *
 * Run: node scripts/build-history.mjs
 * Requires: gh CLI authenticated with access to sky-ecosystem/next-gen-atlas
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ATLAS_REPO = path.join(ROOT, "vendor/next-gen-atlas");
const ATLAS_FILE = "Sky Atlas/Sky Atlas.md";
const OUT_DIR = path.join(ROOT, "public/history");
const PR_CACHE_DIR = path.join(ROOT, ".cache/github-prs");
const REPO = "sky-ecosystem/next-gen-atlas";

const HEADING_RE =
  /^(#{1,6}) ([\w.-]+) - (.+?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->$/;

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(args, opts = {}) {
  return execSync(`git ${args}`, { cwd: ATLAS_REPO, encoding: "utf8", maxBuffer: 100 * 1024 * 1024, ...opts }).trim();
}

/** Get all commits (oldest-first) that touch the atlas file */
function getCommits() {
  const raw = git(`log --reverse --format="%H %aI %s" -- "${ATLAS_FILE}"`);
  return raw.split("\n").filter(Boolean).map(line => {
    const [hash, date, ...rest] = line.split(" ");
    return { hash, date, message: rest.join(" ") };
  });
}

/** Read the atlas file at a specific commit */
function readAtlasAt(hash) {
  try {
    return git(`show ${hash}:"${ATLAS_FILE}"`);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parse atlas into uuid → { doc_no, title, type, contentHash }
// ---------------------------------------------------------------------------

function parseAtlas(text) {
  const nodes = new Map();
  if (!text) return nodes;

  const lines = text.split("\n");
  let currentId = null;
  let contentLines = [];

  function flush() {
    if (currentId) {
      const content = contentLines.join("\n").trim();
      const entry = nodes.get(currentId);
      entry.contentHash = crypto.createHash("md5").update(content).digest("hex");
    }
  }

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      flush();
      const [, , doc_no, title, type, id] = m;
      currentId = id;
      contentLines = [];
      nodes.set(id, { doc_no, title, type, contentHash: "" });
    } else if (currentId) {
      contentLines.push(line);
    }
  }
  flush();
  return nodes;
}

// ---------------------------------------------------------------------------
// Diff two snapshots → { added, modified, removed }
// ---------------------------------------------------------------------------

function diffSnapshots(prev, curr) {
  const added = [];
  const modified = [];
  const removed = [];

  for (const [id, node] of curr) {
    const old = prev.get(id);
    if (!old) {
      added.push({ id, ...node });
    } else if (old.contentHash !== node.contentHash || old.title !== node.title) {
      modified.push({ id, ...node, prevTitle: old.title });
    }
  }
  for (const [id, node] of prev) {
    if (!curr.has(id)) {
      removed.push({ id, ...node });
    }
  }

  return { added, modified, removed };
}

// ---------------------------------------------------------------------------
// PR metadata
// ---------------------------------------------------------------------------

function extractPrNumber(message) {
  const m = message.match(/\(#(\d+)\)\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

async function fetchPr(prNum) {
  const cacheFile = path.join(PR_CACHE_DIR, `${prNum}.json`);
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  }

  console.error(`  fetching PR #${prNum}…`);
  try {
    const raw = execSync(
      `gh pr view ${prNum} --repo ${REPO} --json title,body,author,comments,reviews,url`,
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    );
    const pr = JSON.parse(raw);
    const data = {
      number: prNum,
      title: pr.title,
      body: pr.body ?? "",
      author: pr.author?.login ?? null,
      url: pr.url,
      commentCount: pr.comments?.length ?? 0,
      reviewCount: pr.reviews?.length ?? 0,
      approvalCount: (pr.reviews ?? []).filter(r => r.state === "APPROVED").length,
    };
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
    return data;
  } catch (e) {
    console.error(`  warning: could not fetch PR #${prNum}: ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// PR body bullet parsing + node matching
// ---------------------------------------------------------------------------

/** Parse bullets from an Atlas Edit Proposal PR body.
 *  Format: `- **Bold Title** — description text` or `- **Bold Title** - description`
 */
function parsePrBullets(body) {
  const bullets = [];
  const re = /^[-*]\s+\*\*(.+?)\*\*\s*[—–-]\s*(.+)/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    bullets.push({ title: m[1].trim(), description: m[2].trim() });
  }
  return bullets;
}

/** Tokenize a string into lowercase words, dropping stop words */
function tokenize(s) {
  const STOP = new Set(["the", "a", "an", "and", "or", "for", "in", "on", "to", "at", "by", "with", "from", "of", "is", "as"]);
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
}

/** Score how well a bullet title matches a node title.
 *  Uses the shorter token set as the denominator so short node titles
 *  ("Emergency Response") can still match long bullet titles
 *  ("Update Emergency Response Article To Agent Framework"). */
function matchScore(bulletTitle, nodeTitle, bulletDescription = "") {
  const bTokens = tokenize(bulletTitle);
  const nTokens = tokenize(nodeTitle);
  if (bTokens.length === 0 || nTokens.length === 0) return 0;

  const bSet = new Set(bTokens);
  const nSet = new Set(nTokens);

  let hits = 0;
  for (const t of nSet) {
    if (bSet.has(t)) hits++;
  }

  // Title-vs-title score: fraction of *node* tokens found in bullet title
  const titleScore = hits / nSet.size;

  // Bonus: check how many node title tokens appear in the bullet description
  let descHits = 0;
  if (bulletDescription) {
    const dTokens = new Set(tokenize(bulletDescription));
    for (const t of nSet) {
      if (dTokens.has(t)) descHits++;
    }
  }
  const descScore = bulletDescription ? descHits / nSet.size : 0;

  // Combine: title match is primary, description adds up to 0.2 bonus
  return titleScore + Math.min(descScore * 0.4, 0.2);
}

/** For each changed node, find the best-matching bullet (if any).
 *  Returns Map<nodeId, { bulletTitle, bulletDescription }> */
function matchBulletsToNodes(bullets, changedNodes) {
  if (bullets.length === 0) return new Map();
  const matches = new Map();

  for (const node of changedNodes) {
    let bestScore = 0;
    let bestBullet = null;
    for (const bullet of bullets) {
      const score = matchScore(bullet.title, node.title, bullet.description);
      if (score > bestScore) {
        bestScore = score;
        bestBullet = bullet;
      }
    }
    // Require at least 35% of node title tokens to match
    if (bestScore >= 0.35 && bestBullet) {
      matches.set(node.id, {
        bulletTitle: bestBullet.title,
        bulletDescription: bestBullet.description,
        matchScore: Math.round(bestScore * 100),
      });
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PR_CACHE_DIR, { recursive: true });

  console.error("loading commits…");
  const commits = getCommits();
  console.error(`  ${commits.length} commits touch ${ATLAS_FILE}`);

  // nodeId → array of history entries
  const history = new Map();

  let prevSnapshot = new Map();
  let prevHash = null;
  let totalChanges = 0;

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const pct = ((i + 1) / commits.length * 100).toFixed(0);
    console.error(`[${pct}%] ${commit.hash.slice(0, 7)} ${commit.message.slice(0, 60)}`);

    const text = readAtlasAt(commit.hash);
    const snapshot = parseAtlas(text);

    // First commit: everything is "added" but we skip it — it's the baseline.
    if (i === 0) {
      prevSnapshot = snapshot;
      prevHash = commit.hash;
      continue;
    }

    const { added, modified, removed } = diffSnapshots(prevSnapshot, snapshot);
    const allChanged = [...added, ...modified, ...removed];

    if (allChanged.length === 0) {
      prevSnapshot = snapshot;
      prevHash = commit.hash;
      continue;
    }

    // Fetch PR metadata
    const prNum = extractPrNumber(commit.message);
    const pr = prNum ? await fetchPr(prNum) : null;

    // Try to match bullets to nodes for edit proposals
    let bulletMatches = new Map();
    if (pr?.body) {
      const bullets = parsePrBullets(pr.body);
      if (bullets.length > 0) {
        bulletMatches = matchBulletsToNodes(bullets, allChanged);
      }
    }

    // Record history entries
    for (const node of allChanged) {
      const changeType = added.includes(node) ? "added" : modified.includes(node) ? "modified" : "removed";

      const entry = {
        date: commit.date.slice(0, 10),
        commitHash: commit.hash.slice(0, 7),
        changeType,
      };

      if (pr) {
        entry.pr = pr.number;
        entry.prTitle = pr.title;
        entry.prAuthor = pr.author;
        entry.prUrl = pr.url;
        if (pr.reviewCount > 0) entry.reviewCount = pr.reviewCount;
        if (pr.approvalCount > 0) entry.approvalCount = pr.approvalCount;
        if (pr.commentCount > 0) entry.commentCount = pr.commentCount;
      }

      const bulletMatch = bulletMatches.get(node.id);
      if (bulletMatch) {
        entry.summary = bulletMatch.bulletTitle;
        entry.description = bulletMatch.bulletDescription;
        // matchScore omitted from output — internal quality signal only
      } else if (pr?.body && !parsePrBullets(pr.body).length) {
        // Non-bulleted PR (Spark proposals, etc.) — use PR title as summary
        entry.summary = pr.title;
        if (pr.body.length < 500) entry.description = pr.body;
      }

      if (!history.has(node.id)) history.set(node.id, []);
      history.get(node.id).push(entry);
      totalChanges++;
    }

    prevSnapshot = snapshot;
    prevHash = commit.hash;
  }

  // Write per-node files
  let fileCount = 0;
  for (const [nodeId, entries] of history) {
    const filePath = path.join(OUT_DIR, `${nodeId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entries));
    fileCount++;
  }

  console.error(`\ndone: ${fileCount} node history files, ${totalChanges} total change entries`);

  // Write a manifest so the frontend knows which nodes have history
  const manifest = {};
  for (const [nodeId, entries] of history) {
    manifest[nodeId] = entries.length;
  }
  fs.writeFileSync(path.join(OUT_DIR, "_manifest.json"), JSON.stringify(manifest));
  console.error(`manifest: ${Object.keys(manifest).length} nodes with history`);
}

main().catch(e => { console.error(e); process.exit(1); });
