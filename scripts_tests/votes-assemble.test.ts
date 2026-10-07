// Portal paging, the repository↔portal join, the floors and the shrink guard
// for `pnpm votes:sync` (scripts/lib/votes/portal.ts, assemble.ts).

import { describe, expect, it } from "vitest";

import { attachPortal, checkFloors, MIN_EXECUTIVES, MIN_POLLS, shrinkage } from "../scripts/lib/votes/assemble.ts";
import { PAGE_SIZE, pollPathFromUrl, readPortal, type FetchJson } from "../scripts/lib/votes/portal.ts";
import type { Executive, Poll, VotesArtifact } from "../scripts/lib/votes/types.ts";

function exec(file: string, address: string | null): Executive {
  return { file, date: file.slice(-13, -3), frontmatterDate: null, outOfSchedule: false, title: "", summary: "", address, sections: [], portal: null };
}

function poll(file: string): Poll {
  return { file, date: "2025-06-02", start: null, end: null, title: "", summary: "", discussionLink: null, atlasRefs: [], portal: null };
}

function artifact(executives: number, polls: number, withPortal = 0): VotesArtifact {
  const portal = { key: "k", date: "", active: false, hasBeenCast: true, datePassed: null, dateExecuted: null };
  const execs = Array.from({ length: executives }, (_, i) => ({ ...exec(`2026/e-${i}.md`, null), portal: i < withPortal ? portal : null }));
  return { sources: { executives: "", polls: "", portal: null }, executives: execs, polls: Array.from({ length: polls }, (_, i) => poll(`2025/p-${i}.md`)) };
}

// A fake portal: `executives` rows behind start/limit paging, `polls` behind page/pageSize paging.
function fakePortal(executives: object[], polls: object[], totalCount = polls.length): FetchJson {
  return async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/executive")) {
      const start = Number(u.searchParams.get("start"));
      return executives.slice(start, start + PAGE_SIZE);
    }
    const page = Number(u.searchParams.get("page"));
    const numPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    return { paginationInfo: { totalCount, numPages }, polls: polls.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
  };
}

const rawExec = (address: string, i = 0) => ({ address, key: `key-${i}`, date: "2026-01-26T00:00:00.000Z", active: false, spellData: { hasBeenCast: true, datePassed: "2026-01-30T12:00:00.000Z", dateExecuted: null } });
const rawPoll = (path: string, i = 0) => ({ pollId: 1500 + i, slug: `Qm${i}`, multiHash: `Qm${i}xx`, url: `https://raw.githubusercontent.com/sky-ecosystem/polls/refs/heads/main/${path}`, tags: [{ id: "weekly" }, "spark"], tally: { winningOptionName: "Yes", numVoters: 9 } });

describe("readPortal", () => {
  it("pages executives until a short page and keys them by lowercased address", async () => {
    const execs = Array.from({ length: PAGE_SIZE + 2 }, (_, i) => rawExec(`0xAB${String(i).padStart(38, "0")}`, i));
    const { executivesByAddress } = await readPortal(fakePortal(execs, []));
    expect(executivesByAddress.size).toBe(PAGE_SIZE + 2);
    expect(executivesByAddress.get(`0xab${"0".repeat(38)}`)).toMatchObject({ key: "key-0", hasBeenCast: true, datePassed: "2026-01-30T12:00:00.000Z" });
  });

  it("collects every poll page and normalises tags and outcome", async () => {
    const polls = Array.from({ length: 65 }, (_, i) => rawPoll(`2026/2026-01-${String(i).padStart(2, "0")}-p.md`, i));
    const { pollsByPath } = await readPortal(fakePortal([], polls));
    expect(pollsByPath.size).toBe(65);
    expect(pollsByPath.get("2026/2026-01-00-p.md")).toEqual({ pollId: 1500, slug: "Qm0", multiHash: "Qm0xx", tags: ["weekly", "spark"], winner: "Yes", numVoters: 9 });
  });

  it("stops paging executives at a bound when the portal never returns a short page", async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => rawExec(`0x${String(i).padStart(40, "0")}`, i));
    const endless: FetchJson = async (url) => (url.includes("/executive") ? full : fakePortal([], [])(url));
    await expect(readPortal(endless)).rejects.toThrow(/without a short page/);
  });

  it("throws when an executive page is not an array", async () => {
    const notArray: FetchJson = async (url) => (url.includes("/executive") ? { error: "down" } : fakePortal([], [])(url));
    await expect(readPortal(notArray)).rejects.toThrow(/did not return an array/);
  });

  it("throws when paging collects fewer polls than the portal's total", async () => {
    await expect(readPortal(fakePortal([], [rawPoll("2026/a.md")], 40))).rejects.toThrow(/reported 40 polls but paging collected/);
  });
});

describe("pollPathFromUrl", () => {
  it("ignores the org, so polls still pointing at makerdao/polls join too", () => {
    expect(pollPathFromUrl("https://raw.githubusercontent.com/makerdao/polls/refs/heads/main/2025/2025-06-09-AEP-11.md")).toBe("2025/2025-06-09-AEP-11.md");
    expect(pollPathFromUrl("https://example.com/not-a-poll")).toBeNull();
  });
});

describe("attachPortal", () => {
  it("joins executives by address and polls by path, and reports only surprising misses", async () => {
    const portal = await readPortal(fakePortal([rawExec("0xAAA0000000000000000000000000000000000001")], [rawPoll("2025/2025-06-02-x.md")]));
    const execs = [exec("2026/executive-vote-2026-01-29.md", "0xaaa0000000000000000000000000000000000001"), exec("2026/executive-vote-2026-10-08.md", null), exec("2026/executive-vote-2026-09-24.md", "0xBBB0000000000000000000000000000000000002")];
    const polls = [poll("2025/2025-06-02-x.md"), poll("2025/2025-06-09-y.md")];
    const join = attachPortal(execs, polls, portal);
    expect(execs[0].portal?.key).toBe("key-0");
    expect(polls[0].portal?.pollId).toBe(1500);
    expect(join).toEqual({
      executivesWithoutPortal: ["2026/executive-vote-2026-09-24.md"], // the drafted one is not a surprise
      portalExecutivesWithoutFile: 0,
      pollsWithoutPortal: ["2025/2025-06-09-y.md"],
      portalPollsWithoutFile: 0,
    });
  });
});

describe("checkFloors", () => {
  it("refuses a record under either floor and accepts one at the floor", () => {
    expect(() => checkFloors(artifact(MIN_EXECUTIVES - 1, MIN_POLLS))).toThrow(/under the floor/);
    expect(() => checkFloors(artifact(MIN_EXECUTIVES, MIN_POLLS - 1))).toThrow(/under the floor/);
    expect(() => checkFloors(artifact(MIN_EXECUTIVES, MIN_POLLS))).not.toThrow();
  });
});

describe("shrinkage", () => {
  it("is null with no previous artifact or when nothing was lost", () => {
    expect(shrinkage(null, artifact(1, 1))).toBeNull();
    expect(shrinkage(artifact(30, 140, 30), artifact(31, 140, 31))).toBeNull();
  });

  it("names every measure that went down, portal coverage included", () => {
    expect(shrinkage(artifact(32, 147), artifact(31, 147))).toBe("the vote record shrank (executives 32 → 31)");
    expect(shrinkage(artifact(32, 147, 32), artifact(32, 147, 0))).toBe("the vote record shrank (executives with portal data 32 → 0)");
  });
});
