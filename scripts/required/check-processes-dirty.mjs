#!/usr/bin/env node
/**
 * Process inventory drift check.
 *
 * Compares public/processes.json (curated process nodes, identified by UUID)
 * against the current public/docs.json. Three outputs:
 *
 *   1. audit.missingUuids — curated entry whose UUID is gone from docs.json
 *      (deleted, restructured, or merged into another node).
 *
 *   2. audit.newCandidates — docs whose titles match the process keyword
 *      classifier but aren't in public/processes.json AND not in
 *      public/processes-ignored.json. Each is flagged `recently_added: true`
 *      when its UUID is also in the atlas-history diff (see #3) — those are
 *      the high-signal targets in a typical post-atlas-update triage cycle.
 *
 *   3. audit.atlas_diff — UUIDs added to the atlas since the last commit that
 *      touched public/processes.json (= our last triage). This is the precise
 *      delta of new work that needs human attention; candidates outside this
 *      delta are "always-there" docs that the keyword classifier just missed
 *      in earlier passes.
 *
 * Title / doc_no are resolved from docs.json on every read — no snapshot
 * fields are stored on the entries, so there's no drift to auto-apply.
 *
 * Exits 0 always — never blocks builds/deployments. Sets the GH Actions
 * outputs `dirty`, `missing`, `candidates` so the atlas-update workflow can
 * decide whether to open / update a tracking issue.
 *
 * Run: node scripts/required/check-processes-dirty.mjs
 *      pnpm processes:check
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { findCandidates } from "../lib/process-keywords.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PROCESSES = path.join(ROOT, "public/processes.json");
const IGNORED = path.join(ROOT, "public/processes-ignored.json");
const DOCS = path.join(ROOT, "public/docs.json");
const AUDIT_OUT = path.join(ROOT, ".cache/processes-audit.json");
const AUDIT_MD = path.join(ROOT, ".cache/processes-audit.md");
const ATLAS_SUBMODULE = "vendor/next-gen-atlas";
// Atlas content lives under content/ in both layouts that have existed there,
// but a document's uuid is written differently in each: the atomized tree
// (#236..#294) put `id: <uuid>` in each document.md's YAML frontmatter, while
// the consolidated files (#294 on) carry `<!-- UUID: <uuid> -->` on the heading
// line. Match both — grepping only the frontmatter form returned ZERO uuids
// after the cutover, and the empty set was swallowed into `error`, reporting
// every curated process as newly added.
const ATLAS_CONTENT_PATH = "content/";
const ATLAS_ID_PATTERN = "(^id: [0-9a-f-]{36}$)|(<!-- UUID: [0-9a-f-]{36} -->)";
const UUID_RE = /^id: ([0-9a-f-]{36})$|<!-- UUID: ([0-9a-f-]{36}) -->/;
// Below this, treat the grep as broken rather than as a real answer: the atlas
// has never had fewer than ~7,700 documents.
const MIN_ATLAS_UUIDS = 1000;

// ---------------------------------------------------------------------------

const docs = JSON.parse(fs.readFileSync(DOCS, "utf8")).nodes;
const processes = JSON.parse(fs.readFileSync(PROCESSES, "utf8"));
const ignored = JSON.parse(fs.readFileSync(IGNORED, "utf8"));

const curatedUuids = new Set(processes.map((p) => p.uuid));
const ignoredUuids = new Set(ignored.map((i) => i.uuid));

// 1. Curated entries whose UUID is gone from docs.json. We only know the
// uuid + category from the local entry; the human can `git log -S <uuid> --
// public/processes.json` to recover what it was previously titled.
const missingUuids = [];
for (const entry of processes) {
  if (!docs[entry.uuid]) {
    missingUuids.push({ uuid: entry.uuid, category: entry.category });
  }
}

// 2. Atlas-history diff: UUIDs added since the last triage commit.
const atlasDiff = computeAtlasDiff();
const recentlyAddedSet = new Set(atlasDiff.added_uuids);

// 3. New candidates from the keyword classifier. Descendants of already-curated
// processes are skipped — they're step nodes, not standalone processes.
const candidates = findCandidates(docs, curatedUuids);
const newCandidates = candidates
  .filter((c) => !curatedUuids.has(c.id) && !ignoredUuids.has(c.id))
  .map((c) => ({
    uuid: c.id,
    title: c.title,
    doc_no: docs[c.id].doc_no,
    type: docs[c.id].type,
    keywords: c.keywords,
    recently_added: recentlyAddedSet.has(c.id),
  }))
  .sort((a, b) => {
    // Recently-added first, then by doc_no.
    if (a.recently_added !== b.recently_added) return a.recently_added ? -1 : 1;
    return a.doc_no.localeCompare(b.doc_no, undefined, { numeric: true });
  });

// 4. Write audit + markdown summary.
const audit = {
  generated_at: new Date().toISOString().split("T")[0],
  total_curated: processes.length,
  total_candidates: candidates.length,
  total_ignored: ignored.length,
  atlas_diff: atlasDiff,
  missing_uuids: missingUuids,
  new_candidates: newCandidates,
};

const dirty = missingUuids.length > 0 || newCandidates.length > 0;

fs.mkdirSync(path.dirname(AUDIT_OUT), { recursive: true });
fs.writeFileSync(AUDIT_OUT, JSON.stringify(audit, null, 2) + "\n");
fs.writeFileSync(AUDIT_MD, renderMarkdown(audit, dirty));

// 4. Human-readable summary.
console.log(`Curated: ${processes.length}  Candidates: ${candidates.length}  Ignored: ${ignored.length}`);
if (missingUuids.length > 0) {
  console.log(`\n⚠ Missing UUIDs (${missingUuids.length}):`);
  for (const m of missingUuids) {
    console.log(`  ${m.uuid}  (${m.category})`);
  }
}
if (atlasDiff.since_atlas_sha && atlasDiff.since_atlas_sha !== atlasDiff.current_atlas_sha) {
  console.log(
    `\nAtlas diff since last triage (${atlasDiff.since_atlas_sha.slice(0, 8)} → ${atlasDiff.current_atlas_sha.slice(0, 8)}): ${atlasDiff.added_uuids.length} new UUIDs`,
  );
}
if (newCandidates.length > 0) {
  const recent = newCandidates.filter((c) => c.recently_added).length;
  console.log(`\n⚠ New candidates (${newCandidates.length}${recent ? `, ${recent} added since last triage` : ""}):`);
  for (const c of newCandidates) {
    console.log(`  ${c.recently_added ? "★" : " "} ${c.doc_no}  ${c.title}  [${c.keywords.join(", ")}]`);
  }
}
if (!dirty) {
  console.log("\nClean — no action needed.");
}

// 6. GH Actions outputs.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `dirty=${dirty}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `missing=${missingUuids.length}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `candidates=${newCandidates.length}\n`);
}

// ---------------------------------------------------------------------------

function renderMarkdown(audit, dirty) {
  const lines = [];
  lines.push(`# Process inventory audit`);
  lines.push("");
  lines.push(`**Generated:** ${audit.generated_at}`);
  lines.push(`**Status:** ${dirty ? "needs review" : "clean"}`);
  lines.push("");
  lines.push(`Curated: ${audit.total_curated} · Candidates: ${audit.total_candidates} · Ignored: ${audit.total_ignored}`);
  lines.push("");

  const diff = audit.atlas_diff;
  if (diff && diff.since_atlas_sha && diff.since_atlas_sha !== diff.current_atlas_sha) {
    lines.push(`**Atlas diff since last triage:** \`${diff.since_atlas_sha.slice(0, 8)}\` → \`${diff.current_atlas_sha.slice(0, 8)}\` · ${diff.added_uuids.length} new UUIDs added.`);
    lines.push("");
  } else if (diff && diff.error) {
    lines.push(`_(Atlas diff unavailable: ${diff.error})_`);
    lines.push("");
  }

  if (audit.missing_uuids.length > 0) {
    lines.push(`## Missing UUIDs (${audit.missing_uuids.length})`);
    lines.push("");
    lines.push("These curated entries no longer exist in the atlas — deleted, merged, or restructured. Review and either remove from `public/processes.json` or replace the UUID. To see what each was, run `git log -S <uuid> -- public/processes.json`.");
    lines.push("");
    for (const m of audit.missing_uuids) {
      lines.push(`- \`${m.uuid}\` (${m.category})`);
    }
    lines.push("");
  }

  if (audit.new_candidates.length > 0) {
    const recent = audit.new_candidates.filter((c) => c.recently_added).length;
    lines.push(`## New candidates (${audit.new_candidates.length}${recent ? `, ${recent} ★ added since last triage` : ""})`);
    lines.push("");
    lines.push("Atlas nodes whose titles match the process keyword classifier but aren't in the curated list. Entries marked ★ were added to the atlas since the last commit to `public/processes.json` — those are the high-signal review targets. Unmarked entries are \"always-there\" docs that earlier passes missed. For each: add to `public/processes.json` if it's a real process, or to `public/processes-ignored.json` to suppress permanently.");
    lines.push("");
    for (const c of audit.new_candidates) {
      const star = c.recently_added ? "★ " : "";
      lines.push(`- ${star}${c.doc_no} — **${c.title}** (\`${c.uuid}\`, ${c.type}) — keywords: ${c.keywords.join(", ")}`);
    }
    lines.push("");
  }

  if (!dirty) {
    lines.push("Nothing to review.");
  }

  return lines.join("\n");
}

// Find UUIDs added to the atlas between the submodule SHA at the last commit
// that touched public/processes.json (= our last triage) and current HEAD of
// the atlas submodule. Returns { since_atlas_sha, current_atlas_sha,
// added_uuids, error }. Errors are swallowed and surfaced via the `error`
// field so a missing submodule or shallow clone never breaks the check.
function computeAtlasDiff() {
  try {
    const lastCommit = execFileSync("git", ["log", "-1", "--format=%H", "--", "public/processes.json"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    if (!lastCommit) return { since_atlas_sha: null, current_atlas_sha: null, added_uuids: [] };

    // Atlas submodule SHA at that commit. `git ls-tree` outputs:
    //   160000 commit <sha>\tvendor/next-gen-atlas
    const lsTree = execFileSync("git", ["ls-tree", lastCommit, ATLAS_SUBMODULE], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const m = lsTree.match(/^160000 commit ([0-9a-f]+)/);
    if (!m) return { since_atlas_sha: null, current_atlas_sha: null, added_uuids: [] };
    const sinceSha = m[1];

    const submodulePath = path.join(ROOT, ATLAS_SUBMODULE);
    const currentSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: submodulePath,
      encoding: "utf8",
    }).trim();

    if (sinceSha === currentSha) {
      return { since_atlas_sha: sinceSha, current_atlas_sha: currentSha, added_uuids: [] };
    }

    const sinceUuids = grepAtlasUuids(submodulePath, sinceSha);
    const currentUuids = grepAtlasUuids(submodulePath, currentSha);
    const added = [...currentUuids].filter((u) => !sinceUuids.has(u));

    return { since_atlas_sha: sinceSha, current_atlas_sha: currentSha, added_uuids: added };
  } catch (err) {
    return {
      since_atlas_sha: null,
      current_atlas_sha: null,
      added_uuids: [],
      error: String(err?.message ?? err),
    };
  }
}

// Collect every document uuid under content/ at the given commit, in whichever
// layout that commit uses. `git grep` scans the tree-ish directly — no checkout.
function grepAtlasUuids(submodulePath, sha) {
  const out = execFileSync(
    "git",
    ["grep", "-h", "-E", ATLAS_ID_PATTERN, sha, "--", ATLAS_CONTENT_PATH],
    { cwd: submodulePath, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const set = new Set();
  for (const line of out.split("\n")) {
    const m = line.match(UUID_RE);
    if (m) set.add(m[1] ?? m[2]);
  }
  if (set.size < MIN_ATLAS_UUIDS) {
    throw new Error(
      `only ${set.size} atlas uuids found under ${ATLAS_CONTENT_PATH} at ${sha} — the atlas ` +
        "layout changed and this grep no longer recognises it. Refusing to report a doc " +
        "diff computed from an empty set.",
    );
  }
  return set;
}
