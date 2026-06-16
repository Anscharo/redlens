#!/usr/bin/env bash
# check-atlas-pr.sh — build + test Sky Atlas by Redline at the head commit of a next-gen-atlas PR.
#
# Usage:
#   pnpm check:pr <pr-number>
#   bash scripts/aux/check-atlas-pr.sh <pr-number>
#
# Only OPEN PRs are eligible. Closed / merged PRs are rejected.
#
# Builds run in a git worktree so the main checkout's public/ is never written
# to and built artifacts can't be accidentally staged/committed.
#
# Flow:
#   1. Create a git worktree at HEAD (detached, isolated public/ directory)
#   2. Build baseline at main's pinned atlas commit (skip if already cached)
#   3. Build + test at the PR's head commit
#   4. Write a relationship-delta report (PR vs main) to .cache/pr-check/
#   5. Remove the worktree
#
# On success: .cache/pr-check/pr<N>-<sha7>.md — delta vs main, exits 0.
# On failure: same path — build log + failed phase, exits 1.

set -euo pipefail

ATLAS_REPO="sky-ecosystem/next-gen-atlas"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CACHE_DIR="$ROOT/.cache/pr-check"

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
PR="${1:-}"
if [[ -z "$PR" || ! "$PR" =~ ^[0-9]+$ ]]; then
  cat >&2 <<'USAGE'
Usage: check-atlas-pr <pr-number>

Builds and tests Sky Atlas by Redline at the head commit of an open
sky-ecosystem/next-gen-atlas PR, then reports relationship changes vs main.

Only OPEN PRs are eligible.
USAGE
  exit 1
fi

# ---------------------------------------------------------------------------
# Fetch PR metadata (gh ships its own jq; no external dep)
# ---------------------------------------------------------------------------
echo "Fetching PR #$PR from $ATLAS_REPO ..."
HEAD_SHA=$(gh pr view "$PR" --repo "$ATLAS_REPO" --json headRefOid --jq '.headRefOid')
PR_TITLE=$(gh pr view "$PR" --repo "$ATLAS_REPO" --json title     --jq '.title')
PR_STATE=$(gh pr view "$PR" --repo "$ATLAS_REPO" --json state     --jq '.state')
PR_URL=$(gh  pr view "$PR" --repo "$ATLAS_REPO" --json url        --jq '.url')
SHA7="${HEAD_SHA:0:7}"
REDLENS_BRANCH=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)

echo "PR #$PR: $PR_TITLE"
echo "State:   $PR_STATE"
echo "SHA:     $HEAD_SHA"
echo "URL:     $PR_URL"
echo ""

# ---------------------------------------------------------------------------
# Guard: only open PRs
# ---------------------------------------------------------------------------
if [[ "$PR_STATE" != "OPEN" ]]; then
  echo "ERROR: PR #$PR is $PR_STATE. Only OPEN PRs are supported." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Merge base — the exact point where this PR diverged from atlas main.
# This matches what GitHub shows in "Files changed": only what the PR adds,
# not everything that has accumulated in main since the branch point.
# ---------------------------------------------------------------------------
git -C "$ROOT/vendor/next-gen-atlas" fetch origin main --quiet
git -C "$ROOT/vendor/next-gen-atlas" fetch origin \
  "+refs/pull/${PR}/head:refs/remotes/origin/pr/${PR}" --quiet
MERGE_BASE=$(git -C "$ROOT/vendor/next-gen-atlas" merge-base "$HEAD_SHA" origin/main)
MERGE_BASE7="${MERGE_BASE:0:7}"
echo "Merge base with main: ${MERGE_BASE7}"
echo ""

# ---------------------------------------------------------------------------
# Hardcoded UUID impact check
# Greps all UUIDs referenced in Sky Atlas by Redline source files, then checks whether this
# PR's diff touches any of them. Touched = the node was added, removed, or
# edited; its title/content may no longer match what our code assumes.
# ---------------------------------------------------------------------------
_atlas_diff=$(git -C "$ROOT/vendor/next-gen-atlas" diff \
  "$MERGE_BASE" "$HEAD_SHA" 2>/dev/null)

_src_uuids=$(grep -rhEo \
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" \
  "$ROOT/scripts/lib/" "$ROOT/scripts/required/" "$ROOT/src/lib/" \
  --include="*.mjs" --include="*.ts" 2>/dev/null | sort -u)

UUID_IMPACT_LINES=""
while IFS= read -r _uuid; do
  [[ -z "$_uuid" ]] && continue
  if echo "$_atlas_diff" | grep -qF "$_uuid"; then
    _usages=$(grep -rn "$_uuid" \
      "$ROOT/scripts/lib/" "$ROOT/scripts/required/" "$ROOT/src/lib/" \
      --include="*.mjs" --include="*.ts" 2>/dev/null \
      | sed "s|$ROOT/||" | head -5 | sed 's/^/    /')
    UUID_IMPACT_LINES="${UUID_IMPACT_LINES}
- \`${_uuid}\`
${_usages}"
  fi
done <<< "$_src_uuids"

if [[ -n "$UUID_IMPACT_LINES" ]]; then
  UUID_IMPACT_SECTION="## ⚠️ Hardcoded UUID impact

The following UUIDs are hardcoded in Sky Atlas by Redline source and were touched by this PR.
Verify that the node's title/content still matches what the code assumes.
${UUID_IMPACT_LINES}"
  echo "⚠️  Hardcoded UUIDs touched by this PR — see report for details."
else
  UUID_IMPACT_SECTION="## Hardcoded UUID impact

✅ No hardcoded source UUIDs are touched by this PR."
fi
echo ""

# ---------------------------------------------------------------------------
# Setup: worktree + temp files
# ---------------------------------------------------------------------------
mkdir -p "$CACHE_DIR"
REPORT="$CACHE_DIR/pr${PR}-${SHA7}.md"
BASELINE=$(mktemp)
BASELINE_LOG=$(mktemp)
BUILD_LOG=$(mktemp)
SNAP_LOG=$(mktemp)
SNAP_BASELINE=$(mktemp -d)

# Worktree lives in a temp dir; removed on exit regardless of outcome
WORKTREE=$(mktemp -d)
rmdir "$WORKTREE"

cleanup() {
  rm -f "$BASELINE" "$BASELINE_LOG" "$BUILD_LOG" "$SNAP_LOG" 2>/dev/null || true
  rm -rf "$SNAP_BASELINE" 2>/dev/null || true
  git -C "$ROOT" worktree remove "$WORKTREE" --force 2>/dev/null || true
}
trap cleanup EXIT

echo "Creating isolated git worktree ..."
git -C "$ROOT" worktree add "$WORKTREE" HEAD --detach --quiet

# Share node_modules (pnpm store is content-addressed; symlink is safe)
ln -s "$ROOT/node_modules" "$WORKTREE/node_modules"

# Share env vars and build caches (read-only from worktree's perspective)
[[ -f "$ROOT/.env.local" ]] && ln -s "$ROOT/.env.local" "$WORKTREE/.env.local"
mkdir -p "$WORKTREE/.cache"
[[ -d "$ROOT/.cache/etherscan"     ]] && ln -s "$ROOT/.cache/etherscan"     "$WORKTREE/.cache/etherscan"
[[ -f "$ROOT/.cache/block-pins.json" ]] && ln -s "$ROOT/.cache/block-pins.json" "$WORKTREE/.cache/block-pins.json"

# Initialize atlas submodule in the worktree.
# Shares git objects with the main checkout — no network fetch needed.
echo "Initializing atlas submodule in worktree ..."
git -C "$WORKTREE" submodule update --init --quiet vendor/next-gen-atlas

WT_PUBLIC="$WORKTREE/public"
WT_ATLAS="$WORKTREE/vendor/next-gen-atlas"

# ---------------------------------------------------------------------------
# Baseline: build at main's pinned atlas commit.
# If the main checkout already has a valid build (manifest matches pinned SHA),
# seed the worktree's public/ from it to skip the baseline rebuild.
# ---------------------------------------------------------------------------
MANIFEST_COMMIT=$(MF="$ROOT/public/manifest.json" node -e "
  try {
    const m = JSON.parse(require('fs').readFileSync(process.env.MF, 'utf8'));
    process.stdout.write(m.atlasCommit ?? '');
  } catch { process.stdout.write(''); }
" 2>/dev/null || true)

if [[ -n "$MANIFEST_COMMIT" && "$MANIFEST_COMMIT" == "$MERGE_BASE" && -f "$ROOT/public/relations.json" ]]; then
  echo "Baseline: seeding worktree from cached build at merge base (${MERGE_BASE7})"
  cp -r "$ROOT/public" "$WORKTREE/public"
  cp "$WT_PUBLIC/relations.json" "$BASELINE"
else
  echo ""
  echo "=== baseline: build:at ${MERGE_BASE7} (merge base with atlas main) ==="
  if ! (cd "$WORKTREE" && pnpm build:at "$MERGE_BASE") 2>&1 | tee "$BASELINE_LOG"; then
    {
      echo "# Atlas PR check — BASELINE FAILED"
      echo ""
      echo "The build at the PR's merge base failed."
      echo "This is a pre-existing issue, not caused by PR #${PR}."
      echo ""
      echo "**Merge base:** \`${MERGE_BASE}\`"
      echo "**PR:** [#${PR} ${PR_TITLE}](${PR_URL})"
      echo ""
      echo "## Baseline build log"
      echo ""
      echo '```'
      cat "$BASELINE_LOG"
      echo '```'
    } > "$REPORT"
    echo "" >&2
    echo "FAILED: baseline build at ${MERGE_BASE7} (pre-existing issue, unrelated to PR #${PR})" >&2
    echo "Report: $REPORT" >&2
    exit 1
  fi
  cp "$WT_PUBLIC/relations.json" "$BASELINE"
  echo ""
fi

# Record baseline snapshots so test:snap can diff against them after the PR build.
# Call vitest directly (not via pnpm) to avoid the ELIFECYCLE noise on non-zero exit.
echo "Recording baseline graph snapshots ..."
(cd "$WORKTREE" && NO_COLOR=1 node_modules/.bin/vitest run --config vitest.snap.config.ts -u) \
  > /dev/null 2>&1 || true
cp -r "$WORKTREE/graph-snapshots" "$SNAP_BASELINE/"

# ---------------------------------------------------------------------------
# Failure report writer (PR build or test failures only)
# ---------------------------------------------------------------------------
write_failure_report() {
  local phase="$1"
  {
    echo "# Atlas PR check — FAILED"
    echo ""
    echo "**PR:** [#${PR} ${PR_TITLE}](${PR_URL}) \`${PR_STATE}\`"
    echo "**Atlas SHA:** \`${HEAD_SHA}\`"
    echo "**Failed phase:** \`${phase}\`"
    echo "**Baseline (merge base):** \`${MERGE_BASE}\`"
    echo "**Sky Atlas by Redline branch:** \`${REDLENS_BRANCH}\`"
    echo ""
    echo ""
    echo "$UUID_IMPACT_SECTION"
    echo ""
    echo "## Build log"
    echo ""
    echo '```'
    cat "$BUILD_LOG"
    echo '```'
  } > "$REPORT"

  echo "" >&2
  echo "FAILED: $phase" >&2
  echo "Report: $REPORT" >&2
}

# ---------------------------------------------------------------------------
# Fetch the PR head ref into the WORKTREE's atlas submodule.
# The worktree's submodule has its own git dir (separate from the main
# checkout's) so objects fetched above are not visible here.
# ---------------------------------------------------------------------------
echo "Fetching atlas PR head ref into worktree ..."
git -C "$WT_ATLAS" fetch origin \
  "+refs/pull/${PR}/head:refs/remotes/origin/pr/${PR}" --quiet

# ---------------------------------------------------------------------------
# Phase 1: build pipeline at the PR's atlas SHA (in worktree)
# ---------------------------------------------------------------------------
echo ""
echo "=== build:at ${SHA7} (PR #${PR}) ==="
(cd "$WORKTREE" && pnpm build:at "$HEAD_SHA") 2>&1 | tee -a "$BUILD_LOG" \
  || { write_failure_report "build:at ${SHA7}"; exit 1; }

# ---------------------------------------------------------------------------
# Phase 2: invariant test suite — hard gate
# ---------------------------------------------------------------------------
echo ""
echo "=== pnpm test ==="
(cd "$WORKTREE" && pnpm test) 2>&1 | tee -a "$BUILD_LOG" \
  || { write_failure_report "pnpm test"; exit 1; }

# ---------------------------------------------------------------------------
# Phase 3: graph snapshot diff — informational, not a gate
# Update snapshots to the PR state, then diff against the saved baseline.
# Using diff -ru instead of vitest output avoids vitest's truncated context lines.
# ---------------------------------------------------------------------------
echo ""
echo "=== graph snapshot diff (PR vs baseline) ==="
(cd "$WORKTREE" && NO_COLOR=1 node_modules/.bin/vitest run --config vitest.snap.config.ts -u) \
  > /dev/null 2>&1 || true
diff -ru "$SNAP_BASELINE/graph-snapshots" "$WORKTREE/graph-snapshots" > "$SNAP_LOG" 2>&1 || true
if [[ -s "$SNAP_LOG" ]]; then
  cat "$SNAP_LOG"
else
  echo "(no snapshot changes)"
fi

# ---------------------------------------------------------------------------
# Success: compute relationship delta (PR vs main baseline)
# ---------------------------------------------------------------------------
DELTA=$(BASELINE_FILE="$BASELINE" RELATIONS="$WT_PUBLIC/relations.json" \
  node --input-type=module <<'JS'
import { readFileSync } from "fs";

const baseline = JSON.parse(readFileSync(process.env.BASELINE_FILE, "utf8"));
const current  = JSON.parse(readFileSync(process.env.RELATIONS,      "utf8"));

function countByKey(items, key) {
  const out = {};
  for (const item of items ?? []) {
    const k = item[key] ?? "(unknown)";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// relations.json uses abbreviated keys: et=entity_type, e=edge_type
const oldEnt  = baseline ? countByKey(baseline.entities, "et") : {};
const newEnt  =            countByKey(current.entities,  "et");
const oldEdge = baseline ? countByKey(baseline.edges,    "e")  : {};
const newEdge =            countByKey(current.edges,     "e");

const allEntTypes  = new Set([...Object.keys(oldEnt),  ...Object.keys(newEnt)]);
const allEdgeTypes = new Set([...Object.keys(oldEdge), ...Object.keys(newEdge)]);

function deltas(oldC, newC, allKeys) {
  const rows = [];
  for (const t of [...allKeys].sort()) {
    const d = (newC[t] ?? 0) - (oldC[t] ?? 0);
    if (d !== 0) rows.push({ type: t, before: oldC[t] ?? 0, after: newC[t] ?? 0, delta: d });
  }
  return rows;
}

const entDeltas   = deltas(oldEnt,  newEnt,  allEntTypes);
const edgeDeltas  = deltas(oldEdge, newEdge, allEdgeTypes);
const newEntTypes  = [...allEntTypes].filter(t => !oldEnt[t]  && newEnt[t]);
const newEdgeTypes = [...allEdgeTypes].filter(t => !oldEdge[t] && newEdge[t]);

const lines = [];
const noBaseline = !baseline;

lines.push("### Entities");
if (noBaseline) {
  lines.push("_(no baseline; showing current counts)_");
  for (const [t, n] of Object.entries(newEnt).sort()) lines.push(`- ${t}: ${n}`);
} else if (entDeltas.length === 0) {
  lines.push("No change.");
} else {
  for (const { type, before, after, delta } of entDeltas)
    lines.push(`- **${type}**: ${before} → ${after} (${delta > 0 ? "+" : ""}${delta})`);
}
if (newEntTypes.length) lines.push(`\n> New entity types: ${newEntTypes.join(", ")}`);

lines.push("");
lines.push("### Edges by type");
if (noBaseline) {
  lines.push("_(no baseline; showing current counts)_");
  for (const [t, n] of Object.entries(newEdge).sort()) lines.push(`- ${t}: ${n}`);
} else if (edgeDeltas.length === 0) {
  lines.push("No change.");
} else {
  for (const { type, before, after, delta } of edgeDeltas)
    lines.push(`- **${type}**: ${before} → ${after} (${delta > 0 ? "+" : ""}${delta})`);
}
if (newEdgeTypes.length) lines.push(`\n> New edge types: ${newEdgeTypes.join(", ")}`);

const totalEnt  = Object.values(newEnt).reduce((a, b) => a + b, 0);
const totalEdge = Object.values(newEdge).reduce((a, b) => a + b, 0);
lines.push("");
lines.push(`### Totals: ${totalEnt} entities · ${totalEdge} edges`);

process.stdout.write(lines.join("\n"));
JS
)

# Write success report to main checkout (not worktree)
{
  echo "# Atlas PR check — PASSED"
  echo ""
  echo "**PR:** [#${PR} ${PR_TITLE}](${PR_URL}) \`${PR_STATE}\`"
  echo "**Atlas SHA:** \`${HEAD_SHA}\`"
  echo "**Baseline (merge base):** \`${MERGE_BASE}\`"
  echo "**Sky Atlas by Redline branch:** \`${REDLENS_BRANCH}\`"
  echo ""
  echo "$UUID_IMPACT_SECTION"
  echo ""
  echo "## Relationship delta (PR vs merge base)"
  echo ""
  echo "$DELTA"
  echo ""
  echo "## Graph snapshot diff"
  echo ""
  echo '```'
  cat "$SNAP_LOG"
  echo '```'
} > "$REPORT"

echo ""
echo "All checks passed for atlas PR #${PR} (${SHA7})."
echo ""
echo "Report: $REPORT"
echo "Main checkout's public/ was not modified."
