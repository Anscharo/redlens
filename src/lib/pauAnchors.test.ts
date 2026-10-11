// PAU page anchors: chains as deployment ids (generation added only when a
// chain has two), sections under them, history groups by origin and date with
// repeats numbered from the oldest, and the aliases a bare name resolves through.
import { describe, expect, it } from "vitest";
import type { PauHistoryEntry } from "./pauHistory.ts";
import { deploymentAnchors, groupAnchors, sectionAnchor } from "./pauAnchors.ts";
import type { TimelineGroup } from "./pauTimeline.ts";

const snap = (chain: string, kind: "monolithic" | "diamond") => ({ deployment: `p:${chain}:${kind}`, chain, kind });
const entry = (chain: string) => ({ chain }) as PauHistoryEntry;
const group = (key: string, kind: TimelineGroup["kind"], time: string, extra: Partial<TimelineGroup> = {}): TimelineGroup => ({
  key, kind, time, spell: null, executive: null, entries: [entry("ethereum")], ...extra,
});
const exec = (spell: string, date: string | null) => ({ spell, executive: { title: date ? "t" : null, date, url: null, source: null } });

describe("deploymentAnchors", () => {
  it("names a deployment by its chain, adding the generation and a chain alias only where the chain has two", () => {
    const a = deploymentAnchors([snap("ethereum", "diamond"), snap("ethereum", "monolithic"), snap("base", "monolithic")]);
    expect([...a.values()]).toEqual([{ id: "ethereum-diamond", aliases: ["ethereum"] }, { id: "ethereum-monolithic", aliases: ["ethereum"] }, { id: "base", aliases: [] }]);
    expect(sectionAnchor(a.get("p:ethereum:diamond")!, "rate-limits")).toEqual({ id: "ethereum-diamond-rate-limits", aliases: ["rate-limits", "ethereum-rate-limits"] });
    expect(sectionAnchor(a.get("p:base:monolithic")!, "roles")).toEqual({ id: "base-roles", aliases: ["roles"] });
  });
});

describe("groupAnchors", () => {
  it("names groups by origin and date, numbers repeats from the oldest, and aliases a titled executive's spell", () => {
    const groups = [
      group("spell:0xB", "executive", "2026-04-10T00:00:00Z", exec("0xB", "2026-04-09")),
      group("spell:0xA", "executive", "2026-04-09T12:00:00Z", exec("0xA", "2026-04-09")),
      group("spell:0xC", "executive", "2026-01-01T00:00:00Z", exec("0xC", null)),
      group("operator:ethereum:0xo:0xt", "operator", "2026-03-02T05:00:00Z"),
      group("unknown:ethereum", "unknown", "2026-05-01T00:00:00Z"),
      group("deployment:p:ethereum:monolithic", "deployment", "2025-01-01T00:00:00Z"),
    ];
    const a = groupAnchors(groups);
    expect(a.get("spell:0xA")).toEqual({ id: "exec-vote-2026-04-09", aliases: ["spell-0xa"] });
    expect(a.get("spell:0xB")).toEqual({ id: "exec-vote-2026-04-09-2", aliases: ["spell-0xb"] });
    expect(a.get("spell:0xC")).toEqual({ id: "spell-0xc", aliases: [] });
    expect([a.get("operator:ethereum:0xo:0xt")!.id, a.get("unknown:ethereum")!.id, a.get("deployment:p:ethereum:monolithic")!.id]).toEqual([
      "operator-ethereum-2026-03-02", "unattributed-ethereum", "deployment-ethereum",
    ]);
  });
});
