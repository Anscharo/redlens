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
//   pnpm briefings:pull  [--dry-run]           refresh the artifact and the state from
//                                               the database rows (needs DATABASE_URL)
//
// The writing happens between `plan` and `merge`, by subagents: one per chunk,
// each reading `.cache/atlas-briefings/INSTRUCTIONS.md` and one
// `chunks/NNN.md`, and writing `out/<model>/NNN.jsonl`. Deliberately OFF the
// `pnpm build` chain — it is hand-run, and public/doc-briefings.json is
// committed data the build cannot derive.
//
// Runs under bun: `--eval-targets` imports the eval's TypeScript query
// generator, so the pilot covers exactly the documents the eval will score.
import { argv } from "./doc-briefings/common.mjs";
import { merge } from "./doc-briefings/merge.mjs";
import { plan } from "./doc-briefings/plan.mjs";
import { pull } from "./doc-briefings/pull.mjs";
import { status } from "./doc-briefings/status.mjs";

const COMMANDS = { status, plan, merge, pull };
const cmd = argv.find((a) => !a.startsWith("-")) ?? "status";

if (COMMANDS[cmd]) {
  await COMMANDS[cmd]();
  process.exit(0);
}
console.error(`unknown command "${cmd}" — expected status | plan | merge | pull`);
process.exit(1);
