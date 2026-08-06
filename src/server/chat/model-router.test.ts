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

  test("ordinary mid-size questions stay default", () => {
    expect(routeTier("How does the Stability Scope handle collateral onboarding?").tier).toBe("default");
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
