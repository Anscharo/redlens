// The PAU history's evidence: the deployments a value sits on, Operator keys,
// a chain's measured landing lag, governance queued for a deployment, and the
// spells that changed it.
import { describe, expect, it } from "vitest";
import { actionSet, check, DEP, snap, spellEntry } from "./pauPending.fixture.ts";
import { DEFAULT_LAG_DAYS, deploymentsOf, landingLag, operatorAdjustable, queuedFor, routeOf, spellSince } from "./pauPendingEvidence.ts";

describe("routes", () => {
  it("is the Operator's where BeamState holds a default for the key, else a relayed spell off Ethereum", () => {
    expect(routeOf(check("mismatch"), [snap(true)])).toBe("operator");
    expect(routeOf(check("mismatch"), [snap()])).toBe("relayed");
    expect(routeOf(check("mismatch", "2026-07-01", { chain: "ethereum" }), [])).toBe("spell");
    expect(operatorAdjustable(check("mismatch", "2026-07-01", { key: "0xother" }), [snap(true)])).toBe(false);
  });
  it("takes every deployment on the chain for a value no contract holds", () => {
    expect(deploymentsOf(check("not-set", "2026-07-01", { kind: null, contract: null }), [snap()]).map((s) => s.deployment)).toEqual([DEP]);
    expect(deploymentsOf(check("mismatch", "2026-07-01", { kind: "diamond" }), [snap()])).toEqual([]);
  });
});

describe("landingLag", () => {
  it("measures the longest of the chain's latest spell changes from their executive, else the default", () => {
    expect(landingLag([spellEntry("2026-06-04", "2026-06-09"), spellEntry("2026-06-18", "2026-06-29")], "base")).toBe(11);
    expect(landingLag([spellEntry("2026-06-04", "2026-06-09")], "ethereum")).toBe(DEFAULT_LAG_DAYS);
  });
});

describe("queuedFor", () => {
  it("keeps action sets queued since the change on an Executor that administers the deployment", () => {
    const steps = [actionSet("2026-11-01", "2026-11-03"), actionSet("2026-11-01", null, "0xstranger"), actionSet("2026-09-01", "2026-09-03")];
    expect(queuedFor(steps, [snap()], "2026-10-15").map((q) => q.contract)).toEqual(["0xex"]);
  });
  it("keeps a star spell plotted on the prime's StarGuard", () => {
    const plotted = { ...actionSet("2026-11-01", "2026-12-01"), kind: "star-spell" as const, chain: "ethereum", primes: ["spark"] };
    expect(queuedFor([plotted, { ...plotted, primes: ["grove"] }], [snap()], "2026-10-15")).toHaveLength(1);
  });
});

describe("spellSince", () => {
  it("finds the latest spell change to the deployment whose executive is dated on or after the date", () => {
    const entries = [spellEntry("2026-08-06", "2026-08-10"), spellEntry("2026-09-03", "2026-09-08"), spellEntry("2026-10-01", "2026-10-05", ["grove:base:monolithic"])];
    expect(spellSince(entries, [snap()], "2026-08-01")?.executive?.date).toBe("2026-09-03");
    expect(spellSince(entries, [snap()], "2026-09-10")).toBeNull();
  });
});
