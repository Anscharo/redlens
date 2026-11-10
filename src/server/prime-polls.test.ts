// The Prime polls route: every page of the spaces' polls read, the answer
// cached, the last answer served when the hub fails, and 503 until it answered.
import { beforeEach, describe, expect, it } from "bun:test";
import { currentPrimePolls, readPrimePolls, resetPrimePolls } from "./prime-polls.ts";
import type { SnapshotProposal } from "../lib/primePolls.ts";

const proposal = (n: number): SnapshotProposal => ({
  id: `0x${n}`, title: `poll ${n}`, space: { id: "sparkfi.eth" }, end: 1761696000, state: "closed",
  choices: ["For", "Against"], scores: [1, 0], discussion: null, body: `github.com/sky-ecosystem/next-gen-atlas/pull/${n}`,
});

beforeEach(resetPrimePolls);

describe("readPrimePolls", () => {
  it("reads page after page until a short one", async () => {
    const asked: number[] = [];
    const polls = await readPrimePolls(["sparkfi.eth"], async (_s, skip) => {
      asked.push(skip);
      return skip === 0 ? Array.from({ length: 1000 }, (_, i) => proposal(i)) : [proposal(1000)];
    });
    expect(asked).toEqual([0, 1000]);
    expect(polls).toHaveLength(1001);
    expect(polls[1000]).toMatchObject({ id: "0x1000", prs: [1000], passed: true });
  });
});

describe("currentPrimePolls", () => {
  it("is null with no spaces to read and nothing cached", async () => {
    expect(await currentPrimePolls(Date.now(), [])).toBeNull();
  });
});
