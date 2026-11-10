// A Prime's Snapshot polls, as the server reads them (src/server/prime-polls.ts): each links
// the atlas pull request(s) it votes on in its own body, carries its result,
// and points at the forum thread it was proposed in. An executive's Prime
// Agent Proxy Spells section links the polls whose items its spell carries
// (VoteIndex.snapshots), so a poll is the direct link from an atlas PR to the
// spell, item by item: one forum thread lists several items, and an item can
// be an artifact change no spell carries, or be re-proposed for another spell.
// Pure.
import { threadSpellDate } from "./atlasPrSpell.ts";
import { atlasPullRequests } from "./votes/atlas-prs.ts";

export interface PrimePoll {
  /** The Snapshot proposal id, lowercased. */
  id: string;
  space: string;
  title: string;
  /** When voting closed (or closes), YYYY-MM-DD. */
  end: string;
  /** Whether "For" carried it; null while voting is open. */
  passed: boolean | null;
  /** The spell date of the "Proposed Changes … for Upcoming Spell" thread it was proposed in, YYYY-MM-DD; null when it names none. */
  threadDate: string | null;
  prs: number[];
}

/** A Snapshot proposal as the hub's GraphQL answers it. */
export interface SnapshotProposal {
  id: string;
  title: string;
  space: { id: string };
  end: number;
  state: string;
  choices: string[];
  scores: number[];
  discussion: string | null;
  body: string;
}

/** Whether "For" won a closed poll, outscoring every other choice; null while it is open. A poll with no scores tallied did not pass. */
function passedOf(p: SnapshotProposal): boolean | null {
  if (p.state !== "closed") return null;
  const forAt = p.choices.findIndex((c) => /^(for|yes|yay)\b/i.test(c));
  if (forAt < 0) return null;
  const forScore = p.scores[forAt];
  return forScore !== undefined && p.scores.every((s, i) => i === forAt || s < forScore);
}

export function toPrimePoll(p: SnapshotProposal): PrimePoll {
  const prs = atlasPullRequests(p.body);
  return {
    id: p.id.toLowerCase(), space: p.space.id, title: p.title, end: new Date(p.end * 1000).toISOString().slice(0, 10),
    passed: passedOf(p), threadDate: p.discussion ? threadSpellDate(p.discussion) : null, prs,
  };
}

/** Each atlas PR's polls. */
export function pollsByPr(polls: readonly PrimePoll[]): Map<number, PrimePoll[]> {
  const out = new Map<number, PrimePoll[]>();
  for (const p of polls) for (const pr of p.prs) out.set(pr, [...(out.get(pr) ?? []), p]);
  return out;
}

/**
 * Whether the poll's item is an artifact change or a request to Sky Core, which
 * no Prime spell carries: Grove's "[Grove Artifact] …" or "[Sky Core] …", or
 * Spark's "SAEP-25: …" artifact edit. An item whose tag also names a chain
 * ("[Grove Artifact + Ethereum] …") has a part a spell carries, so it is not.
 */
export const offSpellPoll = (p: PrimePoll): boolean => /^SAEP-\d+\b/i.test(p.title) || /^\[[^\]+]*(artifact|sky core)[^\]+]*\]/i.test(p.title);
