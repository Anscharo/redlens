#!/usr/bin/env bun
/**
 * `pnpm votes:sync` — the Sky governance vote record into public/votes.json.
 *
 * Reads every executive vote (sky-ecosystem/executive-votes) and governance
 * poll (sky-ecosystem/polls), then joins the vote.sky.money portal for each
 * spell's pass/execute dates and each poll's id, slug and outcome. Every rule
 * lives in scripts/lib/votes/ and is pinned by scripts_tests/votes-*.test.ts;
 * this file is only the I/O around them.
 *
 * Off the `pnpm build` chain: the build is offline and deterministic
 * (REPRO=1), and this fetches. The artifact does not depend on the atlas build.
 *
 * Flags:
 *   --exec-dir <path>  local executive-votes checkout (default: fetch main's tarball)
 *   --poll-dir <path>  local polls checkout (default: fetch main's tarball)
 *   --no-portal        skip vote.sky.money; every document's `portal` is null
 *   --out <path>       destination (default: public/votes.json)
 *   --dry-run          parse and print stats, write nothing
 *   --allow-shrink     overwrite even when the new record is smaller than the old
 *   --quiet            one summary line instead of the full stats
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { attachPortal, checkFloors, shrinkage, type JoinStats } from "../lib/votes/assemble.ts";
import { readVoteTree } from "../lib/votes/corpus.ts";
import { parseExecutive } from "../lib/votes/executive.ts";
import { fetchJson, repoTree, type Tree } from "../lib/votes/fetch.ts";
import { parsePoll } from "../lib/votes/poll.ts";
import { PORTAL_API, readPortal } from "../lib/votes/portal.ts";
import { summarize, summaryLine } from "../lib/votes/stats.ts";
import type { VotesArtifact } from "../lib/votes/types.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// A portal outage leaves the repository data valid, so it is a warning here;
// the shrink guard is what stops a portal-less artifact replacing a full one.
async function joinPortal(artifact: VotesArtifact, skip: boolean): Promise<JoinStats | null> {
  if (skip) return null;
  try {
    const join = attachPortal(artifact.executives, artifact.polls, await readPortal(fetchJson));
    artifact.sources.portal = PORTAL_API;
    return join;
  } catch (err) {
    console.warn(`votes: portal not read (${(err as Error).message}); every document's portal is null`);
    return null;
  }
}

function readPrevious(outPath: string): VotesArtifact | null {
  if (!fs.existsSync(outPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(outPath, "utf8")) as VotesArtifact;
  } catch {
    console.warn(`votes: ${outPath} is not valid JSON, so the shrink guard has nothing to compare against`);
    return null;
  }
}

function readFlags() {
  return parseArgs({
    strict: true,
    options: {
      "exec-dir": { type: "string" },
      "poll-dir": { type: "string" },
      "no-portal": { type: "boolean" },
      out: { type: "string" },
      "dry-run": { type: "boolean" },
      "allow-shrink": { type: "boolean" },
      quiet: { type: "boolean" },
    },
  }).values;
}
type Flags = ReturnType<typeof readFlags>;

// Each fetched tree is pushed onto `trees` as soon as it exists, so the
// caller's cleanup still runs when a later step throws.
async function buildArtifact(o: Flags, trees: Tree[]): Promise<{ artifact: VotesArtifact; join: JoinStats | null }> {
  const execTree = await repoTree("executive-votes", o["exec-dir"]);
  trees.push(execTree);
  const pollTree = await repoTree("polls", o["poll-dir"]);
  trees.push(pollTree);
  const artifact: VotesArtifact = {
    sources: { executives: execTree.source, polls: pollTree.source, portal: null },
    executives: readVoteTree(execTree.root, parseExecutive),
    polls: readVoteTree(pollTree.root, parsePoll),
  };
  checkFloors(artifact);
  return { artifact, join: await joinPortal(artifact, Boolean(o["no-portal"])) };
}

function emit(o: Flags, artifact: VotesArtifact, join: JoinStats | null, outPath: string): void {
  const rel = path.relative(ROOT, outPath);
  const shrunk = shrinkage(readPrevious(outPath), artifact);
  if (shrunk && !o["dry-run"] && !o["allow-shrink"]) {
    throw new Error(`votes: ${shrunk}; refusing to overwrite ${rel} (--allow-shrink if this is deliberate)`);
  }
  if (shrunk) console.warn(`votes: ${shrunk}`);
  if (o.quiet) console.log(summaryLine(artifact, o["dry-run"] ? "(dry run)" : rel));
  else for (const line of summarize(artifact, join)) console.log(line);
  if (o["dry-run"]) return;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");
  if (!o.quiet) console.log(`\nwrote ${rel}`);
}

async function main(): Promise<void> {
  const o = readFlags();
  const trees: Tree[] = [];
  try {
    const { artifact, join } = await buildArtifact(o, trees);
    emit(o, artifact, join, path.resolve(ROOT, o.out ?? "public/votes.json"));
  } finally {
    for (const t of trees) t.cleanup();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
