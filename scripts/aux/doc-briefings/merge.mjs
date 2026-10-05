import fs from "node:fs";
import path from "node:path";

import { isComplete, mergeBriefings, parseRows, serializeArtifact, validateBriefing } from "../../lib/doc-briefings.mjs";
import { advanceState } from "../../lib/mistakes-sweep.mjs";
import { ARTIFACT, OUT, STATE, WORK, atlasSha, flag, load, opt, readJson, rel } from "./common.mjs";

/** Reads and validates every chunk's output file. */
function collectRows(plan, nodeMap, model) {
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
  return { incoming, described, skipped, reasons, owed };
}

function report({ plan, merged, collected }) {
  const { described, skipped, reasons, owed } = collected;
  console.log(`chunks processed ${plan.chunks.length - skipped.length}/${plan.chunks.length}`);
  if (skipped.length) console.log(`  unprocessed: ${skipped.join(", ")} (stay queued for the next plan)`);
  console.log(`rows: ${described.size} valid of ${owed} owed${owed > described.size ? ` — ${owed - described.size} documents stay queued` : ""}`);
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  dropped ${n}: ${reason}`);
  console.log(`briefings: ${merged.kept} kept, ${merged.replaced} replaced, ${merged.added} added → ${Object.keys(merged.briefings).length}`);
}

/** `pnpm briefings:merge`: fold agent output into the artifact. */
export function merge() {
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


  const collected = collectRows(plan, nodeMap, model);
  const { incoming, described } = collected;

  // A pilot's rows go to a per-model file beside the plan, so two models can be
  // compared on the same chunks. `--adopt` sends them to the committed artifact.
  const pilot = plan.pilot && !flag("adopt");
  const target = pilot ? path.join(WORK, `pilot-${model}.json`) : ARTIFACT;
  const artifact = readJson(target, { briefings: {} });
  const removed = pilot ? [] : (plan.removed ?? []);
  const merged = mergeBriefings(artifact.briefings ?? {}, incoming, nodeMap, removed, model);
  const sha = plan.atlasSha ?? atlasSha();

  report({ plan, merged, collected });

  if (flag("dry-run")) {
    console.log("\n--dry-run: nothing written");
    process.exit(0);
  }

  fs.writeFileSync(target, serializeArtifact(merged.briefings, sha));
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
