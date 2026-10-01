// Driver for the placement-aware document briefings.
//
//   pnpm briefings:status                      what needs a description
//   pnpm briefings:plan  [--full] [--limit=N]  write the work plan + chunk files
//                        [--spread=N]           about N documents, spread evenly
//                                               over the queue (--limit takes the first N)
//                        [--eval-targets]       pilot: only the documents the
//                                               retrieval eval's queries compete over
//                        [--dry-run]            counts and a sample, nothing written
//                        [--force]              replace a work directory that still
//                                               holds agent output or pilot files
//   pnpm briefings:merge --model=NAME          fold agent output into the artifact
//                        [--adopt] [--dry-run]
//
// The writing happens between `plan` and `merge`, by subagents: one per chunk,
// each reading `.cache/atlas-briefings/INSTRUCTIONS.md` and one
// `chunks/NNN.md`, and writing `out/<model>/NNN.jsonl`. Deliberately OFF the
// `pnpm build` chain — it is hand-run, and public/doc-briefings.json is
// committed data the build cannot derive.
//
// Runs under bun: `--eval-targets` imports the eval's TypeScript query
// generator, so the pilot covers exactly the documents the eval will score.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { loadAtlasSource } from "../lib/atlas-source.mjs";
import {
  AGENT_INSTRUCTIONS,
  ARTIFACT_VERSION,
  buildCitations,
  buildTree,
  isComplete,
  mergeBriefings,
  packSets,
  parseRows,
  planBriefings,
  renderQueue,
  spreadSample,
  validateBriefing,
} from "../lib/doc-briefings.mjs";
import { advanceState, docsToEvaluate, emptyState, isStateUsable } from "../lib/mistakes-sweep.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ATLAS = path.join(ROOT, "vendor/next-gen-atlas");
const ARTIFACT = path.join(ROOT, "public/doc-briefings.json");
const STATE = path.join(ROOT, ".github/briefings-state.json");
const WORK = path.join(ROOT, ".cache/atlas-briefings");
const CHUNKS = path.join(WORK, "chunks");
const OUT = path.join(WORK, "out");

const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith("-")) ?? "status";
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const rel = (file) => path.relative(ROOT, file);

const readJson = (file, fallback) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;

function atlasSha() {
  try {
    return execFileSync("git", ["-C", ATLAS, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function load() {
  const { nodes, nodeMap, layout } = loadAtlasSource(ATLAS);
  const raw = readJson(STATE, null);
  // A state from another digest recipe cannot be compared with this one, so the
  // run degrades to a full pass — loudly — rather than reading changed
  // documents as described.
  const stale = raw && !isStateUsable(raw);
  if (stale) console.warn(`[briefings] state v${raw.version} is incompatible — full pass forced`);
  return { nodes, nodeMap, layout, state: stale || !raw ? emptyState() : raw, stale: !!stale };
}

function describe(plan, layout) {
  const pct = ((plan.unchanged.length / Math.max(plan.total, 1)) * 100).toFixed(1);
  console.log(`atlas: ${plan.total} documents (${layout} layout)`);
  console.log(`  new        ${plan.new.length}`);
  console.log(`  changed    ${plan.changed.length}`);
  console.log(`  linked     ${plan.linked.length}  (unchanged, but a parent or a citing document moved)`);
  console.log(`  unchanged  ${plan.unchanged.length}  (${pct}% skipped)`);
  console.log(`  removed    ${plan.removed.length}`);
}

/**
 * The pilot's selection: every document a retrieval-eval query's target
 * competes with at close range. The definition lives in
 * scripts/eval/eval-briefing-coverage.ts and the eval imports the same one, so
 * what the pilot describes and what the eval treats as covered cannot differ.
 */
async function evalTargetDocs(nodes) {
  const { generateRetrievalQueries } = await import("../eval/eval-retrieval-queries.ts");
  const { competingSets } = await import("../eval/eval-briefing-coverage.ts");
  const { buildUnits } = await import("../../src/server/retrieval/embed-units.ts");
  const { config } = await import("../../src/server/config.ts");
  const queries = generateRetrievalQueries(nodes);
  const queued = new Set();
  for (const set of competingSets(nodes, buildUnits(nodes, config.embedGroupPolicy, {}), queries).values())
    for (const id of set) queued.add(id);
  console.log(`eval targets: ${queries.length} queries compete over ${queued.size} documents, in complete sibling sets`);
  return nodes.filter((n) => queued.has(n.id)).map((n) => n.id);
}

// --- status -----------------------------------------------------------------
if (cmd === "status") {
  const { nodes, layout, state, stale } = load();
  const full = stale || flag("full");
  const plan = planBriefings(nodes, state, { full });
  describe(plan, layout);
  const artifact = readJson(ARTIFACT, null);
  console.log(`described: ${artifact ? Object.keys(artifact.briefings ?? {}).length : 0} documents in ${rel(ARTIFACT)}`);
  console.log(`last pass: ${state.sweptAt ?? "never"} @ ${(state.atlasSha ?? "—").slice(0, 8)}`);
  process.exit(0);
}

// --- plan -------------------------------------------------------------------
if (cmd === "plan") {
  const { nodes, state, layout, stale } = load();
  const tree = buildTree(nodes);
  const pilot = flag("eval-targets");
  const full = flag("full") || stale;

  let queue;
  let plan = null;
  if (pilot) {
    // A pilot is a selection, not a pass over drift: it ignores the state, and
    // its merge leaves the state alone unless the rows are adopted.
    queue = await evalTargetDocs(nodes);
  } else {
    plan = planBriefings(nodes, state, { full, tree });
    describe(plan, layout);
    queue = docsToEvaluate(plan);
    const limit = Number.parseInt(opt("limit", ""), 10);
    // A capped run works a backlog down over several sittings. A set cut by the
    // cap is still rendered whole; the members left out stay queued.
    if (Number.isFinite(limit)) queue = queue.slice(0, limit);
    // `--spread=N` also caps a sitting, but takes its N evenly from the whole
    // queue, so a partial corpus is a fair sample of the full one.
    const spread = Number.parseInt(opt("spread", ""), 10);
    if (Number.isFinite(spread)) queue = spreadSample(queue, spread);
  }

  const rendered = renderQueue(nodes, queue, { tree, citations: buildCitations(nodes) });
  const chunks = packSets(rendered, { maxBytes: Number.parseInt(opt("max-bytes", "40000"), 10) });
  const bytes = chunks.map((c) => c.texts.reduce((n, t) => n + t.length, 0));
  console.log(`\nqueued ${queue.length} documents in ${rendered.length} sibling sets → ${chunks.length} chunks`);
  if (chunks.length) {
    console.log(`  chunk size: ${Math.min(...bytes)}–${Math.max(...bytes)} chars, ${bytes.reduce((a, b) => a + b, 0)} in all`);
    console.log(`  rows owed per chunk: ${Math.min(...chunks.map((c) => c.docs.length))}–${Math.max(...chunks.map((c) => c.docs.length))}`);
  }

  if (flag("dry-run")) {
    if (rendered.length) console.log(`\n--- sample set ---\n${rendered[Math.floor(rendered.length / 2)].text.slice(0, 2500)}`);
    console.log("\n--dry-run: nothing written, no model called");
    process.exit(0);
  }

  // A new plan replaces the work directory, and with it whatever the agents of
  // the last plan wrote. A full pilot is some six million subagent tokens, so
  // this looks before it deletes.
  const atRisk = [
    ...(fs.existsSync(OUT) ? fs.readdirSync(OUT, { recursive: true }).filter((f) => String(f).endsWith(".jsonl")) : []),
    ...(fs.existsSync(WORK) ? fs.readdirSync(WORK).filter((f) => /^pilot-.+\.json$/.test(f)) : []),
  ];
  if (atRisk.length && !flag("force")) {
    console.error(
      `\n[briefings] ${rel(WORK)} holds ${atRisk.length} agent output and pilot files from the last plan.\n` +
        "  Merge or copy them first, or pass --force to delete them.",
    );
    process.exit(1);
  }
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(CHUNKS, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(WORK, "INSTRUCTIONS.md"), AGENT_INSTRUCTIONS);
  const ids = chunks.map((_, i) => String(i + 1).padStart(3, "0"));
  chunks.forEach((chunk, i) => {
    fs.writeFileSync(path.join(CHUNKS, `${ids[i]}.md`), `${chunk.texts.join("\n\n---\n\n")}\n`);
  });
  fs.writeFileSync(
    path.join(WORK, "plan.json"),
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        atlasSha: atlasSha(),
        full,
        pilot,
        removed: plan?.removed ?? [],
        queued: queue.length,
        chunks: chunks.map((chunk, i) => ({ id: ids[i], docs: chunk.docs })),
      },
      null,
      2,
    )}\n`,
  );

  console.log(`  instructions: ${rel(WORK)}/INSTRUCTIONS.md`);
  console.log(`  chunks:       ${rel(CHUNKS)}/NNN.md`);
  console.log(`  output:       ${rel(OUT)}/<model>/NNN.jsonl  (one per chunk)`);
  console.log("  then:         pnpm briefings:merge --model=<model>");
  process.exit(0);
}

// --- merge ------------------------------------------------------------------
if (cmd === "merge") {
  const model = opt("model", "");
  if (!model) {
    console.error("[briefings] --model=NAME is required: it names the output folder and is stamped on every row");
    process.exit(1);
  }
  const { nodes, nodeMap, state } = load();
  const plan = readJson(path.join(WORK, "plan.json"), null);
  if (!plan) {
    console.error(`[briefings] no plan at ${rel(WORK)}/plan.json — run \`pnpm briefings:plan\` first`);
    process.exit(1);
  }

  const incoming = [];
  const described = new Set();
  const skipped = [];
  const reasons = new Map();
  let owed = 0;

  for (const chunk of plan.chunks) {
    const file = path.join(OUT, model, `${chunk.id}.jsonl`);
    // No output file = the chunk was never processed. Malformed JSONL = the
    // agent died mid-write. Either way nothing in the chunk is recorded.
    const rows = fs.existsSync(file) ? parseRows(fs.readFileSync(file, "utf8")) : null;
    if (!rows) {
      if (fs.existsSync(file)) console.warn(`[briefings] chunk ${chunk.id}: malformed JSONL — treating as unprocessed`);
      skipped.push(chunk.id);
      continue;
    }
    owed += chunk.docs.length;
    const requested = new Set(chunk.docs);
    for (const row of rows) {
      const result = validateBriefing(row, nodeMap, requested);
      if (!result.ok) {
        const reason = result.reason.replace(/\d+ chars/, "N chars").replace(/ \(?[0-9a-f-]{36}\)?| undefined/, "");
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        continue;
      }
      if (described.has(result.uuid)) continue; // first valid row for a document wins
      described.add(result.uuid);
      incoming.push({ uuid: result.uuid, entry: result.entry });
    }
  }

  // A pilot's rows go to a per-model file beside the plan, so two models can be
  // compared on the same chunks. `--adopt` sends them to the committed artifact.
  const pilot = plan.pilot && !flag("adopt");
  const target = pilot ? path.join(WORK, `pilot-${model}.json`) : ARTIFACT;
  const artifact = readJson(target, { briefings: {} });
  const removed = pilot ? [] : (plan.removed ?? []);
  const merged = mergeBriefings(artifact.briefings ?? {}, incoming, nodeMap, removed, model);
  const sha = plan.atlasSha ?? atlasSha();

  console.log(`chunks processed ${plan.chunks.length - skipped.length}/${plan.chunks.length}`);
  if (skipped.length) console.log(`  unprocessed: ${skipped.join(", ")} (stay queued for the next plan)`);
  console.log(`rows: ${described.size} valid of ${owed} owed${owed > described.size ? ` — ${owed - described.size} documents stay queued` : ""}`);
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  dropped ${n}: ${reason}`);
  console.log(`briefings: ${merged.kept} kept, ${merged.replaced} replaced, ${merged.added} added → ${Object.keys(merged.briefings).length}`);

  if (flag("dry-run")) {
    console.log("\n--dry-run: nothing written");
    process.exit(0);
  }

  // One row per line: a rewrite of one description is a one-line diff.
  const body = Object.entries(merged.briefings)
    .map(([uuid, row]) => `${JSON.stringify(uuid)}:${JSON.stringify(row)}`)
    .join(",\n");
  fs.writeFileSync(
    target,
    `{"version":${ARTIFACT_VERSION},"atlasSha":${JSON.stringify(sha)},"briefings":{\n${body}\n}}\n`,
  );
  if (pilot) {
    console.log(`\nwrote ${rel(target)} (pilot — state and ${rel(ARTIFACT)} untouched; --adopt commits these rows)`);
    process.exit(0);
  }
  const next = advanceState(state, nodeMap, [...described], removed, sha);
  // From the first moment every live document is described, a `new` document is
  // one upstream added, and the plan expands from it. See planBriefings.
  next.complete = state.complete === true || isComplete(nodes, next);
  fs.writeFileSync(STATE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\nwrote ${rel(target)} and ${rel(STATE)}`);
  process.exit(0);
}

console.error(`unknown command "${cmd}" — expected status | plan | merge`);
process.exit(1);
