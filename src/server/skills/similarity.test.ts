// skills/similarity.ts: the second trigger lane. These are the load-bearing
// cases from the 241-question bakeoff (scripts/eval/eval-skills.ts) pinned as
// tests — the ones that decide whether the lane is safe to have on.
import { describe, it, expect } from "bun:test";
import { looksLikeSkillQuestion, namesAtlasSubject, isSmallTalk } from "./similarity.ts";
import { FEATURES_PROTOTYPES } from "./features.ts";
import { loadIndexes } from "../retrieval/indexes.ts";

const ix = loadIndexes();
const fires = (q: string) => looksLikeSkillQuestion(ix, q, FEATURES_PROTOTYPES);

describe("similarity lane", () => {
  it("catches product questions the regex trigger has no words for", () => {
    for (const q of ["show me around", "what should i try first?", "i'm new here, where do i start?"]) {
      expect(fires(q)).toBe(true);
    }
  });

  it("never fires on small talk, which sits nearest the boundary", () => {
    for (const q of ["hello", "thanks!", "nice", "are you there?", "good morning"]) {
      expect(isSmallTalk(q)).toBe(true);
      expect(fires(q)).toBe(false);
    }
  });

  // The measured failure mode: the embedding scores SHAPE, not subject, so
  // "what are the features of <real atlas doc>" reads as a product question.
  // Naming a real atlas subject is a fact we can check, and it is what keeps
  // the lane's false-fire rate at 1 in 184.
  it("stands down when the question names a real atlas subject", () => {
    const subject = [...ix.docMap.values()].find((d) => d.title.split(/\s+/).length >= 2)!.title;
    expect(namesAtlasSubject(ix, `what are the features of ${subject}?`)).toBe(true);
    expect(fires(`what are the features of ${subject}?`)).toBe(false);
  });

  it("stands down on a question naming a glossary term or an entity", () => {
    expect(fires("what can a facilitator do about a breach?")).toBe(false);
    expect(fires("what capabilities does Spark have?")).toBe(false);
  });

  it("scores nothing without prototypes", () => {
    expect(looksLikeSkillQuestion(ix, "show me around", [])).toBe(false);
  });
});
