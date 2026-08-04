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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { HEADING_RE, unquoteYamlName } from "../lib/atlas-parser.mjs";
import {
  classifyDiff,
  classifyPrTitle,
  cleanDescription,
  matchBulletsToNodes,
  parsePrBullets,
} from "../lib/history-classify.mjs";
import { sql, waitForDb } from "../../src/server/db.ts";
import { runMigrations } from "../../src/server/migrate.ts";
import { lineDiff } from "../../src/lib/diffCore.ts";
import {
  eventToRow,
  gitCommitSeq,
  htmlEraRows,
  preEraRows,
  readHistoryCursor,
  stampMigrationSeam,
  upsertHistory,
} from "../../src/server/history/history-db.ts";

// Two sinks: default writes history straight to Postgres (atlas_history);
// `--out-json` writes the legacy per-node public/history/<uuid>.json files
// (DB-less — used by the canary/artifact tests). `--full` forces a full walk.
const OUT_JSON = process.argv.includes("--out-json");
const FULL = process.argv.includes("--full");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ATLAS_REPO = path.join(ROOT, "vendor/next-gen-atlas");
const ATLAS_FILE = "Sky Atlas/Sky Atlas.md";
const CONTENT_DIR = "content";
const OUT_DIR = path.join(ROOT, "public/history");
const PR_CACHE_DIR = path.join(ROOT, ".cache/github-prs");
const REPO = "sky-ecosystem/next-gen-atlas";

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(args, opts = {}) {
  return execSync(`git ${args}`, {
    cwd: ATLAS_REPO,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    ...opts,
  }).trim();
}

/** Get all commits (oldest-first) that touch either the legacy monolithic
 *  Sky Atlas.md or the atomized content/ tree (post-PR #236). */
function getCommits() {
  const raw = git(
    `log --reverse --format="%H %aI %s" -- "${ATLAS_FILE}" "${CONTENT_DIR}"`,
  );
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, date, ...rest] = line.split(" ");
      return { hash, date, message: rest.join(" ") };
    });
}

/** Returns "atomized" if the commit's tree has content/, "monolithic" if it
 *  has the old Sky Atlas.md, or null if neither (shouldn't happen given the
 *  commit set we enumerate). */
function detectFormat(hash) {
  const out = git(
    `ls-tree --name-only ${hash} -- "${ATLAS_FILE}" "${CONTENT_DIR}"`,
  );
  const has = new Set(out.split("\n").filter(Boolean));
  if (has.has(CONTENT_DIR)) return "atomized";
  if (has.has(ATLAS_FILE)) return "monolithic";
  return null;
}

/** Read the legacy monolithic atlas file at a specific commit */
function readMonolithicAt(hash) {
  try {
    return git(`show ${hash}:"${ATLAS_FILE}"`);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parse atlas into uuid → { doc_no, title, type, contentHash, content }
// ---------------------------------------------------------------------------

function makeNodeEntry(doc_no, title, type, content, path) {
  return {
    doc_no,
    title,
    type,
    content,
    path,
    contentHash: crypto.createHash("md5").update(content).digest("hex"),
  };
}

function parseMonolithic(text) {
  const nodes = new Map();
  if (!text) return nodes;

  const lines = text.split("\n");
  let cur = null;
  let buf = [];

  // All monolithic-format nodes share the same path: the single source file.
  // This makes `prev.path !== curr.path` cleanly detect the cutover (atomization)
  // and any post-cutover doc moves, while never firing within the monolithic era.
  const monoPath = ATLAS_FILE;

  function flush() {
    if (cur) {
      const content = buf.join("\n").trim();
      cur.entry.content = content;
      cur.entry.contentHash = crypto.createHash("md5").update(content).digest("hex");
    }
  }

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      flush();
      const [, , doc_no, title, type, id] = m;
      const entry = { doc_no, title, type, contentHash: "", content: "", path: monoPath };
      nodes.set(id, entry);
      cur = { id, entry };
      buf = [];
    } else if (cur) {
      buf.push(line);
    }
  }
  flush();
  return nodes;
}

// ---------------------------------------------------------------------------
// Atomized-format reader (post-PR #236)
// ---------------------------------------------------------------------------

/** Strip frontmatter + the markdown heading line from a document.md body.
 *  Returns the trimmed body string used for hashing/diffing.
 *
 *  Equivalence with parseMonolithic: in the composed file, each node's
 *  contentLines are exactly the lines between its heading and the next.
 *  In document.md those are exactly the lines after the leading heading
 *  line that sits below the frontmatter — once both are trimmed, the
 *  byte stream is identical, so contentHashes agree across formats. */
function extractBody(raw) {
  const lines = raw.split("\n");
  let i = 0;

  // Frontmatter: --- ... ---
  if (lines[0] === "---") {
    i = 1;
    while (i < lines.length && lines[i] !== "---") i++;
    i++; // past closing ---
  }

  // Skip blanks before the heading line
  while (i < lines.length && lines[i].trim() === "") i++;

  // Skip the markdown heading (e.g. "## A.0 - Atlas Preamble [Scope]")
  if (i < lines.length && /^#{1,6} /.test(lines[i])) i++;

  return lines.slice(i).join("\n").trim();
}

/** Parse the document.md frontmatter for the fields we care about.
 *  Frontmatter is a small subset of YAML (`key: value` per line); a hand
 *  parser is fine here and avoids pulling in a YAML dep. Unquoting (both
 *  quoting styles `decompose.py` emits) is shared with atlas-parser.mjs's
 *  parseDocumentMd via unquoteYamlName. */
function parseFrontmatter(raw) {
  const lines = raw.split("\n");
  if (lines[0] !== "---") return null;
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") break;
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) out[m[1]] = unquoteYamlName(m[2]);
  }
  return out;
}

/** Walk content/**\/document.md at a commit, using one ls-tree + one
 *  cat-file --batch invocation. Returns the same Map shape as parseMonolithic. */
function loadAtomizedAt(hash) {
  const lsTree = git(`ls-tree -r ${hash} -- "${CONTENT_DIR}"`);
  const blobs = []; // [{sha, path}]
  for (const line of lsTree.split("\n")) {
    if (!line) continue;
    // Format: <mode> <type> <sha>\t<path>
    const tabIdx = line.indexOf("\t");
    if (tabIdx < 0) continue;
    const meta = line.slice(0, tabIdx).split(/\s+/);
    const filePath = line.slice(tabIdx + 1);
    if (meta[1] !== "blob") continue;
    if (!filePath.endsWith("/document.md")) continue;
    blobs.push({ sha: meta[2], path: filePath });
  }

  if (blobs.length === 0) return new Map();

  // Bulk-read all blobs in one cat-file --batch invocation.
  const input = blobs.map((b) => b.sha).join("\n") + "\n";
  const res = spawnSync("git", ["cat-file", "--batch"], {
    cwd: ATLAS_REPO,
    input,
    maxBuffer: 500 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`git cat-file --batch failed: ${res.stderr?.toString() ?? ""}`);
  }
  const buf = res.stdout;

  const nodes = new Map();
  let pos = 0;
  for (const blob of blobs) {
    // Header line: "<sha> <type> <size>\n"
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) throw new Error(`malformed cat-file output for ${blob.path}`);
    const header = buf.slice(pos, nl).toString("utf8");
    const parts = header.split(" ");
    if (parts[0] !== blob.sha || parts[1] !== "blob") {
      throw new Error(`cat-file header mismatch for ${blob.path}: got ${header}`);
    }
    const size = parseInt(parts[2], 10);
    const start = nl + 1;
    const raw = buf.slice(start, start + size).toString("utf8");
    pos = start + size + 1; // skip trailing \n after blob

    const fm = parseFrontmatter(raw);
    if (!fm || !fm.id) continue; // not a document.md we recognize
    const body = extractBody(raw);
    nodes.set(fm.id, makeNodeEntry(fm.docNo, fm.name, fm.type, body, blob.path));
  }
  return nodes;
}

/** Format-aware snapshot loader: returns the same Map<uuid,…> shape
 *  regardless of which atlas representation existed at <hash>. */
function loadSnapshot(hash) {
  const fmt = detectFormat(hash);
  if (fmt === "monolithic") return parseMonolithic(readMonolithicAt(hash));
  if (fmt === "atomized") return loadAtomizedAt(hash);
  return new Map();
}

// ---------------------------------------------------------------------------
// Line/word diff machinery lives in the shared core (src/lib/diffCore.ts),
// also used by the preview diff path — one implementation, byte-identical
// output. This script runs under Bun, which imports .ts directly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Diff two snapshots → { added, modified, removed, moved }
//
// `moved` is independent of `modified` — a node that is renamed AND has its
// content edited in the same commit appears in both lists, producing two
// separate history entries. This makes "renumbered" / "atomized" events
// visible even when the content didn't change.
// ---------------------------------------------------------------------------

function diffSnapshots(prev, curr) {
  const added = [];
  const modified = [];
  const removed = [];
  const moved = [];

  for (const [id, node] of curr) {
    const old = prev.get(id);
    if (!old) {
      added.push({ id, ...node });
      continue;
    }
    if (old.contentHash !== node.contentHash || old.title !== node.title) {
      modified.push({ id, ...node, prevTitle: old.title });
    }
    if (old.path && node.path && old.path !== node.path) {
      moved.push({ id, ...node, movedFrom: old.path, movedTo: node.path });
    }
  }
  for (const [id, node] of prev) {
    if (!curr.has(id)) {
      removed.push({ id, ...node });
    }
  }

  return { added, modified, removed, moved };
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
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
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
      approvalCount: (pr.reviews ?? []).filter((r) => r.state === "APPROVED").length,
    };
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
    return data;
  } catch (e) {
    console.error(`  warning: could not fetch PR #${prNum}: ${e.message}`);
    return null;
  }
}


// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Build [name, doc_no-prefix] pairs for prime agents (and operational
 *  executors when they map to atlas subtrees). Read once at startup from
 *  public/relations.json + docs.json. */
function loadAgentNamePrefixes() {
  const relsPath = path.join(ROOT, "public/relations.json");
  const docsPath = path.join(ROOT, "public/docs.json");
  if (!fs.existsSync(relsPath) || !fs.existsSync(docsPath)) return [];
  const rels = JSON.parse(fs.readFileSync(relsPath, "utf8"));
  const docs = JSON.parse(fs.readFileSync(docsPath, "utf8")).nodes;
  const out = [];
  for (const e of rels.entities ?? []) {
    if (e.et !== "agent" || !e.did) continue;
    const doc = docs[e.did];
    if (!doc?.doc_no) continue;
    if (e.name) out.push([e.name, doc.doc_no]);
  }
  // Sort by name length DESC so "Launch Agent 7" matches before "Launch Agent"
  // would (no such conflict today, but keeps multi-token names safe).
  return out.sort((a, b) => b[0].length - a[0].length);
}

async function main() {
  fs.mkdirSync(PR_CACHE_DIR, { recursive: true });
  if (OUT_JSON) fs.mkdirSync(OUT_DIR, { recursive: true });
  const agentNamePrefixes = loadAgentNamePrefixes();
  console.error(`  ${agentNamePrefixes.length} agent name → doc_no scopes`);

  const lastCommitFile = path.join(OUT_DIR, "_last_commit.txt");
  const manifestFile = path.join(OUT_DIR, "_manifest.json");

  // Incremental cursor: the short sha of the newest commit already recorded.
  // DB sink reads it from atlas_history; --out-json reads the checkpoint files.
  // `--full` forces a full walk in either mode.
  let lastCommitHash = null;
  let existingManifest = {};
  let prevSnapshot = new Map();
  let startIndex = 0;

  if (!OUT_JSON) {
    await waitForDb();
    await runMigrations();
    if (!FULL) lastCommitHash = await readHistoryCursor(sql);
    console.error(`db sink: history cursor = ${lastCommitHash ? lastCommitHash.slice(0, 7) : "none (full)"}`);
  } else if (!FULL && fs.existsSync(lastCommitFile) && fs.existsSync(manifestFile)) {
    lastCommitHash = fs.readFileSync(lastCommitFile, "utf8").trim();
    existingManifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    console.error(
      `incremental mode: last processed commit ${lastCommitHash.slice(0, 7)}, ${Object.keys(existingManifest).length} nodes in manifest`,
    );
  }

  console.error("loading commits…");
  const allCommits = getCommits();
  console.error(`  ${allCommits.length} commits touch ${ATLAS_FILE} or ${CONTENT_DIR}/`);

  if (lastCommitHash) {
    // Cursor may be a 7-char short sha (DB) or a full sha (legacy file); the
    // full commit hashes start with either, so prefix-match handles both.
    const idx = allCommits.findIndex((c) => c.hash.startsWith(lastCommitHash));
    if (idx >= 0) {
      startIndex = idx + 1;
      // Reconstruct prevSnapshot from the last processed commit so diffs are correct
      prevSnapshot = loadSnapshot(allCommits[idx].hash);
      console.error(
        `  skipping ${startIndex} already-processed commits, ${allCommits.length - startIndex} new`,
      );
    } else {
      console.error(`  last commit not found in history, falling back to full rebuild`);
      lastCommitHash = null;
      existingManifest = {};
    }
  }

  const commits = allCommits.slice(startIndex);

  if (commits.length === 0) {
    console.error("no new commits to process");
    // The --out-json sink derives everything it writes from these commits, so with none
    // there is nothing left to do. The DB sink must NOT stop here: the frozen pre-#117
    // artifacts below are ingested idempotently on every run and change INDEPENDENTLY of
    // the atlas git log — a re-freeze (htmlhist:apply / prehist:*) ships new rows without
    // any new upstream commit. Returning here stranded a re-freeze until some unrelated
    // atlas commit happened to trigger a cycle, which on a current cursor is never.
    if (OUT_JSON) return;
  }

  // nodeId → new entries added in this run only
  const newHistory = new Map();
  let totalChanges = 0;

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const pct = (((i + 1) / commits.length) * 100).toFixed(0);
    console.error(`[${pct}%] ${commit.hash.slice(0, 7)} ${commit.message.slice(0, 60)}`);

    const snapshot = loadSnapshot(commit.hash);

    // On the very first atlas commit, prevSnapshot is empty so every node is "added".
    // This records the creation of all nodes that haven't changed since.

    const { added, modified, removed, moved } = diffSnapshots(prevSnapshot, snapshot);
    // Tag each changed node with its event type. A node can appear twice
    // (once as "modified", once as "moved") — both entries are emitted.
    const events = [
      ...added.map((n) => ({ node: n, changeType: "added" })),
      ...modified.map((n) => ({ node: n, changeType: "modified" })),
      ...removed.map((n) => ({ node: n, changeType: "removed" })),
      ...moved.map((n) => ({ node: n, changeType: "moved" })),
    ];

    // The HTML→Markdown migration commit (PR #117, "Migrate To Markdown File")
    // is the very first commit that touches Sky Atlas.md, so every doc shows
    // up as "added" in the diff. Semantically these docs existed in the prior
    // HTML era and were just translated to markdown — not new additions. Re-
    // tag as "moved" so downstream views (ActorHistory etc.) treat the
    // migration as renumbering noise rather than a wave of new creations.
    const isMdMigration =
      /migrate.*to.*markdown/i.test(commit.message) || extractPrNumber(commit.message) === 117;
    if (isMdMigration) {
      for (const ev of events) if (ev.changeType === "added") ev.changeType = "moved";
    }

    if (events.length === 0) {
      prevSnapshot = snapshot;
      lastCommitHash = commit.hash;
      continue;
    }

    // Fetch PR metadata
    const prNum = extractPrNumber(commit.message);
    const pr = prNum ? await fetchPr(prNum) : null;
    // PR-title-derived kind hint — overrides per-diff classification below
    // for the whole commit. "fix typos PR" stays typo even when individual
    // entries have a cascade of >4-char letter edits.
    const prKindHint = pr ? classifyPrTitle(pr.title) : null;

    // Try to match bullets to nodes for edit proposals. Pass the unique nodes
    // (modified ∪ added ∪ removed) so a moved-and-modified node isn't scored twice.
    let bulletMatches = new Map();
    let prHasInlineBullets = false;
    if (pr?.body) {
      const prBullets = parsePrBullets(pr.body);
      prHasInlineBullets = prBullets.length > 0;
      if (prBullets.length > 0) {
        const matchTargets = [...added, ...modified, ...removed];
        bulletMatches = matchBulletsToNodes(prBullets, matchTargets, snapshot, {
          agentNamePrefixes,
        });
        if (matchTargets.length > 0) {
          const rate = ((bulletMatches.size / matchTargets.length) * 100).toFixed(0);
          console.error(
            `    bullets: ${bulletMatches.size}/${matchTargets.length} matched (${rate}%)`,
          );
        }
      }
    }

    // Record history entries
    for (const { node, changeType } of events) {
      const entry = {
        date: commit.date.slice(0, 10),
        commitHash: commit.hash.slice(0, 7),
        commitSeq: 1000 + startIndex + i,
        changeType,
      };

      // Compute per-node content diff (skip for "added" on first commit — too noisy)
      if (changeType === "modified") {
        const prevContent = prevSnapshot.get(node.id)?.content ?? "";
        const currContent = snapshot.get(node.id)?.content ?? "";
        const diff = lineDiff(prevContent, currContent);
        if (diff.length > 0) {
          entry.diff = diff;
          const kind = prKindHint ?? classifyDiff(diff);
          if (kind) entry.changeKind = kind;
        }
      } else if (changeType === "added" && startIndex + i > 0) {
        // Node newly introduced mid-history: show its full content as added lines
        const currContent = snapshot.get(node.id)?.content ?? "";
        if (currContent) {
          const lines = currContent.split("\n").map((l) => ["+", l]);
          entry.diff = lines.length > 20 ? [...lines.slice(0, 20), ["…"]] : lines;
        }
      } else if (changeType === "removed") {
        const prevContent = prevSnapshot.get(node.id)?.content ?? "";
        if (prevContent) {
          const lines = prevContent.split("\n").map((l) => ["-", l]);
          entry.diff = lines.length > 20 ? [...lines.slice(0, 20), ["…"]] : lines;
        }
      } else if (changeType === "moved") {
        entry.movedFrom = node.movedFrom;
        entry.movedTo = node.movedTo;
      }

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
        const cleaned = cleanDescription(bulletMatch.bulletDescription);
        if (cleaned) entry.description = cleaned;
        // matchScore omitted from output — internal quality signal only
      } else if (pr?.body && !prHasInlineBullets && pr.body.length < 500) {
        // No-bullet-match fallback: plain non-bulleted PRs (Spark proposals,
        // single-fix commits) where the whole body is the summary.
        entry.summary = pr.title;
        const cleaned = cleanDescription(pr.body);
        if (cleaned) entry.description = cleaned;
      }

      if (!newHistory.has(node.id)) newHistory.set(node.id, []);
      newHistory.get(node.id).push(entry);
      totalChanges++;
    }

    prevSnapshot = snapshot;
    lastCommitHash = commit.hash;
  }

  if (!OUT_JSON) {
    // ── DB sink: upsert straight into atlas_history ──────────────────────────
    // commit_seq comes from the full submodule log (same numbering the table
    // already uses), keyed by short sha. The upsert's (doc_id, commit_sha,
    // change_type) conflict key makes re-runs idempotent — no per-file dedup.
    const seqByCommit = gitCommitSeq();
    const rows = [];
    for (const [nodeId, newEntries] of newHistory) {
      for (const e of newEntries) {
        const row = eventToRow(nodeId, e, seqByCommit);
        if (row) rows.push(row);
      }
    }
    await upsertHistory(sql, rows);

    // ── HTML-era (pre-#117) frozen history ───────────────────────────────────
    // The committed artifact (public/history-html-era.json) carries the human/auto
    // curation decisions baked in (scripts/htmlhist/prepare-html-history.mjs). Upsert it
    // idempotently on every sync — same (doc_id, commit_sha, change_type) conflict key —
    // so BOTH dev (preflight) and Railway (atlas worker) serve the applied reconstruction
    // from atlas_history. Every html-era event's commitHash is a REAL git sha, so its
    // commit_seq always reconciles via seqByCommit; the baked seq is never reached for
    // these rows. Absent (un-applied) → skipped, markdown era unaffected.
    let htmlEraCount = 0, seamStamped = 0;
    const htmlEraPath = path.join(ROOT, "public/history-html-era.json");
    if (fs.existsSync(htmlEraPath)) {
      const artifact = JSON.parse(fs.readFileSync(htmlEraPath, "utf8"));
      const htmlRows = htmlEraRows(artifact, seqByCommit);
      await upsertHistory(sql, htmlRows);
      htmlEraCount = htmlRows.length;
      seamStamped = await stampMigrationSeam(sql, artifact);
    }

    // ── Pre-git origins (mip / genesis / severed) ─────────────────────────────
    // The committed artifact (public/history-pre-era.json — scripts/prehist/, docs/plans/
    // pre-git-history.md) carries synthetic (non-git) commitHash tags with a BAKED negative
    // commit_seq — there is no real commit to reconcile against, so (unlike html-era rows
    // above) the baked seq is what lands in the DB. Same idempotent upsert; absent → skipped.
    let preEraCount = 0, supersededCount = 0;
    const preEraPath = path.join(ROOT, "public/history-pre-era.json");
    if (fs.existsSync(preEraPath)) {
      const artifact = JSON.parse(fs.readFileSync(preEraPath, "utf8"));
      // Curated AEP upgrades (prehist:aep) replace a row's commit_sha, so the OLD
      // (docId, commit_sha, change_type) key is untouched by the upsert below — it's
      // a different conflict target, not an update. Delete each superseded row first
      // so a doc never ends up carrying both the generic placeholder and its upgrade.
      for (const s of artifact.supersedes || []) {
        const { count } = await sql`
          DELETE FROM atlas_history
          WHERE doc_id = ${s.docId} AND commit_sha = ${s.commitHash} AND change_type = ${s.changeType}
        `;
        supersededCount += count ?? 0;
      }
      const preRows = preEraRows(artifact, seqByCommit);
      await upsertHistory(sql, preRows);
      preEraCount = preRows.length;
    }

    await sql.end();
    console.error(
      `\ndone: upserted ${rows.length} markdown-era change entries across ${newHistory.size} nodes` +
      `${htmlEraCount ? ` + ${htmlEraCount} html-era rows from the frozen artifact` : ""}` +
      `${seamStamped ? ` (seam verdict stamped on ${seamStamped} migration rows)` : ""}` +
      `${preEraCount ? ` + ${preEraCount} pre-git origin rows from the frozen artifact` : ""}` +
      `${supersededCount ? ` (deleted ${supersededCount} superseded row(s) first)` : ""} into atlas_history`,
    );
    return;
  }

  // ── --out-json sink: per-node files, append + dedup on (commitHash, changeType)
  // so a node can carry both a "modified" and a "moved" entry from one commit.
  let fileCount = 0;
  for (const [nodeId, newEntries] of newHistory) {
    const filePath = path.join(OUT_DIR, `${nodeId}.json`);
    const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : [];
    const seen = new Set(existing.map((e) => `${e.commitHash}:${e.changeType}`));
    const dedupedNew = newEntries.filter((e) => !seen.has(`${e.commitHash}:${e.changeType}`));
    if (dedupedNew.length === 0) continue;
    fs.writeFileSync(filePath, JSON.stringify([...existing, ...dedupedNew], null, 2) + "\n");
    fileCount++;
  }

  console.error(
    `\ndone: ${fileCount} node history files updated, ${totalChanges} new change entries`,
  );

  // Merge new counts into existing manifest and write
  const manifest = { ...existingManifest };
  for (const [nodeId, newEntries] of newHistory) {
    manifest[nodeId] = (manifest[nodeId] ?? 0) + newEntries.length;
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.error(`manifest: ${Object.keys(manifest).length} nodes with history`);

  // Checkpoint: record the last processed commit for next incremental run
  fs.writeFileSync(lastCommitFile, lastCommitHash);
  console.error(`checkpoint: ${lastCommitHash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
