import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import * as idb from "./idb";
import {
  canonicalPath,
  kindForPath,
  summarize,
  recordVisit,
  getEvents,
  topVisited,
  clearHistory,
  type VisitEvent,
} from "./visitHistory";

beforeEach(async () => {
  await clearHistory();
});

describe("canonicalPath", () => {
  it("keeps the identity param, drops incidental query + hash", () => {
    expect(canonicalPath("/atlas?id=abc")).toBe("/atlas?id=abc");
    expect(canonicalPath("/atlas?id=abc&view=history")).toBe("/atlas?id=abc");
    expect(canonicalPath("/atlas?id=abc#defs")).toBe("/atlas?id=abc");
    expect(canonicalPath("/reports/stale-dates?x=1")).toBe("/reports/stale-dates");
    expect(canonicalPath("/radar/spark#chain")).toBe("/radar/spark");
  });

  it("normalizes search queries (lowercased, trimmed, encoded)", () => {
    expect(canonicalPath("/?q=Facilitator")).toBe("/?q=facilitator");
    expect(canonicalPath("/?q=  Foo Bar ")).toBe("/?q=foo%20bar");
    expect(canonicalPath("/")).toBe("/");
  });

  it("survives special characters when the query is percent-encoded", () => {
    // Matches how useSearchTracking builds the path: encodeURIComponent(query).
    const q = "a & b # c";
    expect(canonicalPath(`/?q=${encodeURIComponent(q)}`)).toBe(`/?q=${encodeURIComponent(q.toLowerCase())}`);
  });
});

describe("kindForPath", () => {
  it("derives the product surface from the path", () => {
    expect(kindForPath("/atlas?id=abc")).toBe("reader");
    expect(kindForPath("/reports/stale-dates")).toBe("reports");
    expect(kindForPath("/radar/spark")).toBe("radar");
    expect(kindForPath("/?q=foo")).toBe("search"); // home + q param = search
  });
});

describe("summarize", () => {
  it("groups by path: count, most-recent label, last timestamp", () => {
    const events: VisitEvent[] = [
      { path: "/atlas?id=a", label: "Alpha", at: 10 },
      { path: "/atlas?id=a", label: "Alpha (renamed)", at: 30 },
      { path: "/radar/x", label: "X", at: 20 },
    ];
    const rows = summarize(events);
    const alpha = rows.find((r) => r.path === "/atlas?id=a")!;
    expect(alpha.count).toBe(2);
    expect(alpha.label).toBe("Alpha (renamed)"); // newest label wins
    expect(alpha.last).toBe(30);
    expect(alpha.kind).toBe("reader");
    expect(rows).toHaveLength(2);
  });
});

describe("recordVisit", () => {
  it("appends a canonicalized row", async () => {
    await recordVisit({ path: "/atlas?id=a&view=history", label: "Alpha" });
    const events = await getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].path).toBe("/atlas?id=a");
    expect(events[0].label).toBe("Alpha");
    expect(typeof events[0].at).toBe("number");
  });

  it("de-dupes a repeat of the same path within the window", async () => {
    await recordVisit({ path: "/atlas?id=a", label: "Alpha" });
    await recordVisit({ path: "/atlas?id=a", label: "Alpha" }); // immediate repeat
    expect(await getEvents()).toHaveLength(1);
  });

  it("records distinct paths separately", async () => {
    await recordVisit({ path: "/atlas?id=a", label: "Alpha" });
    await recordVisit({ path: "/radar/x", label: "X" });
    expect(await getEvents()).toHaveLength(2);
  });
});

describe("topVisited", () => {
  // Seed the log directly (bypassing recordVisit's dedupe/clock) to build counts.
  async function seed() {
    await idb.add<VisitEvent>({ path: "/atlas?id=a", label: "A", at: 1 });
    await idb.add<VisitEvent>({ path: "/atlas?id=a", label: "A2", at: 5 });
    await idb.add<VisitEvent>({ path: "/radar/x", label: "X", at: 3 });
  }

  it("orders by visit count, tiebreak most-recent, newest label", async () => {
    await seed();
    const top = await topVisited();
    expect(top[0].path).toBe("/atlas?id=a");
    expect(top[0].count).toBe(2);
    expect(top[0].label).toBe("A2");
    expect(top[1].path).toBe("/radar/x");
  });

  it("filters by kind", async () => {
    await seed();
    const readers = await topVisited({ kind: "reader" });
    expect(readers).toHaveLength(1);
    expect(readers[0].path).toBe("/atlas?id=a");
  });

  it("filters by since and limits with n", async () => {
    await seed();
    const recent = await topVisited({ since: 4 });
    // only at>=4 events: the second /atlas?id=a visit
    expect(recent).toHaveLength(1);
    expect(recent[0].path).toBe("/atlas?id=a");
    expect(recent[0].count).toBe(1);
    expect(await topVisited({ n: 1 })).toHaveLength(1);
  });
});

describe("idb retention helpers", () => {
  it("deleteBefore removes rows older than the cutoff", async () => {
    for (const at of [1, 2, 3, 4]) await idb.add<VisitEvent>({ path: `/radar/${at}`, label: `${at}`, at });
    await idb.deleteBefore(3);
    const rows = await idb.getAll<VisitEvent>();
    expect(rows.map((r) => r.at).sort()).toEqual([3, 4]);
  });

  it("trimToMax keeps only the newest rows", async () => {
    for (const at of [1, 2, 3, 4, 5]) await idb.add<VisitEvent>({ path: `/radar/${at}`, label: `${at}`, at });
    await idb.trimToMax(2);
    const rows = await idb.getAll<VisitEvent>();
    expect(rows.map((r) => r.at).sort()).toEqual([4, 5]);
  });
});

describe("resilience", () => {
  it("no-ops (never throws) when IndexedDB is unavailable", async () => {
    const saved = globalThis.indexedDB;
    // @ts-expect-error force-remove for the test
    delete globalThis.indexedDB;
    idb.__resetForTests();
    try {
      await expect(recordVisit({ path: "/atlas?id=z", label: "Z" })).resolves.toBeUndefined();
      await expect(getEvents()).resolves.toEqual([]);
      await expect(topVisited()).resolves.toEqual([]);
    } finally {
      globalThis.indexedDB = saved;
      idb.__resetForTests();
    }
  });
});
