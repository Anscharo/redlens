// The PAU evidence a named spell is checked against: the deployments a value
// sits on, Operator keys, whether the spell set the key, and a relay queued on
// the deployment's Executor.
import { describe, expect, it } from "vitest";
import { actionSet, check, DEP, snap, spellEntry } from "./pauPending.fixture.ts";
import { deploymentsOf, keySetBy, operatorAdjustable, queuedRelay } from "./pauPendingEvidence.ts";

describe("deployments and Operator keys", () => {
  it("takes every deployment on the chain for a value no contract holds", () => {
    expect(deploymentsOf(check("not-set", "2026-07-01", { kind: null, contract: null }), [snap()]).map((s) => s.deployment)).toEqual([DEP]);
    expect(deploymentsOf(check("mismatch", "2026-07-01", { kind: "diamond" }), [snap()])).toEqual([]);
  });
  it("is the Operator's where BeamState holds a default for the key", () => {
    expect(operatorAdjustable(check("mismatch"), [snap(true)])).toBe(true);
    expect(operatorAdjustable(check("mismatch"), [snap()])).toBe(false);
  });
});

describe("keySetBy", () => {
  it("finds the spell's change to the key on the contract holding it", () => {
    const pau = { entries: [spellEntry("0xspell", "2026-11-08", "0xother"), spellEntry("0xspell", "2026-11-09", "0xK"), spellEntry("0xelse", "2026-11-10", "0xk")], queued: [] };
    expect(keySetBy(pau, "0xSPELL", check("mismatch"))?.tx).toBe("0x2026-11-09");
    expect(keySetBy({ ...pau, entries: pau.entries.slice(0, 1) }, "0xspell", check("mismatch"))).toBeNull();
  });
});

describe("queuedRelay", () => {
  it("finds an action set queued since the date on an Executor administering the deployment", () => {
    const steps = [actionSet("2026-09-01", "2026-09-03"), actionSet("2026-11-01", null, "0xstranger"), actionSet("2026-11-02", "2026-11-04")];
    expect(queuedRelay(steps, [snap()], "2026-10-15")?.time).toBe("2026-11-02T00:00:00Z");
    expect(queuedRelay(steps.slice(0, 2), [snap()], "2026-10-15")).toBeNull();
  });
});
