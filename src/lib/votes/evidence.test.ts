// Vote evidence rules (src/lib/votes/evidence.ts, vote-index.ts) over a small
// synthetic vote record, plus the live regression case when the artifacts exist.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { AtlasNode } from "../../types";
import { buildStaleDatesReport } from "../staleDates";
import type { VoteRef } from "./claim";
import { voteEvidence } from "./evidence";
import { evidenceText } from "./labels";
import type { Executive, Poll, VotesArtifact } from "./types";
import { buildVoteIndex, LINK_WINDOW } from "./vote-index";

function exec(date: string, text: string, over: Partial<Executive> = {}): Executive {
  return {
    file: `2026/executive-vote-${date}.md`,
    date,
    frontmatterDate: null,
    outOfSchedule: false,
    title: `Executive ${date}`,
    summary: "",
    address: "0x1",
    sections: [{ heading: "Action", text, authorization: [], proposal: [], atlasRefs: [] }],
    portal: { key: `key-${date}`, date, active: false, hasBeenCast: true, datePassed: null, dateExecuted: null },
    ...over,
  };
}

function poll(date: string, uuids: string[], winner: string | null = "Yes"): Poll {
  const atlasRefs = uuids.map((uuid) => ({ family: "atlas" as const, url: `https://sky-atlas.io/#${uuid}`, text: "", uuid }));
  return { file: `2026/${date}-poll.md`, date, start: null, end: null, title: `Poll ${date}`, summary: "", discussionLink: null, atlasRefs, portal: { pollId: 1, slug: `Qm${date}`, multiHash: "", tags: [], winner, numVoters: 1 } };
}

const linkTo = (uuid: string) => [{ family: "atlas" as const, url: "", text: "", uuid }];

// Filler executives keep the rare-term arithmetic honest: "genesis" and
// "transfer" become common, the agent names stay rare.
const filler = ["2026-01-15", "2026-02-12", "2026-02-26", "2026-04-23", "2026-05-21", "2026-06-04"].map((d, i) =>
  exec(d, `Genesis transfer of USDS from the Surplus Buffer. Safe Harbor update.${i < 2 ? " Prysm onboarding." : ""}`),
);

const artifact: VotesArtifact = {
  sources: { executives: "", polls: "", portal: null },
  executives: [
    ...filler,
    exec("2026-03-26", "Genesis Funding transfers to Keel, Amatsu and Ozone from the Surplus Buffer."),
    exec("2025-10-06", "Spark Proxy Spell: transfer to the Spark Foundation."),
    exec("2025-11-13", "Kicker activation."),
    exec("2025-11-13", "Solana bridge migration.", { outOfSchedule: true, title: "OOS 2025-11-13", file: "2025/oos-executive-vote-2025-11-13.md" }),
    exec("2026-06-18", "Monthly settlement cycle."),
    exec("2026-10-08", "stUSDS keeper launch.", { address: null, portal: null }),
    exec("2026-07-02", "DC-IAM update.", { sections: [{ heading: "Grant", text: "", authorization: linkTo("doc-linked"), proposal: [], atlasRefs: linkTo("doc-linked") }] }),
  ],
  polls: [poll("2026-04-27", ["doc-poll", "article"]), poll("2026-04-20", ["doc-failed"], "No")],
};
const index = buildVoteIndex(artifact);

function node(id: string, type: string, parentId: string | null): AtlasNode {
  return { id, doc_no: id, title: id, type, depth: 1, parentId, order: 0, content: "", addressRefs: [] };
}
const docs: Record<string, AtlasNode> = Object.fromEntries(
  [
    node("article", "Article", null),
    node("doc-linked", "Core", "article"),
    node("child", "Core", "doc-linked"),
    node("grandchild", "Core", "child"),
    node("great-grandchild", "Core", "grandchild"),
    node("doc-poll", "Core", "article"),
    node("doc-failed", "Core", "article"),
    node("orphan", "Core", "article"),
  ].map((d) => [d.id, d]),
);

const ref = (subject: string[], over: Partial<VoteRef> = {}): VoteRef => ({ outOfSchedule: false, anchor: false, subject, ...over });
const byDate = (dateISO: string, vote: VoteRef) => voteEvidence({ docId: "orphan", dateISO, vote }, docs, index);
const byLink = (docId: string, dateISO: string) => voteEvidence({ docId, dateISO, vote: null }, docs, index);

describe("claims that name an Executive Vote", () => {
  it("is enacted when the executive on that date names the subject", () => {
    const e = byDate("2026-03-26", ref(["keel", "genesis"]));
    expect(e).toMatchObject({ status: "enacted", via: "date", vote: { kind: "executive", date: "2026-03-26", offsetDays: 0 } });
    expect(e.vote?.url).toBe("https://vote.sky.money/executive/key-2026-03-26");
    // A minor term the executive lacks is kept in the data but not reported on an enacted claim.
    const partial = byDate("2026-03-26", ref(["keel", "amatsu", "prysm"]));
    expect(partial).toMatchObject({ status: "enacted", subject: { missing: ["prysm"] } });
    expect(evidenceText(partial)).toBe("enacted · executive 2026-03-26 (+0d)");
  });

  it("flags an executive on the date that never names the subject (the Osero case)", () => {
    const e = byDate("2026-03-26", ref(["osero", "genesis"]));
    expect(e.status).toBe("subject-missing");
    expect(e.subject?.missing).toContain("osero");
    expect(evidenceText(e)).toBe("subject missing · executive 2026-03-26 (+0d) · missing: osero");
  });

  it("follows a spell that slipped a few days, and reports the offset", () => {
    const e = byDate("2025-10-02", ref(["spark", "foundation"]));
    expect(e).toMatchObject({ status: "enacted", vote: { date: "2025-10-06", offsetDays: 4 } });
  });

  it("does not check the subject when the sentence only dates something by the vote", () => {
    const e = byDate("2026-06-18", ref(["reviewer", "checklist"], { anchor: true }));
    expect(e).toMatchObject({ status: "vote-on-date", subject: null });
  });

  it("is a vote on the date when the sentence names nothing checkable", () => {
    expect(byDate("2026-06-18", ref([])).status).toBe("vote-on-date");
  });

  it("prefers the out-of-schedule executive when the claim names one", () => {
    expect(byDate("2025-11-13", ref([], { outOfSchedule: true })).vote?.title).toBe("OOS 2025-11-13");
    expect(byDate("2025-11-13", ref([])).vote?.title).toBe("Executive 2025-11-13");
    const oos = voteEvidence({ docId: "orphan", dateISO: "2025-11-13", vote: ref(["solana"], { outOfSchedule: true }) }, docs, index);
    expect(oos.status).toBe("enacted");
    expect(byDate("2025-11-13", ref(["kicker"])).status).toBe("enacted");
  });

  it("is pending while the executive is drafted, and links its file instead of the portal", () => {
    const e = byDate("2026-10-08", ref([]));
    expect(e.status).toBe("pending");
    expect(e.vote?.url).toBe("https://github.com/sky-ecosystem/executive-votes/blob/main/2026/executive-vote-2026-10-08.md");
  });

  it("reports no vote inside the record's span, and not-covered outside it", () => {
    expect(byDate("2026-08-13", ref([])).status).toBe("no-vote");
    expect(byDate("2026-10-09", ref([])).status).toBe("not-covered"); // after the last executive
    expect(byDate("2025-01-01", ref([])).status).toBe("not-covered");
  });
});

describe("other claims, through uuid links", () => {
  it("credits an executive linking the document or a parent up to two levels", () => {
    expect(byLink("doc-linked", "2026-06-01")).toMatchObject({ status: "enacted", via: "link", vote: { date: "2026-07-02" } });
    expect(byLink("grandchild", "2026-06-01").status).toBe("enacted");
    expect(byLink("great-grandchild", "2026-06-01").status).toBe("unlinked");
  });

  it("stays inside the link window", () => {
    expect(byLink("doc-linked", "2026-07-02").status).toBe("enacted");
    const tooEarly = new Date(Date.parse("2026-07-02") - (LINK_WINDOW.after + 1) * 86_400_000).toISOString().slice(0, 10);
    expect(byLink("doc-linked", tooEarly).status).toBe("unlinked");
  });

  it("counts a passed poll as authorisation, never a failed one", () => {
    expect(byLink("doc-poll", "2026-04-01")).toMatchObject({ status: "authorised", vote: { kind: "poll", offsetDays: 26 } });
    expect(byLink("doc-failed", "2026-04-01").status).toBe("unlinked");
  });

  it("never links through a Scope or Article", () => {
    expect(byLink("orphan", "2026-06-01").status).toBe("unlinked");
  });
});

describe("buildVoteIndex", () => {
  it("spans the executives' filename dates", () => {
    expect(index.first).toBe("2025-10-06");
    expect(index.last).toBe("2026-10-08");
  });

  it("handles an empty record", () => {
    const empty = buildVoteIndex({ ...artifact, executives: [], polls: [] });
    expect(empty).toMatchObject({ first: "", last: "" });
  });
});

// Pins the matcher's behaviour on the live atlas. The Osero transfer is
// flagged subject-missing because the March 26, 2026 executive names the agent
// by its earlier name, Launch Agent 6: a known false alarm of name matching
// (docs/plans/vote-matching.md §10), which the worker's Jev judgment overrules
// (./overlay.ts). A rules fix that recognises renamed agents updates this test.
// Skipped when either artifact is missing (votes.json is gitignored and built
// by `pnpm votes:sync`).
const ROOT = path.resolve(__dirname, "../../..");
const votesPath = path.join(ROOT, "public/votes.json");
const docsPath = path.join(ROOT, "public/docs.json");
const live = fs.existsSync(votesPath) && fs.existsSync(docsPath);

describe.skipIf(!live)("against the built atlas and vote record", () => {
  it("flags the renamed Osero transfer and confirms its siblings", () => {
    const liveDocs: Record<string, AtlasNode> = JSON.parse(fs.readFileSync(docsPath, "utf8")).nodes;
    const votes = buildVoteIndex(JSON.parse(fs.readFileSync(votesPath, "utf8")));
    const report = buildStaleDatesReport(liveDocs, new Date("2026-10-07T12:00:00Z"), votes);
    const claims = [...report.stale, ...report.dueSoon, ...report.upcoming, ...report.recorded];
    // Keyed by uuid prefix: A.2.8.2.6.2.2.2.2 (Osero), A.2.8.2.8.2.1 (Amatsu), A.2.8.2.9.2.1 (Ozone).
    const statusOf = (prefix: string) =>
      claims.find((c) => c.docId.startsWith(prefix) && c.dateISO === "2026-03-26")?.voteEvidence?.status;
    const osero = statusOf("65638659");
    if (osero === undefined) return; // the sentence has since been rewritten
    expect(osero).toBe("subject-missing");
    for (const sibling of ["ff5c1b0c", "ee64a5b7"]) expect(statusOf(sibling) ?? "enacted").toBe("enacted");
  });
});
