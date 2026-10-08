// The pure parts of the vote-evidence lane: the questions a decision model is
// asked, the poll prefilter, and the atlas-history key.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import type { Executive, Poll } from "../../lib/votes/types.ts";
import { firstPr, historyHead, pickaxeNeedle, pollForPr, pollsLinkingPr, prOfSubject } from "./history.ts";
import { rankLexically } from "./lexical.ts";
import { claimSentence, documentText, pollCandidates, pollQuestions, pollState, SUBJECT_QUESTIONS, subjectState } from "./requests.ts";

const vote = {
  title: "Exec",
  summary: "s",
  sections: [{ heading: "[Genesis](https://x) Transfers", text: "Transfer 10 million USDS.", authorization: [], proposal: [], atlasRefs: [] }],
} as Pick<Executive, "title" | "summary" | "sections">;

function poll(file: string, date: string, title: string, winner: string | null = "Yes"): Poll {
  return {
    file, date, start: null, end: null, title, summary: title, discussionLink: null, atlasRefs: [], atlasPrs: [],
    portal: winner === null ? null : { pollId: 1, slug: file, multiHash: "", tags: [], winner, numVoters: 1 },
  };
}

describe("claimSentence", () => {
  it("returns the whole sentence around the date, links reduced to text", () => {
    const content = "First one. The [transfer](https://x) to Keel was included in the March 26, 2026 Executive Vote. Next one.";
    const c = { context: "to Keel was included in the March 26, 2026 Executive Vote.", contextBefore: "to Keel was included in the ", raw: "March 26, 2026" };
    expect(claimSentence(content, c)).toBe("The transfer to Keel was included in the March 26, 2026 Executive Vote.");
  });

  it("falls back to the raw date, then to the context", () => {
    expect(claimSentence("Begins on May 1, 2026 for all.", { context: "nope", contextBefore: "", raw: "May 1, 2026" })).toBe("Begins on May 1, 2026 for all.");
    expect(claimSentence("No date here.", { context: "ctx", contextBefore: "", raw: "May 1, 2026" })).toBe("ctx");
  });

  it("reduces a document to its words", () => {
    expect(documentText("See [the doc](x)\n\n  now.")).toBe("See the doc now.");
  });
});

describe("questions", () => {
  it("sends section text with link markup stripped from headings, and asks anchor and carried", () => {
    const state = subjectState({ title: "T", date: "2026-03-26", sentence: "S.", documentText: "d", vote });
    expect(state.executive_vote.sections[0].heading).toBe("Genesis Transfers");
    expect(state.claim.vote_date_named).toBe("2026-03-26");
    expect(Object.keys(SUBJECT_QUESTIONS)).toEqual(["anchor", "carried"]);
  });

  it("asks one poll Noul per candidate, by position", () => {
    const candidates = ["a", "b"].map((f, i) => ({ id: `p${i}`, file: f, date: "2025-11-24", title: f, body: "b" }));
    const q = pollQuestions({ title: "T", date: "2026-01-01", sentence: "S.", candidates });
    expect(Object.keys(q)).toEqual(["p0", "p1"]);
    expect(String(q.p1.instructions)).toContain("`polls[1]`");
    expect(pollState({ title: "T", date: "2026-01-01", sentence: "S.", candidates }).polls).toHaveLength(2);
  });
});

describe("pollCandidates", () => {
  it("keeps passed polls inside the window, most similar first, cut to k", () => {
    const polls = [
      poll("a.md", "2025-12-01", "weekly cycle edits"),
      poll("b.md", "2025-12-02", "subsidized borrowing for spark"),
      poll("c.md", "2025-12-03", "subsidized borrowing rejected", "No"),
      poll("d.md", "2024-01-01", "subsidized borrowing long ago"),
    ];
    const claim = { title: "Spark", date: "2026-01-01", sentence: "Subsidized borrowing begins January 1, 2026." };
    const { candidates, windowFiles } = pollCandidates(claim, polls, new Map([["b.md", "full body"]]), 1);
    expect(windowFiles).toEqual(["a.md", "b.md"]);
    expect(candidates).toEqual([{ id: "p0", file: "b.md", date: "2025-12-02", title: "subsidized borrowing for spark", body: "full body" }]);
  });

  it("ranks the document sharing the rare words first", () => {
    const docs = ["weekly cycle edits for spark", "trigger subsidized borrowing for spark and grove as of january", "weekly cycle edits for grove"];
    expect(rankLexically("subsidized borrowing beginning january", docs)[0]).toBe(1);
  });
});

describe("atlas history key", () => {
  it("builds a pickaxe needle from the words before the date, cut at markdown", () => {
    expect(pickaxeNeedle({ contextBefore: "subsidized rate for an initial period of 2 years, beginning ", raw: "January 1, 2026" })).toBe(
      "eriod of 2 years, beginning January 1, 2026",
    );
    expect(pickaxeNeedle({ contextBefore: "see [the doc](x) effective ", raw: "May 20, 2026" })).toBe("effective May 20, 2026");
  });

  it("reads a squash-merge PR number and finds the earliest poll linking it", () => {
    expect(prOfSubject("Nov 24 Atlas edit (#121)")).toBe(121);
    expect(prOfSubject("Merge branch main")).toBeNull();
    const bodies = new Map([
      ["b.md", "see https://github.com/sky-ecosystem/next-gen-atlas/pull/121"],
      ["a.md", "rerun of https://github.com/sky-ecosystem/next-gen-atlas/pull/121"],
      ["c.md", "see https://github.com/sky-ecosystem/next-gen-atlas/pull/1210"],
    ]);
    expect(pollsLinkingPr(121, bodies)).toEqual(["b.md", "a.md"]);
    expect(pollForPr(121, bodies)).toBe("a.md");
    expect(pollForPr(null, bodies)).toBeNull();
    expect(pollForPr(7, bodies)).toBeNull();
  });

  it("reports no history for a directory that is not a repository, and fails loud on a search there", async () => {
    expect(await historyHead("/nonexistent-dir")).toBeNull();
    await expect(firstPr("x", "/nonexistent-dir")).rejects.toThrow();
  });

  it("refuses a shallow clone however deep, and finds the first writer in a full one", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vote-history-"));
    const full = path.join(root, "full");
    const sh = (args: string[], cwd = full) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, stdio: "ignore" });
    fs.mkdirSync(full);
    sh(["init", "-q"]);
    sh(["config", "user.email", "t@t"]);
    sh(["config", "user.name", "t"]);
    fs.writeFileSync(path.join(full, "a.md"), "-begins May 1, 2026\n");
    sh(["add", "."]);
    sh(["commit", "-qm", "Atlas edit (#7)"]);
    fs.writeFileSync(path.join(full, "b.md"), "other\n");
    sh(["add", "."]);
    sh(["commit", "-qm", "Later edit (#8)"]);
    sh(["clone", "-q", "--depth", "1", `file://${full}`, "shallow"], root);
    expect(await historyHead(full, 2)).toMatch(/^[0-9a-f]{40}$/);
    expect(await historyHead(full, 3)).toBeNull();
    expect(await historyHead(path.join(root, "shallow"), 1)).toBeNull();
    expect(await firstPr("-begins May 1, 2026", full)).toBe(7);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
