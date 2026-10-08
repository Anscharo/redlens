// The vote record fetched and assembled: what `pnpm votes:sync` writes to
// votes.json, plus each poll's body, which the artifact leaves out and the
// atlas worker's vote-evidence lane reads (the pull request a poll links, and
// the text a decision model weighs). One reader, so the two cannot disagree on
// which votes exist.

import type { VotesArtifact } from "../../../src/lib/votes/types.ts";
import { attachPortal, checkFloors, checkPortalJoin, type JoinStats } from "./assemble.ts";
import { readVoteTree } from "./corpus.ts";
import { parseExecutive } from "./executive.ts";
import { fetchJson, repoTree, type Tree } from "./fetch.ts";
import { readFrontmatter } from "./markdown.ts";
import { parsePoll } from "./poll.ts";
import { PORTAL_API, readPortal } from "./portal.ts";

export interface VoteRecord {
  artifact: VotesArtifact;
  join: JoinStats | null;
  /** Each poll's markdown body, by its file. */
  pollBodies: Map<string, string>;
}

export interface RecordOptions {
  /** Local checkouts; each defaults to its repository's main-branch tarball. */
  execDir?: string;
  pollDir?: string;
  /** False writes the repository data alone, every `portal` null. */
  portal: boolean;
}

/** Fetches both repositories (and the portal), parses them and checks the floors; every fetched tree is removed before it returns. */
export async function readVoteRecord(o: RecordOptions): Promise<VoteRecord> {
  const trees: Tree[] = [];
  try {
    const execTree = await repoTree("executive-votes", o.execDir);
    trees.push(execTree);
    const pollTree = await repoTree("polls", o.pollDir);
    trees.push(pollTree);
    const artifact: VotesArtifact = {
      sources: { executives: execTree.source, polls: pollTree.source, portal: null },
      executives: readVoteTree(execTree.root, parseExecutive),
      polls: readVoteTree(pollTree.root, parsePoll),
    };
    checkFloors(artifact);
    return { artifact, join: o.portal ? await joinPortal(artifact) : null, pollBodies: readPollBodies(pollTree.root) };
  } finally {
    for (const t of trees) t.cleanup();
  }
}

/** Each poll's markdown body under a polls checkout, by its file. */
export function readPollBodies(root: string): Map<string, string> {
  const rows = readVoteTree(root, (file, md) => ({ file, date: file.slice(5, 15), body: readFrontmatter(md).body.trim() }));
  return new Map(rows.map((r) => [r.file, r.body]));
}

// A portal failure fails the run. A portal-less artifact reads to a consumer as
// "no vote found", so writing one takes the explicit portal: false.
async function joinPortal(artifact: VotesArtifact): Promise<JoinStats> {
  let portal;
  try {
    portal = await readPortal(fetchJson);
  } catch (err) {
    throw new Error(`votes: portal not read (${(err as Error).message}); pass --no-portal to write the repository data alone`);
  }
  const join = attachPortal(artifact.executives, artifact.polls, portal);
  checkPortalJoin(join);
  artifact.sources.portal = PORTAL_API;
  return join;
}
