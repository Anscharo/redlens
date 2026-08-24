import { describe, expect, test } from "bun:test";
import { routeTier, resolveTierModels, citationStyleFor } from "./model-router.ts";
import { config } from "../config.ts";

describe("routeTier", () => {
  test("short single-entity lookup on a first turn is fast", () => {
    expect(routeTier("What is the Accessibility Scope?")).toEqual({ tier: "fast", reason: "lookup" });
    expect(routeTier("define Ecosystem Actor")).toEqual({ tier: "fast", reason: "lookup" });
  });

  test("a doc reference is fast even without a lookup opener", () => {
    expect(routeTier("summarize A.1.2 for me").tier).toBe("fast");
    expect(routeTier("summarize A.1.2 for me").reason).toBe("doc-ref");
    expect(routeTier("open 4d40be55-c2b1-4c26-8f36-1aa16bd0a204").reason).toBe("doc-ref");
    expect(routeTier("open the doc about 4d40be55-c2b1")).toEqual({ tier: "default", reason: "default" });
  });

  test("terse follow-ups without a doc reference stay default", () => {
    expect(routeTier("what is the Stability Scope?", { followUp: true }).tier).toBe("default");
    // …but an explicit doc reference still earns the fast tier on a follow-up.
    expect(routeTier("and A.2.3?", { followUp: true }).tier).toBe("fast");
  });

  test("comparison / interaction / analysis questions route strong", () => {
    expect(routeTier("What is the difference between the Stability and Support Scopes?").reason).toBe("comparison");
    expect(routeTier("Does the budget rule conflict with the facilitator mandate?").reason).toBe("interaction");
    expect(routeTier("What are the implications of suspending an executor?").reason).toBe("analysis");
  });

  test("governance-risk wording routes strong", () => {
    expect(routeTier("Is a facilitator allowed to approve their own budget?").reason).toBe("governance-risk");
    expect(routeTier("Who is eligible for alignment rewards?").reason).toBe("governance-risk");
  });

  test("multi-part and long-form questions route strong", () => {
    expect(routeTier("What is a Scope? And who maintains them?").reason).toBe("multi-part");
    expect(routeTier(`Walk me through ${"the governance process ".repeat(20)}`).reason).toBe("long-form");
  });

  // Enumeration was the one STRONG signal with no test, and it was nearly dead:
  // it required an "all … that/which/who" construction the real corpus does not
  // use. These are the shapes that actually appear.
  test("exhaustive-set questions route strong", () => {
    expect(routeTier("What are all of the roles and positions designated by the Atlas?").reason).toBe("enumeration");
    expect(routeTier("Who are all of the individuals noted by the Atlas?").reason).toBe("enumeration");
    expect(routeTier("Look at all the multisigs and assess them.").reason).toBe("enumeration");
    // The relative-pronoun shape still works, and its window now reaches a
    // pronoun 72 characters out — this exact question used to route FAST,
    // handing the cheapest tier a whole-corpus ledger request.
    expect(routeTier("Find all of the token transfers documented in the Atlas and give me a ledger of who sent what, how much and when.").tier).toBe("strong");
  });

  // "all" in an idiom is not a request to enumerate anything. Requiring a
  // determiner after it is what keeps these on the cheap path.
  test("idiomatic 'all' does not route strong", () => {
    expect(routeTier("is that all?").tier).toBe("default");
    expect(routeTier("all good, thanks").tier).toBe("default");
    expect(routeTier("tell me all about the Keel Accord").tier).not.toBe("strong");
  });

  // Corpus-wide synthesis — build a new artifact from many documents. Measured
  // 2026-08-21: every question the strong tier won was enumeration or
  // generation (docs/chat-system.md §6.5).
  test("synthesis and generation questions route strong", () => {
    expect(routeTier("Generate a timeline of major edits to the Atlas over the past 2 years").reason).toBe("synthesis");
    expect(routeTier("Generate 10 did-you-know blurbs about the Atlas").reason).toBe("synthesis");
    expect(routeTier("What trends do you notice over the history of the Atlas?").reason).toBe("synthesis");
  });

  test("extremum questions route strong", () => {
    expect(routeTier("What is the oldest rate limit id in the atlas.").reason).toBe("extremum");
    expect(routeTier("Which Rate Limit was first-seen?").reason).toBe("extremum");
    expect(routeTier("What is the newest Action Tenet?").reason).toBe("extremum");
  });

  test("ordinary mid-size questions stay default", () => {
    expect(routeTier("How does the Stability Scope handle collateral onboarding?").tier).toBe("default");
  });

  // Second lane. The regexes are high-precision and low-recall — measured 0 of
  // 28 natural paraphrases — so the embedding is what makes the STRONG tier
  // reachable by questions phrased in words nobody anticipated. Its own reason
  // string, so chat_route_reason meters the lane's fire rate in PostHog.
  test("the similarity lane routes strong with its own reason", () => {
    expect(routeTier("map out the entities the atlas recognizes")).toEqual({ tier: "strong", reason: "similarity" });
    expect(routeTier("what roles has the atlas defined so far").reason).toBe("similarity");
  });

  // The lane sits ABOVE the fast check on purpose: whole-corpus questions are
  // often short and lookup-shaped, so a lane placed below it would lose exactly
  // the turns it exists to catch.
  test("the similarity lane outranks the fast tier", () => {
    const r = routeTier("show me the full set of entities the atlas recognizes");
    expect(r.tier).not.toBe("fast");
  });

  // Deterministic signals still win, so telemetry keeps attributing a turn to
  // the cheapest explanation that fired.
  test("a regex signal keeps its own reason rather than the lane's", () => {
    expect(routeTier("What are all of the roles and positions designated by the Atlas?").reason).toBe("enumeration");
  });

  // Corpus-level regression. The router's job is to catch the questions the
  // strong tier measurably wins; the bakeoff set is the only place we know
  // which those are. A hard, whole-corpus question landing on `fast` is the
  // failure this guards — harmless while CHAT_MODEL_FAST is unset (fast then
  // inherits the default chain), a real downgrade the moment it is set.
  test("no known-hard bakeoff question routes to the cheapest tier", async () => {
    const { BAKEOFF_QUERIES } = await import("../../../scripts/eval/eval-bakeoff-queries.ts");
    const fast = BAKEOFF_QUERIES.filter((q) => routeTier(q.query).tier === "fast");
    expect(fast.map((q) => q.id)).toEqual([]);
    const strong = BAKEOFF_QUERIES.filter((q) => routeTier(q.query).tier === "strong");
    expect(strong.length).toBeGreaterThanOrEqual(11);
  });
});

describe("resolveTierModels", () => {
  test("unset tier slots inherit the default chain; set slots win", () => {
    const saved = {
      chatModel: config.chatModel,
      chatModelFast: config.chatModelFast,
      chatModelStrong: config.chatModelStrong,
      chatModelFallbacks: config.chatModelFallbacks,
    };
    try {
      config.chatModel = "m/default";
      config.chatModelFast = [];
      config.chatModelStrong = ["m/strong", "m/strong-fallback"];
      config.chatModelFallbacks = ["m/default-fallback"];
      expect(resolveTierModels("fast")).toEqual(["m/default", "m/default-fallback"]);
      expect(resolveTierModels("default")).toEqual(["m/default", "m/default-fallback"]);
      expect(resolveTierModels("strong")).toEqual(["m/strong", "m/strong-fallback"]);
    } finally {
      Object.assign(config, saved);
    }
  });
});

describe("citationStyleFor", () => {
  test("only allowlisted models are asked for reference style; everything else is inline", () => {
    const saved = config.chatReferenceCitationModels;
    try {
      config.chatReferenceCitationModels = ["m/strong"];
      expect(citationStyleFor("m/strong")).toBe("reference");
      expect(citationStyleFor("m/default")).toBe("inline");
      // Unconfigured (no strong tier, no override) means inline for everyone —
      // the format every measured model follows.
      config.chatReferenceCitationModels = [];
      expect(citationStyleFor("m/strong")).toBe("inline");
    } finally {
      config.chatReferenceCitationModels = saved;
    }
  });
});
