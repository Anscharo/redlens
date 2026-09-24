import { describe, expect, it } from "bun:test";
import { splitQuestionParts } from "./question-parts.ts";

// The multi-part questions of the 2026-09-22 research corpus, with the split
// the measurement was taken on. A change here moves which parts get a Noul,
// which invalidates the per-part threshold in answer-coverage.ts.
const CORPUS: [string, string[]][] = [
  ["How does Atlas Axis team relate to Redline and Soter? Is there a hierarchy implied?", ["How does Atlas Axis team relate to Redline and Soter", "Is there a hierarchy implied"]],
  ["What is the standard Distribution Reward rate, and is there a boosted rate?", ["What is the standard Distribution Reward rate", "is there a boosted rate"]],
  ["Which agents are Pioneers, for which chains, and when did they gain that status?", ["Which agents are Pioneers", "for which chains", "when did they gain that status"]],
  [
    "What Scopes does the Atlas define, and what does each one govern? Name one key responsibility per Scope.",
    ["What Scopes does the Atlas define", "what does each one govern", "Name one key responsibility per Scope"],
  ],
  [
    "What are all of the organizations recognized by the Atlas and what are their relationships to each other?",
    ["What are all of the organizations recognized by the Atlas", "what are their relationships to each other"],
  ],
  [
    "How are primitives structured? Which ones are always defined for an agent, which are optional? Generate a report.",
    ["How are primitives structured", "Which ones are always defined for an agent", "which are optional", "Generate a report"],
  ],
  ["Which agents have paid distribution rewards out and how much?", ["Which agents have paid distribution rewards out", "how much"]],
  [
    "Find all of the token transfers documented in the Atlas and give me a ledger of who sent what, how much and when.",
    ["Find all of the token transfers documented in the Atlas and give me a ledger of who sent what", "how much", "when"],
  ],
];

describe("splitQuestionParts", () => {
  it.each(CORPUS)("splits %p as measured", (q, parts) => {
    expect(splitQuestionParts(q)).toEqual(parts);
  });

  it("never splits a noun conjunction", () => {
    expect(splitQuestionParts("How does Keel relate to Redline and Soter?")).toEqual(["How does Keel relate to Redline and Soter"]);
    expect(splitQuestionParts("List the signer counts and thresholds for every multisig.")).toEqual([
      "List the signer counts and thresholds for every multisig",
    ]);
  });

  it("keeps a plain single question as one part, trailing punctuation dropped", () => {
    expect(splitQuestionParts("  what is a scope?  ")).toEqual(["what is a scope"]);
    expect(splitQuestionParts("hi")).toEqual(["hi"]);
  });

  it("splits on a semicolon", () => {
    expect(splitQuestionParts("who approves budgets; who audits them")).toEqual(["who approves budgets", "who audits them"]);
  });

  it("returns [] for an empty or punctuation-only message", () => {
    expect(splitQuestionParts("")).toEqual([]);
    expect(splitQuestionParts(" ?! ")).toEqual([]);
  });

  it("does not split a common abbreviation into a fragment the coverage line would name", () => {
    expect(splitQuestionParts("Which primes, e.g. Spark, have rewards?")).toEqual(["Which primes, e.g. Spark, have rewards"]);
    expect(splitQuestionParts("What changed, i.e. which parameters moved?")).toEqual(["What changed, i.e. which parameters moved"]);
    expect(splitQuestionParts("How does Grove compare vs. Spark on fees?")).toEqual(["How does Grove compare vs. Spark on fees"]);
  });

  it("still splits a real sentence boundary after a period", () => {
    expect(splitQuestionParts("List the primes. Which of them hold a multisig?")).toEqual([
      "List the primes",
      "Which of them hold a multisig",
    ]);
  });
});
