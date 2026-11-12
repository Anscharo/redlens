// The Prime polls reader: every page read, a settled poll's body read once, one
// refresh at a time served stale while it runs, and a failure held off.
import { beforeEach, describe, expect, it } from "bun:test";
import { currentPrimePolls, readPrimePolls, resetPrimePolls, type HubRead } from "./prime-polls.ts";
import type { SnapshotProposal } from "../lib/primePolls.ts";

const proposal = (n: number, state = "closed"): SnapshotProposal => ({
  id: `0x${n}`, title: `poll ${n}`, space: { id: "sparkfi.eth" }, end: 1761696000, state,
  choices: ["For", "Against"], scores: [1, 0], discussion: null, body: `github.com/sky-ecosystem/next-gen-atlas/pull/${n}`,
});

/** A hub holding `polls`, recording which ids each full read asked for. */
function hub(polls: SnapshotProposal[], asked: string[][] = []): HubRead {
  return (async (query: string, v: Record<string, unknown>) => {
    const skip = Number(v.skip ?? 0);
    if (query.includes("space_in")) return polls.slice(skip, skip + 1000).map((p) => ({ id: p.id, state: p.state }));
    const ids = v.ids as string[];
    if (ids.length > 100) throw new Error("snapshot hub → HTTP 500 (id_in over 100)");
    asked.push(ids);
    return polls.filter((p) => ids.includes(p.id));
  }) as HubRead;
}

beforeEach(resetPrimePolls);

describe("readPrimePolls", () => {
  it("reads page after page, the polls not settled yet in full in batches the hub takes, and only those", async () => {
    const many = Array.from({ length: 1001 }, (_, i) => proposal(i));
    const first = await readPrimePolls(["sparkfi.eth"], new Map(), hub(many));
    expect(first.size).toBe(1001);
    expect(first.get("0x1000")).toMatchObject({ prs: [1000], passed: true });
    const asked: string[][] = [];
    const open = proposal(2000, "active");
    await readPrimePolls(["sparkfi.eth"], first, hub([...many, open], asked));
    expect(asked).toEqual([["0x2000"]]);
  });
});

describe("currentPrimePolls", () => {
  it("is null with no spaces to read and nothing cached", async () => {
    expect(await currentPrimePolls(Date.now(), [])).toBeNull();
  });

  it("serves the last answer while a refresh runs, and holds off after a failure", async () => {
    let calls = 0;
    const ok = hub([proposal(1)]);
    const counting: HubRead = (async (q: string, v: Record<string, unknown>) => (calls++, ok(q, v))) as HubRead;
    expect(await currentPrimePolls(0, ["s"], counting)).toHaveLength(1);
    const failing: HubRead = (async () => {
      calls++;
      throw new Error("down");
    }) as HubRead;
    expect(await currentPrimePolls(11 * 60_000, ["s"], failing)).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    const before = calls;
    expect(await currentPrimePolls(12 * 60_000, ["s"], failing)).toHaveLength(1);
    expect(calls).toBe(before);
  });
});
