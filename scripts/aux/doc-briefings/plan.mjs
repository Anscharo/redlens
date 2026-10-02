import fs from "node:fs";
import path from "node:path";

import {
  AGENT_INSTRUCTIONS,
  buildCitations,
  buildTree,
  packSets,
  planBriefings,
  renderQueue,
  spreadSample,
} from "../../lib/doc-briefings.mjs";
import { docsToEvaluate } from "../../lib/mistakes-sweep.mjs";
import { CHUNKS, OUT, WORK, atlasSha, describe, flag, load, opt, rel } from "./common.mjs";

/**
 * The pilot's selection: every document a retrieval-eval query's target
 * competes with at close range. The definition lives in
 * scripts/eval/eval-briefing-coverage.ts and the eval imports the same one, so
 * what the pilot describes and what the eval treats as covered cannot differ.
 */
async function evalTargetDocs(nodes) {
  const { generateRetrievalQueries } = await import("../../eval/eval-retrieval-queries.ts");
  const { competingSets } = await import("../../eval/eval-briefing-coverage.ts");
  const { buildUnits } = await import("../../../src/server/retrieval/embed-units.ts");
  const { config } = await import("../../../src/server/config.ts");
  const queries = generateRetrievalQueries(nodes);
  const queued = new Set();
  for (const set of competingSets(nodes, buildUnits(nodes, config.embedGroupPolicy, {}), queries).values())
    for (const id of set) queued.add(id);
  console.log(`eval targets: ${queries.length} queries compete over ${queued.size} documents, in complete sibling sets`);
  return nodes.filter((n) => queued.has(n.id)).map((n) => n.id);
}

/** The queue for this run: the pilot's selection, or the drift plan cut by
 *  `--limit` and `--spread`. */
async function chooseQueue({ nodes, state, layout, tree, pilot, full }) {
  if (pilot) {
    // A pilot is a selection, not a pass over drift: it ignores the state, and
    // its merge leaves the state alone unless the rows are adopted.
    return { plan: null, queue: await evalTargetDocs(nodes) };
  }
  const plan = planBriefings(nodes, state, { full, tree });
  describe(plan, layout);
  let queue = docsToEvaluate(plan);
  const limit = Number.parseInt(opt("limit", ""), 10);
  // A capped run works a backlog down over several sittings. A set cut by the
  // cap is still rendered whole; the members left out stay queued.
  if (Number.isFinite(limit)) queue = queue.slice(0, limit);
  // `--spread=N` also caps a sitting, but takes its N evenly from the whole
  // queue, so a partial corpus is a fair sample of the full one.
  const spread = Number.parseInt(opt("spread", ""), 10);
  if (Number.isFinite(spread)) queue = spreadSample(queue, spread);
  return { plan, queue };
}

function reportChunks(queue, rendered, chunks) {
  const bytes = chunks.map((c) => c.texts.reduce((n, t) => n + t.length, 0));
  console.log(`\nqueued ${queue.length} documents in ${rendered.length} sibling sets → ${chunks.length} chunks`);
  if (chunks.length) {
    console.log(`  chunk size: ${Math.min(...bytes)}–${Math.max(...bytes)} chars, ${bytes.reduce((a, b) => a + b, 0)} in all`);
    console.log(`  rows owed per chunk: ${Math.min(...chunks.map((c) => c.docs.length))}–${Math.max(...chunks.map((c) => c.docs.length))}`);
  }
}

/** Exits with an error when the work directory holds agent output or pilot
 *  files and `--force` was not given. */
function guardWorkDir() {
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
}

function writeWork({ chunks, queue, plan, full, pilot }) {
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
}

/** `pnpm briefings:plan`: write the work plan and chunk files. */
export async function plan() {
  const { nodes, state, layout, stale } = load();
  const tree = buildTree(nodes);
  const pilot = flag("eval-targets");
  const full = flag("full") || stale;
  const picked = await chooseQueue({ nodes, state, layout, tree, pilot, full });
  const { queue } = picked;

  const rendered = renderQueue(nodes, queue, { tree, citations: buildCitations(nodes) });
  const chunks = packSets(rendered, { maxBytes: Number.parseInt(opt("max-bytes", "40000"), 10) });
  reportChunks(queue, rendered, chunks);

  if (flag("dry-run")) {
    if (rendered.length) console.log(`\n--- sample set ---\n${rendered[Math.floor(rendered.length / 2)].text.slice(0, 2500)}`);
    console.log("\n--dry-run: nothing written, no model called");
    process.exit(0);
  }

  guardWorkDir();
  writeWork({ chunks, queue, plan: picked.plan, full, pilot });

  console.log(`  instructions: ${rel(WORK)}/INSTRUCTIONS.md`);
  console.log(`  chunks:       ${rel(CHUNKS)}/NNN.md`);
  console.log(`  output:       ${rel(OUT)}/<model>/NNN.jsonl  (one per chunk)`);
  console.log("  then:         pnpm briefings:merge --model=<model>");
  process.exit(0);
}
