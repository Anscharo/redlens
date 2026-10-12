// AdministeredAgent membership read live: the chain's list wins over the
// replay, a failed read is null and never false, and a member the history
// lacks is added and reported as missed.
import { describe, expect, it } from "bun:test";
import type { AgentMember } from "../../lib/pau.ts";
import { liveAgent } from "./agent-live.ts";
import type { ChainCall } from "./snapshot.ts";

const since = { block: 1, time: "2026-01-01T00:00:00Z", tx: "0xtx" };
const m = (account: string): AgentMember => ({ account, since });

/** A fake AdministeredAgent: each kind's live list; `fail` names function names whose calls fail. */
function agentReader(sets: Record<string, string[]>, fail: string[] = []) {
  const kind = (fn: string) => /(Actor|Admin|Grantor|Revoker)/i.exec(fn)![1].toLowerCase() + "s";
  return async (_chain: string, calls: ChainCall[]) =>
    calls.map((c) => {
      const fn = c.functionName as string;
      if (fail.includes(fn)) return null;
      const list = sets[kind(fn)] ?? [];
      if (fn.endsWith("Count")) return BigInt(list.length);
      if (fn.startsWith("getIs")) return list.includes(String(c.args[0]));
      return list[Number(c.args[0])] ?? null;
    });
}

describe("liveAgent", () => {
  it("confirms replayed members the chain lists and sorts them", async () => {
    const read = agentReader({ actors: ["0xb", "0xa"], admins: ["0xc"] });
    const { agent, missed } = await liveAgent(read, "ethereum", "0xaa", { actors: [m("0xb"), m("0xa")], admins: [m("0xc")] });
    expect(missed).toBe(false);
    expect(agent).toEqual({ actors: [{ ...m("0xa"), holds: true }, { ...m("0xb"), holds: true }], admins: [{ ...m("0xc"), holds: true }] });
  });

  it("marks a replayed member the chain no longer lists as not holding", async () => {
    const { agent } = await liveAgent(agentReader({ actors: [] }), "ethereum", "0xaa", { actors: [m("0xa")] });
    expect(agent.actors).toEqual([{ ...m("0xa"), holds: false }]);
  });

  it("adds a member the history lacks, with no since, and reports it missed", async () => {
    const { agent, missed } = await liveAgent(agentReader({ revokers: ["0xf"] }), "ethereum", "0xaa", {});
    expect(missed).toBe(true);
    expect(agent).toEqual({ revokers: [{ account: "0xf", since: null, holds: true }] });
  });

  it("leaves a member unread, never false, when every read fails", async () => {
    const read = agentReader({ actors: ["0xa"] }, ["actorCount", "getActor", "getIsActor"]);
    const { agent, missed } = await liveAgent(read, "ethereum", "0xaa", { actors: [m("0xa")] });
    expect(agent.actors).toEqual([{ ...m("0xa"), holds: null }]);
    expect(missed).toBe(false);
  });

  it("falls back to the full list when the membership check fails", async () => {
    const read = agentReader({ actors: ["0xa"] }, ["getIsActor"]);
    const { agent } = await liveAgent(read, "ethereum", "0xaa", { actors: [m("0xa"), m("0xb")] });
    expect(agent.actors?.map((x) => x.holds)).toEqual([true, false]);
  });

  it("does not trust a list with an unreadable index", async () => {
    const read = agentReader({ actors: ["0xa", "0xb"] }, ["getActor", "getIsActor"]);
    const { agent, missed } = await liveAgent(read, "ethereum", "0xaa", { actors: [m("0xa")] });
    expect(agent.actors).toEqual([{ ...m("0xa"), holds: null }]);
    expect(missed).toBe(false);
  });

  it("compares accounts without regard to case", async () => {
    const { agent, missed } = await liveAgent(agentReader({ actors: ["0xab"] }, ["getIsActor"]), "ethereum", "0xaa", { actors: [m("0xAB")] });
    expect(missed).toBe(false);
    expect(agent.actors).toEqual([{ ...m("0xAB"), holds: true }]);
  });
});
