// Shape of public/votes.json: the Sky governance vote record (executive
// votes and governance polls) as `pnpm votes:sync` assembles it from the
// sky-ecosystem/executive-votes and sky-ecosystem/polls repositories plus the
// vote.sky.money portal API.
//
// The artifact is independent of the atlas build. Atlas references are kept
// as written (a uuid, or a doc_no as it read on the vote's date); joining them
// to docs.json is the matcher's job (./evidence.ts), because a doc_no is an
// editorial label that only means something against the atlas of its own date.

/** Where a link in a vote document points. */
export type LinkFamily =
  | "atlas" // sky-atlas.io/#<uuid>
  | "atlas-docno" // sky-atlas.io/#A.1.10.2.2 — a doc_no, valid for the vote's date only
  | "powerhouse" // sky-atlas.powerhouse.io — legacy ids, not next-gen-atlas uuids
  | "poll" // vote.sky.money/polling/<slug>
  | "executive" // vote.sky.money/executive/<key>
  | "snapshot" // snapshot.box / snapshot.org — Prime-level governance
  | "forum" // forum.sky.money, forum.skyeco.com, forum.makerdao.com
  | "other";

export interface VoteLink {
  family: LinkFamily;
  url: string;
  text: string;
  uuid?: string;
  docNo?: string;
  pollSlug?: string;
  pollId?: number;
  forumTopic?: number;
}

/** One `### <action>` block under an executive's `## Proposal Details`. */
export interface ExecutiveSection {
  heading: string;
  /** The section body as plain words (links reduced to their text), for the subject check. */
  text: string;
  authorization: VoteLink[];
  proposal: VoteLink[];
  /** Every atlas-family link in the section, authorization lines included. */
  atlasRefs: VoteLink[];
}

/** Enactment state as the portal reports it. Dates are ISO timestamps. */
export interface ExecutivePortal {
  key: string;
  date: string;
  active: boolean;
  hasBeenCast: boolean;
  datePassed: string | null;
  dateExecuted: string | null;
}

export interface Executive {
  file: string;
  /** The filename date — the date atlas prose cites ("the January 29, 2026 Executive Vote"). */
  date: string;
  /** Frontmatter `date`; it disagrees with the filename on some executives. */
  frontmatterDate: string | null;
  outOfSchedule: boolean;
  title: string;
  summary: string;
  /** The spell address; null while the executive is drafted and its spell not yet deployed. */
  address: string | null;
  sections: ExecutiveSection[];
  portal: ExecutivePortal | null;
}

export interface PollPortal {
  pollId: number;
  slug: string;
  multiHash: string;
  tags: string[];
  winner: string | null;
  numVoters: number | null;
}

export interface Poll {
  file: string;
  /** The filename date: the poll's scheduled start. */
  date: string;
  start: string | null;
  end: string | null;
  title: string;
  summary: string;
  discussionLink: string | null;
  atlasRefs: VoteLink[];
  /** The next-gen-atlas pull requests the poll's body links, ascending: the atlas edits it approved. */
  atlasPrs: number[];
  portal: PollPortal | null;
}

export interface VotesArtifact {
  sources: { executives: string; polls: string; portal: string | null };
  executives: Executive[];
  polls: Poll[];
}
