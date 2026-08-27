// facts/features.ts: when the product-documentation fact fires, and what it
// injects. Reads the real FEATURE_GROUPS — the same data /features renders —
// so a drift in the guide shows up here.
import { describe, it, expect } from "bun:test";
import { featuresFact, matchesFeaturesQuestion } from "./features.ts";
import { FEATURE_GROUPS } from "../../lib/featuresData.ts";
import type { Indexes } from "../retrieval/indexes.ts";

const ix = {} as Indexes; // this fact reads no atlas data

function block(question: string, page?: { path?: string }) {
  const b = featuresFact.run({ ix, question, page });
  return b ? (b.value as {
    vocabulary: Record<string, string>;
    chat: { what_i_am: string; i_can: string[]; i_cannot: string[] };
    app: { area: string; where: string | null; about: string; available?: boolean; features: { name: string; how?: string[] }[] }[];
  }) : null;
}

describe("features fact triggers", () => {
  it("fires on the ways people actually ask", () => {
    for (const q of [
      "what can i do with redline sky atlas?",
      "what capabilities exist?",
      "tell me about the features of the app",
      "what can you do?",
      "what is redlens?",
      "what is sabr?",
      "how do i get started with the app?",
      "what are you capable of?",
      // The how-to half — what the `how` steps are for.
      "how do i export a csv from reports?",
      "can i download the multisig table?",
      "where is the keyboard shortcut list?",
    ]) {
      expect(matchesFeaturesQuestion(q)).toBe(true);
    }
  });

  // The canonical negative: capability vocabulary pointed at atlas content, and
  // governance questions that borrow the "what can I do" shape.
  it("stays out of atlas questions that borrow the same words", () => {
    for (const q of [
      "what are the features of the Stability Scope?",
      "what can i do to become a facilitator?",
      "what can i do about an unresolved dispute?",
      // DIRECT[0] used to fire on any "with" — these are governance questions.
      "what can i do with the Stability Scope?",
      "what can I do with a surplus buffer?",
      "what can I do with SKY tokens?",
      "what can I do with this document?",
      "what can I do with a facilitator?",
      "how do i find the stability rate?", // how-to shape, atlas object
      "where is the Keel Accord defined?",
      "who is keel?",
      "completely unrelated question about nothing",
    ]) {
      expect(matchesFeaturesQuestion(q)).toBe(false);
    }
  });

  it("still treats 'what can I do with <app thing>' as a product question", () => {
    for (const q of [
      "what can i do with redline sky atlas?",
      "what can i do with this app?",
      "what can i do with reports and csv export?",
    ]) {
      expect(matchesFeaturesQuestion(q)).toBe(true);
    }
  });

  it("also fires from the features page itself, for a question that names nothing", () => {
    expect(featuresFact.run({ ix, question: "what does this cover?" })).toBeNull();
    expect(featuresFact.run({ ix, question: "what does this cover?", page: { path: "/features" } })).not.toBeNull();
  });
});

describe("features fact payload", () => {
  it("separates what the chat can do from what the app can do", () => {
    const v = block("what can you do?")!;
    expect(v.chat.i_can.length).toBeGreaterThan(0);
    expect(v.chat.i_cannot.join(" ")).toContain("Change anything");
    expect(v.app.map((a) => a.area)).toEqual(FEATURE_GROUPS.map((g) => g.title));
    expect(v.app.every((a) => a.about.length > 0)).toBe(true);
  });

  it("names the atlas / our-extraction distinction", () => {
    const v = block("what capabilities exist?")!;
    expect(v.vocabulary.the_atlas).toContain("Sky Atlas");
    expect(v.vocabulary.our_extraction).toContain("not atlas text");
  });

  it("marks the not-yet-shipped areas unavailable", () => {
    const v = block("what can this app do?")!;
    const upcoming = FEATURE_GROUPS.findIndex((g) => g.key === "upcoming");
    expect(upcoming).toBeGreaterThanOrEqual(0); // guide still has the group this keys on
    expect(v.app[upcoming].available).toBe(false);
    expect(v.app.filter((a) => a.available === false)).toHaveLength(1);
  });

  it("ships breadth for every area, and step-by-step how only for the areas asked about", () => {
    const v = block("what can i do with reports and csv export?")!;
    const withHow = v.app.filter((a) => a.features.some((f) => f.how));
    expect(withHow.map((a) => a.area)).toEqual(["Reports"]);
    expect(withHow[0].features[0].how!.length).toBeGreaterThan(0);
  });

  it("caps how-step detail at three areas for a question that names many", () => {
    const v = block("what can i do — search, reports, radar, preview, mcp, collections?")!;
    expect(v.app.filter((a) => a.features.some((f) => f.how))).toHaveLength(3);
  });

  it("carries the note that keeps app docs out of atlas citations", () => {
    const b = featuresFact.run({ ix, question: "what can you do?" })!;
    expect(b.note).toContain("NOT atlas text");
    expect(b.note).toContain("citation definition block");
  });
});
