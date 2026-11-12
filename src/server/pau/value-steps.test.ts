// The on-chain steps the server works out: each disagreement's step keyed by
// its check, nothing claimed from an input that was not read, and each chain's
// Configurator attached from the registry.
import { describe, expect, it } from "bun:test";
import { check, edit, exec, snap } from "../../lib/pauPending.fixture.ts";
import { valueCheckId } from "../../lib/pauPending.ts";
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import type { VoteIndex } from "../../lib/votes/vote-index.ts";
import { readValueSteps, withConfigurators, type StepDeps } from "./value-steps.ts";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const mismatch = check("mismatch");

function deps(o: Partial<StepDeps> = {}): StepDeps {
  return {
    checks: async () => ({ primes: [{ snaps: [snap()], checks: [mismatch, check("match")] }], docNo: () => null }),
    history: async () => new Map([["d", [edit("2026-10-29", ["2026-11-05"])]]]),
    pau: async () => ({ entries: [], queued: [] }),
    votes: () => ({ executives: [exec("2026-11-05", false)], snapshots: new Map() }) as unknown as VoteIndex,
    openPrs: async () => [],
    polls: async () => [],
    ...o,
  };
}

describe("readValueSteps", () => {
  it("gives each disagreement its step, keyed by its check", async () => {
    const r = await readValueSteps(deps(), NOW);
    expect(r.unread).toEqual([]);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ id: valueCheckId(mismatch), onchain: { kind: "pending", pending: { step: { kind: "uncast" } } } });
  });
  it("claims nothing without the vote record, the PAU history or the documents' history", async () => {
    expect(await readValueSteps(deps({ votes: () => null }), NOW)).toEqual({ steps: [], unread: ["votes"] });
    expect(await readValueSteps(deps({ pau: async () => Promise.reject(new Error("down")) }), NOW)).toEqual({ steps: [], unread: ["pau-history"] });
    expect((await readValueSteps(deps({ history: async () => Promise.reject(new Error("down")) }), NOW)).steps).toEqual([]);
  });
  it("names the open PRs and polls it could not read, and still steps what does not need them", async () => {
    const r = await readValueSteps(deps({ openPrs: async () => null, polls: async () => null }), NOW);
    expect(r.unread.sort()).toEqual(["open-prs", "polls"]);
    expect(r.steps[0].onchain?.kind).toBe("pending");
  });
});

describe("withConfigurators", () => {
  it("puts the chain's Configurator on every BeamState block", () => {
    const reg = { shared: [{ chain: "base", members: [{ role: "configurator", address: "0xconf", provenance: [] }] }] } as unknown as PauRegistry;
    const [s] = withConfigurators([snap(true)], reg);
    expect(s.contracts[0].beam?.configurator).toBe("0xconf");
  });
});
