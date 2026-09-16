// Incremental driver for the Potential Mistakes sweep.
//
//   pnpm mistakes:status               what changed since the last sweep
//   pnpm mistakes:bootstrap            adopt the existing sweep as the baseline (one-off)
//   pnpm mistakes:plan  [--full]       write the work plan + chunk files
//   pnpm mistakes:merge [--dry-run]    fold agent output into the artifact
//                       [--drop-corpus] also retire the hand-maintained
//                                       corpus-wide rows (see mergeFindings)
//
// The LLM judgement happens between `plan` and `merge` and is driven by
// .claude/skills/mistakes-report — this script only decides what needs looking
// at and merges what came back. Deliberately OFF the `pnpm build` chain: the
// sweep is hand-run, and public/potential-mistakes.json is committed data, not
// a build artifact (that is the whole point of the report's provenance banner).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { loadAtlasSource } from "../lib/atlas-source.mjs";
import {
  advanceState,
  buildBacklinks,
  chunkDocs,
  docsToEvaluate,
  emptyState,
  isStateUsable,
  mergeFindings,
  planSweep,
  validateFinding,
} from "../lib/mistakes-sweep.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ATLAS = path.join(ROOT, "vendor/next-gen-atlas");
const ARTIFACT = path.join(ROOT, "public/potential-mistakes.json");
const STATE = path.join(ROOT, ".github/mistakes-sweep-state.json");
const WORK = path.join(ROOT, ".cache/mistakes-sweep");
const CHUNKS = path.join(WORK, "chunks");
const FINDINGS = path.join(WORK, "findings");

const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith("-")) ?? "status";
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const readJson = (file, fallback) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;

function atlasSha() {
  try {
    return execFileSync("git", ["-C", ATLAS, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null; // A checkout without git history still sweeps fine.
  }
}

// uuid → the source file the document lives in, found WITHOUT asking the
// loader — the same deliberately dumb, layout-blind scan check:atlas uses, for
// the same reason: this is the value shown as `Source File` in the report's
// CSV, and a loader that mis-parses a layout would agree with itself.
const FRONTMATTER_ID_RE = /^id: ([0-9a-f-]{36})$/;
const HEADING_UUID_RE = /^#{1,6} .+<!-- UUID: ([0-9a-f-]{36}) -->\s*$/;

function sourceFiles(srcDir) {
  const byUuid = new Map();
  const files = [];
  const contentRoot = path.join(srcDir, "content");
  if (fs.existsSync(contentRoot)) {
    const stack = [contentRoot];
    while (stack.length) {
      for (const e of fs.readdirSync(stack.pop(), { withFileTypes: true })) {
        const full = path.join(e.parentPath ?? e.path, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.name.endsWith(".md")) files.push(full);
      }
    }
  } else {
    const monolith = path.join(srcDir, "Sky Atlas/Sky Atlas.md");
    if (fs.existsSync(monolith)) files.push(monolith);
  }
  for (const f of files) {
    const name = path.basename(f);
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = FRONTMATTER_ID_RE.exec(line) ?? HEADING_UUID_RE.exec(line);
      if (m) byUuid.set(m[1], name);
    }
  }
  return byUuid;
}

function load() {
  const { nodes, nodeMap, layout } = loadAtlasSource(ATLAS);
  // Attach the source file so validateFinding can stamp it, the way it stamps
  // id and docNo — agents are told not to supply `file`.
  const fileOf = sourceFiles(ATLAS);
  for (const node of nodes) node.file = fileOf.get(node.id) ?? "";
  const raw = readJson(STATE, null);
  // A state from an older digest recipe cannot be compared against the current
  // one. Treating its digests as current would mark changed docs clean, so the
  // run degrades to a full sweep instead — loudly.
  const stale = raw && !isStateUsable(raw);
  if (stale) console.warn(`[mistakes] state v${raw.version} is incompatible — full sweep forced`);
  return { nodes, nodeMap, layout, state: stale || !raw ? emptyState() : raw, stale: !!stale };
}

function describe(plan, layout) {
  const pct = ((plan.unchanged.length / Math.max(plan.total, 1)) * 100).toFixed(1);
  console.log(`atlas: ${plan.total} documents (${layout} layout)`);
  console.log(`  new        ${plan.new.length}`);
  console.log(`  changed    ${plan.changed.length}`);
  console.log(`  linked     ${plan.linked.length}  (unchanged, but cross-reference a doc that moved)`);
  console.log(`  unchanged  ${plan.unchanged.length}  (${pct}% skipped)`);
  console.log(`  removed    ${plan.removed.length}`);
}

// The cross-reference expansion is on by default — a citation into a document
// that moved is exactly the class of defect a per-document diff cannot see.
// `--no-backlinks` turns it off for a sitting where only the moved documents
// themselves are worth the tokens.
const backlinksFor = (nodes, full) => (full || flag("no-backlinks") ? null : buildBacklinks(nodes));

// --- status -----------------------------------------------------------------
if (cmd === "status") {
  const { nodes, layout, state, stale } = load();
  const full = stale || flag("full");
  const plan = planSweep(nodes, state, { full, backlinks: backlinksFor(nodes, full) });
  describe(plan, layout);
  console.log(`last swept: ${state.sweptAt ?? "never"} @ ${(state.atlasSha ?? "—").slice(0, 8)}`);
  process.exit(0);
}

// --- bootstrap --------------------------------------------------------------
// One-off: adopt the existing hand-run sweep as the incremental baseline, so
// the first `plan` queues only what has moved since. Refuses unless the
// artifact was generated at the checked-out commit — claiming 11k documents
// were scanned at a state nobody actually read is exactly the silent failure
// the "only mark scanned when it came back" rule exists to prevent.
if (cmd === "bootstrap") {
  const { nodes, nodeMap, state } = load();
  const artifact = readJson(ARTIFACT, null);
  const head = atlasSha();
  if (!artifact) {
    console.error(`[mistakes] no artifact at ${path.relative(ROOT, ARTIFACT)} — nothing to adopt`);
    process.exit(1);
  }
  if (artifact.atlasSha !== head && !flag("force")) {
    console.error(
      `[mistakes] artifact was swept at ${String(artifact.atlasSha).slice(0, 8)} but the submodule ` +
        `is at ${String(head).slice(0, 8)}.\n` +
        "  Check out that commit and re-run, or pass --force to accept the drift as unscanned-but-baselined.",
    );
    process.exit(1);
  }
  if (fs.existsSync(STATE) && !flag("force")) {
    console.error(`[mistakes] ${path.relative(ROOT, STATE)} already exists — pass --force to overwrite`);
    process.exit(1);
  }
  const all = nodes.map((n) => n.id);
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(
    STATE,
    `${JSON.stringify(advanceState(state, nodeMap, all, [], artifact.atlasSha ?? head), null, 2)}\n`,
  );
  console.log(`baselined ${all.length} documents at ${String(artifact.atlasSha ?? head).slice(0, 8)}`);
  console.log(`wrote ${path.relative(ROOT, STATE)} — the next \`pnpm mistakes:plan\` sweeps only drift`);
  process.exit(0);
}

// --- plan -------------------------------------------------------------------
if (cmd === "plan") {
  const { nodes, state, layout, stale } = load();
  const full = flag("full") || stale;
  const byUuid = new Map(nodes.map((n) => [n.id, n]));
  const plan = planSweep(nodes, state, { full, backlinks: backlinksFor(nodes, full) });
  describe(plan, layout);
  let queue = docsToEvaluate(plan).map((uuid) => byUuid.get(uuid));
  const limit = Number.parseInt(opt("limit", ""), 10);
  // A capped run is how a large backlog is worked down over several sittings:
  // the docs left out simply stay in the next plan.
  if (Number.isFinite(limit)) queue = queue.slice(0, limit);

  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(CHUNKS, { recursive: true });
  fs.mkdirSync(FINDINGS, { recursive: true });

  const chunks = chunkDocs(queue, { maxBytes: Number.parseInt(opt("max-bytes", "40000"), 10) });
  chunks.forEach((docs, i) => {
    const id = String(i + 1).padStart(3, "0");
    const body = docs
      .map((d) => {
        // A linked document is here because of something OUTSIDE it, so say what:
        // an agent handed only the citing text cannot tell a stale reference from
        // a fine one.
        const targets = (plan.linkedBecause[d.id] ?? []).map((uuid) => {
          const t = byUuid.get(uuid);
          return t ? `${t.doc_no} - ${t.title} (changed)` : `${uuid} (removed from the atlas)`;
        });
        const why = targets.length ? `Re-queued: cross-references ${targets.join("; ")}\n` : "";
        return `## ${d.doc_no} - ${d.title} [${d.type}]\nUUID: ${d.id}\n${why}\n${d.content}`;
      })
      .join("\n\n---\n\n");
    fs.writeFileSync(path.join(CHUNKS, `${id}.md`), `${body}\n`);
  });

  fs.writeFileSync(
    path.join(WORK, "plan.json"),
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        atlasSha: atlasSha(),
        full,
        counts: {
          new: plan.new.length,
          changed: plan.changed.length,
          linked: plan.linked.length,
          unchanged: plan.unchanged.length,
          removed: plan.removed.length,
        },
        removed: plan.removed,
        linkedBecause: plan.linkedBecause,
        queued: queue.length,
        chunks: chunks.map((docs, i) => ({
          id: String(i + 1).padStart(3, "0"),
          docs: docs.map((d) => d.id),
        })),
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\nqueued ${queue.length} documents into ${chunks.length} chunks`);
  console.log(`  chunks:   ${path.relative(ROOT, CHUNKS)}/NNN.md`);
  console.log(`  findings: ${path.relative(ROOT, FINDINGS)}/NNN.jsonl  (one per chunk, write even if empty)`);
  console.log(`  then:     pnpm mistakes:merge`);
  process.exit(0);
}

// --- merge ------------------------------------------------------------------
if (cmd === "merge") {
  const { nodeMap, state } = load();
  const plan = readJson(path.join(WORK, "plan.json"), null);
  if (!plan) {
    console.error("[mistakes] no plan at .cache/mistakes-sweep/plan.json — run `pnpm mistakes:plan` first");
    process.exit(1);
  }

  const incoming = [];
  const evaluated = [];
  const skipped = [];
  let rejected = 0;

  for (const chunk of plan.chunks) {
    const file = path.join(FINDINGS, `${chunk.id}.jsonl`);
    if (!fs.existsSync(file)) {
      // No output file = the chunk was never processed. Recording its documents
      // as scanned would retire them from every future plan on the strength of
      // an agent that never ran.
      skipped.push(chunk.id);
      continue;
    }
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
    let parsed;
    try {
      parsed = lines.map((l) => JSON.parse(l));
    } catch {
      // A truncated last line means the agent died mid-write; the rest of the
      // chunk is unknowable, so the whole chunk stays unscanned.
      console.warn(`[mistakes] chunk ${chunk.id}: malformed JSONL — treating as unprocessed`);
      skipped.push(chunk.id);
      continue;
    }
    for (const row of parsed) {
      const result = validateFinding(row, nodeMap);
      if (result.ok) incoming.push(result.finding);
      else {
        rejected++;
        console.warn(`[mistakes] chunk ${chunk.id}: dropped a finding — ${result.reason}`);
      }
    }
    evaluated.push(...chunk.docs);
  }

  const artifact = readJson(ARTIFACT, { findings: [] });
  const merged = mergeFindings(artifact.findings, incoming, new Set(evaluated), plan.removed ?? [], {
    dropCorpus: flag("drop-corpus"),
  });
  const sha = plan.atlasSha ?? atlasSha();
  const next = {
    ...artifact,
    generatedAt: new Date().toISOString().slice(0, 10),
    atlasSha: sha ?? artifact.atlasSha,
    documentsScanned: Object.keys(nodeMap).length,
    findings: merged.findings,
  };

  console.log(`chunks processed ${plan.chunks.length - skipped.length}/${plan.chunks.length}`);
  if (skipped.length) console.log(`  unprocessed: ${skipped.join(", ")} (stay queued for the next plan)`);
  console.log(`documents evaluated ${evaluated.length}`);
  console.log(`findings: ${merged.kept} kept, ${merged.replaced} replaced, ${merged.added} added${rejected ? `, ${rejected} rejected` : ""}`);
  console.log(`total ${artifact.findings.length} → ${merged.findings.length}`);

  if (flag("dry-run")) {
    console.log("\n--dry-run: nothing written");
    process.exit(0);
  }

  fs.writeFileSync(ARTIFACT, `${JSON.stringify(next, null, 2)}\n`);
  fs.writeFileSync(
    STATE,
    `${JSON.stringify(advanceState(state, nodeMap, evaluated, plan.removed ?? [], sha), null, 2)}\n`,
  );
  console.log(`\nwrote ${path.relative(ROOT, ARTIFACT)} and ${path.relative(ROOT, STATE)}`);
  console.log("next: pnpm mistakes:render && pnpm cite:check ATLAS-FINDINGS.md");
  process.exit(0);
}

console.error(`unknown command "${cmd}" — expected status | bootstrap | plan | merge`);
process.exit(1);
