// The Radar change-history grouping: a spell's changes across chains form one
// group, a deployment's setup collapses into its Deployment group, a later
// direct call stands alone, and the chips say what made each change.
import { describe, expect, it } from "vitest";
import type { PauHistoryEntry, PauOrigin } from "./pauHistory.ts";
import { entryOf, spellEffects } from "./pauHistory.ts";
import { chipText, routeText } from "./pauOriginText.ts";
import { timelineFor } from "./pauTimeline.ts";

const P = "prime";
const D = `${P}:ethereum:diamond`;
const o = (x: Partial<PauOrigin>): PauOrigin => ({ kind: "unknown", path: null, spell: null, starSpell: null, l1Tx: null, from: null, to: null, relay: null, evidence: "e", ...x });
const entry = (tx: string, time: string, origin: PauOrigin | null, chain = "ethereum", dep = D): PauHistoryEntry => ({
  chain, tx, block: 1, time, primes: [P], origin, executive: origin?.spell ? { title: "T", date: "2026-04-09", url: "u", source: "vote-record" } : null,
  changes: [{ deployments: [dep], contract: "0xrl", role: "rateLimits", event: "RateLimitDataSet", args: {}, subject: "0xk", label: null, before: null }],
});

const res = {
  entries: [
    entry("0x1", "2026-01-01", o({ kind: "deployment", from: "0xd" })),
    entry("0x2", "2026-01-02", o({ kind: "direct", from: "0xd", to: "0xrl" })),
    entry("0x3", "2026-04-13", o({ kind: "spell", path: "starguard", spell: "0xs" })),
    entry("0x4", "2026-04-13T01", o({ kind: "spell", path: "arbitrum", spell: "0xs", relay: { executor: "0xe", actionsSet: 6 } }), "arbitrum", `${P}:arbitrum:monolithic`),
    entry("0x5", "2026-05-01", o({ kind: "direct", from: "0xf", to: "0xrl" })),
    entry("0x6", "2026-06-01", o({ kind: "relayed", relay: { executor: "0xe", actionsSet: 7 } }), "arbitrum", `${P}:arbitrum:monolithic`),
    entry("0x7", "2026-06-02", o({ kind: "operator", to: "0xsafe" })),
    entry("0x8", "2026-06-03", o({ kind: "operator", to: "0xsafe" })),
  ],
};

describe("timelineFor", () => {
  it("groups a spell across chains and an operator's run, folds setup into Deployment, and keeps a later direct call apart", () => {
    const groups = timelineFor(res, P);
    expect(groups.map((g) => [g.kind, g.entries.map((e) => e.tx)])).toEqual([
      ["operator", ["0x7", "0x8"]],
      ["relayed", ["0x6"]],
      ["direct", ["0x5"]],
      ["executive", ["0x3", "0x4"]],
      ["deployment", ["0x1", "0x2"]],
    ]);
    expect(timelineFor(res, "other")).toEqual([]);
  });
});

describe("origin words", () => {
  it("names the executive, the relay, or the bare spell", () => {
    expect(chipText(res.entries[2])).toBe("exec 2026-04-09");
    expect(chipText(res.entries[5])).toBe("relayed · set 7");
    expect(chipText({ ...res.entries[2], executive: { title: null, date: null, url: null, source: null } })).toBe("spell 0xs…0xs");
    expect(routeText(res.entries[3].origin, "arbitrum")).toBe("relayed to Arbitrum action set 6 (Arbitrum retryable id proven)");
    expect(routeText(null, "ethereum")).toBe("origin not resolved yet");
    expect(routeText(o({ kind: "operator" }), "ethereum")).toBe("through the Configurator");
  });
  it("finds a transaction's entry and sums a spell's effects", () => {
    expect(entryOf(res, "arbitrum", "0x4")?.tx).toBe("0x4");
    expect(spellEffects(res, "0xS")).toEqual({ changes: 2, chains: ["ethereum", "arbitrum"], primes: [P] });
  });
});
