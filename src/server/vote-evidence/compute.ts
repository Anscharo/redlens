// The vote-evidence overlay for every Stale Dates claim: the rules' verdict
// (src/lib/votes/evidence.ts) refined by atlas history and a decision model
// (src/lib/votes/overlay.ts). I/O is injected, so this is testable without a
// network, a database or a git checkout; the worker lane
// (src/server/sync-vote-evidence.ts) supplies the real calls.

import type { AtlasNode } from "../../types.ts";
import { buildStaleDatesReport, type DateClaim } from "../../lib/staleDates.ts";
import type { VoteEvidence } from "../../lib/votes/evidence.ts";
import { claimKey, historyEvidence, judgePoll, judgeSubject } from "../../lib/votes/overlay.ts";
import type { Poll, VotesArtifact } from "../../lib/votes/types.ts";
import { buildVoteIndex, pollPassed, pollUrl, type VoteIndex } from "../../lib/votes/vote-index.ts";
import type { JevQuestion } from "../jev.ts";
import { mapPool } from "../pool.ts";
import { pickaxeNeedle, pollForPr } from "./history.ts";
import * as R from "./requests.ts";

/** Nouls by question id, or null when the model was not asked (capped, past the deadline) or failed. */
export type Judge = (state: unknown, questions: Record<string, JevQuestion>, lane: string) => Promise<Record<string, number | null> | null>;

export interface ComputeDeps {
  /** The decision model; null leaves every rules verdict that history does not settle. */
  model: string | null;
  judge: Judge;
  /** The pull request that first wrote `needle` into the atlas, or null. */
  firstPr: (needle: string) => Promise<number | null>;
  today: Date;
  concurrency?: number;
}

export interface ComputeInput {
  docs: Record<string, AtlasNode>;
  artifact: VotesArtifact;
  pollBodies: ReadonlyMap<string, string>;
}

export interface ComputeResult {
  claims: Record<string, VoteEvidence>;
  /** Claims the model should have judged and did not: the next run asks again. */
  unjudged: number;
  judged: number;
  fromHistory: number;
}

interface Ctx extends ComputeInput, ComputeDeps {
  index: VoteIndex;
  passedPolls: Map<string, Poll>;
  tally: { unjudged: number; judged: number; fromHistory: number };
}

export async function computeOverlay(input: ComputeInput, deps: ComputeDeps): Promise<ComputeResult> {
  const index = buildVoteIndex(input.artifact);
  const report = buildStaleDatesReport(input.docs, deps.today, index);
  const ctx: Ctx = {
    ...input, ...deps, index,
    passedPolls: new Map(input.artifact.polls.filter(pollPassed).map((p) => [p.file, p])),
    tally: { unjudged: 0, judged: 0, fromHistory: 0 },
  };
  const all = [...report.stale, ...report.dueSoon, ...report.upcoming, ...report.recorded];
  const unique = [...new Map(all.map((c) => [claimKey(c), c])).values()];
  const resolved = await mapPool(unique, deps.concurrency ?? 4, async (c) => [claimKey(c), await resolve(c, ctx)] as const);
  return { claims: Object.fromEntries(resolved), ...ctx.tally };
}

function resolve(c: DateClaim, ctx: Ctx): Promise<VoteEvidence> {
  const rule = c.voteEvidence!;
  if (c.vote) return rule.via === "date" ? judgeDated(c, rule, ctx) : Promise.resolve(rule);
  return resolveUndated(c, rule, ctx);
}

function claimInput(c: DateClaim, ctx: Ctx): R.ClaimInput & { documentText: string } {
  const content = ctx.docs[c.docId].content;
  return { title: c.title, date: c.dateISO, sentence: R.claimSentence(content, c), documentText: R.documentText(content) };
}

async function judgeDated(c: DateClaim, rule: VoteEvidence, ctx: Ctx): Promise<VoteEvidence> {
  const m = rule.vote!;
  const vote = ctx.artifact.executives.find((e) => e.date === m.date && e.title === m.title);
  if (!ctx.model || !vote) return rule;
  const nouls = await ctx.judge(R.subjectState({ ...claimInput(c, ctx), vote }), R.SUBJECT_QUESTIONS, "vote-evidence-subject");
  const anchor = nouls?.anchor;
  const carried = nouls?.carried;
  if (anchor == null || carried == null) {
    ctx.tally.unjudged++;
    return rule;
  }
  ctx.tally.judged++;
  const cast = ctx.index.executives.some((e) => e.date === m.date && e.title === m.title && e.cast);
  return judgeSubject(rule, cast, { model: ctx.model, anchor, carried });
}

// In measured order of trust: an executive linking the document, then the
// poll atlas history names, then a poll linking the document, then the model's pick.
async function resolveUndated(c: DateClaim, rule: VoteEvidence, ctx: Ctx): Promise<VoteEvidence> {
  if (rule.via === "link" && rule.vote?.kind === "executive") return rule;
  const file = pollForPr(await ctx.firstPr(pickaxeNeedle(c)), ctx.pollBodies);
  const poll = file ? ctx.passedPolls.get(file) : undefined;
  if (poll) {
    ctx.tally.fromHistory++;
    return historyEvidence(c.dateISO, { title: poll.title, date: poll.date, url: pollUrl(poll) });
  }
  if (rule.via === "link" || !ctx.model) return rule;
  return judgeUndated(c, rule, ctx, ctx.model);
}

async function judgeUndated(c: DateClaim, rule: VoteEvidence, ctx: Ctx, model: string): Promise<VoteEvidence> {
  const base = claimInput(c, ctx);
  const { candidates } = R.pollCandidates(base, ctx.artifact.polls, ctx.pollBodies);
  if (!candidates.length) return rule;
  const input = { ...base, candidates };
  const nouls = await ctx.judge(R.pollState(input), R.pollQuestions(input), "vote-evidence-poll");
  if (!nouls) {
    ctx.tally.unjudged++;
    return rule;
  }
  ctx.tally.judged++;
  const polls = new Map(ctx.artifact.polls.map((p) => [p.file, p]));
  const scored = candidates.map((cand) => ({ poll: { title: cand.title, date: cand.date, url: pollUrl(polls.get(cand.file)!) }, p: nouls[cand.id] ?? null }));
  return judgePoll(rule, c.dateISO, model, scored);
}
