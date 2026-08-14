import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import * as idb from "./idb";
import {
  canonicalPath,
  docIdFromPath,
  kindForPath,
  normalizeParams,
  visitHref,
  summarize,
  recordVisit,
  getEvents,
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

describe("docIdFromPath", () => {
  it("reads the node id back out of a reader path", () => {
    expect(docIdFromPath(canonicalPath("/atlas?id=abc"))).toBe("abc");
    expect(docIdFromPath("/preview/7/atlas?id=abc")).toBe("abc"); // survives the router base
  });

  it("returns null for anything that isn't a reader path", () => {
    expect(docIdFromPath("/reports/rewards")).toBeNull();
    expect(docIdFromPath("/atlas")).toBeNull();
    expect(docIdFromPath("/?q=vat")).toBeNull();
  });
});

describe("kindForPath", () => {
  it("derives the product surface from the path", () => {
    expect(kindForPath("/atlas?id=abc")).toBe("reader");
    expect(kindForPath("/reports/stale-dates")).toBe("reports");
    expect(kindForPath("/radar/spark")).toBe("radar");
    expect(kindForPath("/?q=foo")).toBe("search"); // home + q param = search
  });

  it("classifies any /preview/<id>/… path as preview", () => {
    expect(kindForPath("/preview/42/atlas?id=abc")).toBe("preview");
    expect(kindForPath("/preview/42/?q=foo")).toBe("preview"); // preview beats search
    expect(kindForPath("/preview/42/reports/stale-dates")).toBe("preview");
  });
});

describe("normalizeParams", () => {
  it("sorts and drops empty values so equal filter sets compare equal", () => {
    expect(normalizeParams("q=usds&cat=spark")).toBe("cat=spark&q=usds");
    expect(normalizeParams("cat=spark&q=usds")).toBe("cat=spark&q=usds");
    expect(normalizeParams("cat=&q=usds")).toBe("q=usds");
    expect(normalizeParams("")).toBe("");
  });

  it("accepts a URLSearchParams and percent-encodes values", () => {
    expect(normalizeParams(new URLSearchParams({ q: "a & b" }))).toBe("q=a%20%26%20b");
  });

  it("drops an over-long value rather than storing it", () => {
    const long = "x".repeat(200);
    expect(normalizeParams(`expanded=${long}&cat=spark`)).toBe("cat=spark");
  });
});

describe("visitHref", () => {
  it("re-attaches the filters to the stored path", () => {
    expect(visitHref({ path: "/reports/rewards", params: "cat=spark" })).toBe("/reports/rewards?cat=spark");
    expect(visitHref({ path: "/reports/rewards" })).toBe("/reports/rewards");
    // The reader path already carries its identity query.
    expect(visitHref({ path: "/atlas?id=a", params: "view=history" })).toBe("/atlas?id=a&view=history");
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

  it("groups a page under one path however its filters were set, keeping the newest", () => {
    const rows = summarize([
      { path: "/reports/rewards", label: "Rewards", at: 10, params: "cat=a" },
      { path: "/reports/rewards", label: "Rewards", at: 30, params: "cat=b" },
      { path: "/reports/rewards", label: "Rewards", at: 20 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
    expect(rows[0].params).toBe("cat=b"); // filters from the most recent visit
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

  it("stores the filters set on the page", async () => {
    await recordVisit({ path: "/reports/rewards", label: "Rewards", params: "q=usds&cat=spark" });
    const events = await getEvents();
    expect(events[0].path).toBe("/reports/rewards");
    expect(events[0].params).toBe("cat=spark&q=usds");
  });

  it("records a filter change but still de-dupes an unchanged repeat", async () => {
    await recordVisit({ path: "/reports/rewards", label: "Rewards", params: "cat=a" });
    await recordVisit({ path: "/reports/rewards", label: "Rewards", params: "cat=a" });
    expect(await getEvents()).toHaveLength(1);
    await recordVisit({ path: "/reports/rewards", label: "Rewards", params: "cat=b" });
    expect(await getEvents()).toHaveLength(2);
  });

  it("records distinct paths separately", async () => {
    await recordVisit({ path: "/atlas?id=a", label: "Alpha" });
    await recordVisit({ path: "/radar/x", label: "X" });
    expect(await getEvents()).toHaveLength(2);
  });

  it("prepends the router base so preview visits don't collide with live", async () => {
    // base is useRouter().base: "" live, /preview/<id> in preview mode.
    await recordVisit({ path: "/atlas?id=a", label: "Alpha", base: "/preview/42" });
    const events = await getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].path).toBe("/preview/42/atlas?id=a"); // separated from live /atlas?id=a
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
    } finally {
      globalThis.indexedDB = saved;
      idb.__resetForTests();
    }
  });
});
