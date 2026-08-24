import { describe, expect, test } from "bun:test";
import { looksComplex } from "./complexity.ts";
import { config } from "../config.ts";

// These run the real on-device embedding — no network, no fixtures. Cases are
// the load-bearing ones from the 180-question bakeoff (`pnpm eval:complexity`):
// the ones that decide whether the lane is safe to have on.
describe("looksComplex", () => {
  test("fires on whole-corpus questions the STRONG regexes do not match", () => {
    // Each avoids every trigger in model-router.ts's STRONG_SIGNALS.
    expect(looksComplex("map out the entities the atlas recognizes")).toBe(true);
    expect(looksComplex("what roles has the atlas defined so far")).toBe(true);
    expect(looksComplex("i want an overview of everything the atlas says about rewards")).toBe(true);
    expect(looksComplex("what kinds of documents does the atlas use and how many of each")).toBe(true);
  });

  test("stands down on a single named subject, however enumerative the wording", () => {
    expect(looksComplex("give me a rundown of the Keel Accord")).toBe(false);
    expect(looksComplex("break down the Emergency Shutdown Module")).toBe(false);
    expect(looksComplex("map out how this single process works")).toBe(false);
    expect(looksComplex("collect the parameters for the SkyLink multisig")).toBe(false);
  });

  test("stands down on small talk", () => {
    expect(looksComplex("hi")).toBe(false);
    expect(looksComplex("thanks, that helped")).toBe(false);
  });

  // CHAT_FACT_SIMILARITY is the shared kill switch for every embedding lane.
  // rankPrototypeSets does NOT check it — this caller owns that, so a
  // regression here would leave the lane running with the switch off.
  test("the shared kill switch disables the lane", () => {
    const prev = config.chatFactSimilarity;
    try {
      (config as { chatFactSimilarity: boolean }).chatFactSimilarity = false;
      expect(looksComplex("map out the entities the atlas recognizes")).toBe(false);
    } finally {
      (config as { chatFactSimilarity: boolean }).chatFactSimilarity = prev;
    }
  });

  test("an explicit margin override is honored — this is how the eval sweeps", () => {
    const q = "give me a rundown of the multisigs in the atlas";
    expect(looksComplex(q, -1)).toBe(true);
    expect(looksComplex(q, 0.99)).toBe(false);
  });

  // Regression guard on the one design decision most likely to be "fixed" by a
  // future reader: every OTHER consumer of this mechanism suppresses on
  // namesAtlasSubject, and adding it here stands the lane down on 18 of 28
  // genuine positives (measured 2026-08-21). Whole-corpus questions are MADE of
  // atlas vocabulary, so naming a subject implies nothing about complexity.
  test("does NOT suppress questions that name real atlas vocabulary", () => {
    expect(looksComplex("what roles has the atlas defined so far")).toBe(true);
    expect(looksComplex("map out the entities the atlas recognizes")).toBe(true);
  });
});
