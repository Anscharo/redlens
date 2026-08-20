// Tests for the stale-dates report logic.
// Reads the built docs.json — run `pnpm build:index` first if stale.
// All assertions pin "today" so they don't rot as real time passes.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "@/types";
import { buildStaleDatesReport, extractDateClaims, staleDatesToCSV } from "./staleDates";

const ROOT = path.resolve(__dirname, "../../../..");
const docs: Record<string, AtlasNode> = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8"),
).nodes;

const FIXED_TODAY = new Date("2026-06-11T12:00:00Z");
const report = buildStaleDatesReport(docs, FIXED_TODAY);

// Content canaries below assert that specific atlas claims are extracted.
// docs.json may be built at an arbitrary atlas commit (pnpm check:pr builds
// at PR heads whose branches can predate these claims), so each canary is
// skipped when its source text is absent from the snapshot — but still fails
// if the text is present and extraction misses it.
const atlasContent = Object.values(docs)
  .map((d) => d.content)
  .join("\n");
const hasGenesisClaim = atlasContent.includes("March 26, 2026");
const hasJune18Claim = atlasContent.includes("June 18, 2026");

describe("stale dates report", () => {
  it("buckets are consistent with daysUntilStale", () => {
    expect(report.stale.every((c) => c.daysUntilStale < 0)).toBe(true);
    expect(report.dueSoon.every((c) => c.daysUntilStale >= 0 && c.daysUntilStale <= 7)).toBe(true);
    expect(report.upcoming.every((c) => c.daysUntilStale > 7)).toBe(true);
  });

  it.skipIf(!hasGenesisClaim)("finds the known stale governance claims (as of 2026-06-11)", () => {
    const staleDocNos = new Set(report.stale.map((c) => c.docNo));
    // Genesis Capital transfers "will be included in the March 26, 2026
    // Executive Vote" — verified stale claims at the fixed date.
    const genesis = report.stale.filter((c) => c.dateISO === "2026-03-26");
    expect(genesis.length).toBeGreaterThanOrEqual(3);
    expect(staleDocNos.size).toBeGreaterThanOrEqual(20);
  });

  it("registry tables produce no false positives", () => {
    // Derecognition/breach registries are historical records; their forum
    // URLs ("…-due-to-…") used to trip tense detection before link stripping.
    const titles = new Set(
      [...report.stale, ...report.dueSoon, ...report.upcoming].map((c) => c.title),
    );
    expect(titles.has("Derecognized Alignment Conservers")).toBe(false);
    expect(titles.has("Aligned Delegate Breach Registry")).toBe(false);
  });

  it("month-precision claims go stale at period end, not period start", () => {
    // "December 2025" must resolve to 2025-12-31 — stale from Jan 1, not Dec 1.
    for (const c of [...report.stale, ...report.dueSoon, ...report.upcoming]) {
      if (c.precision === "month") expect(c.dateISO.slice(8)).not.toBe("01");
    }
  });

  it.skipIf(!hasJune18Claim)("a claim exactly 7 days out lands in dueSoon", () => {
    // Agent Spell Reviewer Checklist: "Beginning with the June 18, 2026
    // Executive Vote" — exactly one week from the fixed date.
    expect(report.dueSoon.some((c) => c.dateISO === "2026-06-18")).toBe(true);
  });

  it("every claim carries a navigable doc and a non-empty context", () => {
    for (const c of [...report.stale, ...report.dueSoon, ...report.upcoming]) {
      expect(docs[c.docId]).toBeDefined();
      expect(c.context.length).toBeGreaterThan(10);
      expect(c.dateISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Synthetic-content unit tests — exercise each extraction path in isolation,
// independent of what shapes the current atlas happens to contain.
// ---------------------------------------------------------------------------

const TODAY_UTC = Date.UTC(2026, 5, 11); // 2026-06-11

function fakeDoc(content: string): AtlasNode {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    doc_no: "A.9.9",
    title: "Synthetic",
    type: "Core",
    depth: 2,
    parentId: null,
    order: 0,
    content,
    contentHash: "",
    addressRefs: [],
  } as unknown as AtlasNode;
}

function claimsOf(content: string) {
  return extractDateClaims(fakeDoc(content), TODAY_UTC);
}

describe("extractDateClaims — date shapes", () => {
  it('"Month D, YYYY" (day precision)', () => {
    const { claims } = claimsOf("The transfer will be included in the March 26, 2026 Executive Vote.");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ raw: "March 26, 2026", dateISO: "2026-03-26", precision: "day" });
  });

  it('"D Month YYYY" (day precision, dedupes the inner month-year match)', () => {
    const { claims, mentions } = claimsOf("The cliff will occur on 17 June 2026.");
    expect(mentions).toBe(1);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ raw: "17 June 2026", dateISO: "2026-06-17", precision: "day" });
  });

  it("ISO YYYY-MM-DD (day precision)", () => {
    const { claims } = claimsOf("The deployment is scheduled for 2026-04-09.");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ raw: "2026-04-09", dateISO: "2026-04-09", precision: "day" });
  });

  it("Q-quarter resolves to the quarter's last day", () => {
    const { claims } = claimsOf("Payments will begin in Q2 2026.");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ raw: "Q2 2026", dateISO: "2026-06-30", precision: "quarter" });
  });

  it("month-year resolves to the month's last day (leap year)", () => {
    const { claims } = claimsOf("The freeze will end in February 2028.");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ raw: "February 2028", dateISO: "2028-02-29", precision: "month" });
  });

  it("years outside 2015–2100 are not even counted as mentions", () => {
    expect(claimsOf("The system will launch in March 2101.").mentions).toBe(0);
    expect(claimsOf("Founded in March 1999, it will expand.").mentions).toBe(0);
  });
});

describe("extractDateClaims — tense gating", () => {
  it("a date without future phrasing produces a mention but no claim", () => {
    const { claims, mentions } = claimsOf("The grant was disbursed on March 26, 2026.");
    expect(mentions).toBe(1);
    expect(claims).toHaveLength(0);
  });

  it('"by {date}" qualifies without any other marker', () => {
    const { claims } = claimsOf("Agents must update their artifacts by September 1, 2026.");
    expect(claims).toHaveLength(1);
    expect(claims[0].dateISO).toBe("2026-09-01");
  });

  it("future words hiding in link URLs do not qualify (link stripping)", () => {
    const { claims, mentions } = claimsOf(
      "Removed on 2024-04-06. See [the post](https://forum.example/t/this-will-be-scheduled-soon/123).",
    );
    expect(mentions).toBe(1);
    expect(claims).toHaveLength(0);
  });

  it("future words in link TEXT still qualify (visible text is kept)", () => {
    const { claims } = claimsOf(
      "See [the vote that will run on May 1, 2027](https://vote.example/) for details.",
    );
    expect(claims).toHaveLength(1);
  });
});

describe("extractDateClaims — context split", () => {
  it("daysUntilStale measures from the provided today", () => {
    const { claims } = claimsOf("The checklist will apply from June 18, 2026.");
    expect(claims[0].daysUntilStale).toBe(7);
  });

  it("splits around the matched occurrence even when the date appears twice", () => {
    const { claims } = claimsOf(
      "June 1, 2026 was announced. Work will continue and must end on June 1, 2026.",
    );
    expect(claims).toHaveLength(2);
    // The second claim's before-text contains the first occurrence — an
    // indexOf-based split in the renderer would have italicized the wrong one.
    expect(claims[1].contextBefore).toContain("June 1, 2026");
    expect(claims[1].contextAfter).toBe(".");
    expect(claims[1].context).toBe(claims[1].contextBefore + claims[1].raw + claims[1].contextAfter);
  });

  it("collapses internal whitespace in the snippet", () => {
    const { claims } = claimsOf("The vote\n\nwill be held on   March 26, 2026 as\nplanned.");
    expect(claims[0].context).toBe("The vote will be held on March 26, 2026 as planned.");
  });
});

describe("extractDateClaims — transition (handoff) tagging", () => {
  it("flags an operational control handoff (the real SparkLend → Spark Governance case)", () => {
    const { claims } = claimsOf(
      "At such time, which is currently estimated for September 17, 2025, control will transition to Spark Governance.",
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].transition).toBe(true);
  });

  it("does not flag ordinary dated claims as handoffs", () => {
    const { claims } = claimsOf("The transfer will be included in the March 26, 2026 Executive Vote.");
    expect(claims[0].transition).toBe(false);
  });
});

describe("buildStaleDatesReport — bucketing (synthetic)", () => {
  it("one doc per bucket lands where expected", () => {
    const mk = (id: string, content: string) =>
      ({ ...fakeDoc(content), id, doc_no: `A.9.${id}` }) as AtlasNode;
    const docs: Record<string, AtlasNode> = {
      a: mk("a", "The vote will be held on March 26, 2026."), // past → stale
      b: mk("b", "The vote will be held on June 15, 2026."), // +4d → dueSoon
      c: mk("c", "The vote will be held on September 1, 2026."), // far → upcoming
    };
    const r = buildStaleDatesReport(docs, new Date("2026-06-11T12:00:00Z"));
    expect(r.stale.map((c) => c.docId)).toEqual(["a"]);
    expect(r.dueSoon.map((c) => c.docId)).toEqual(["b"]);
    expect(r.upcoming.map((c) => c.docId)).toEqual(["c"]);
    expect(r.totalDateMentions).toBe(3);
  });
});

describe("staleDatesToCSV", () => {
  it("flattens the three buckets with a leading Bucket column", () => {
    const csv = staleDatesToCSV(report);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe('"Bucket","Doc No","Title","UUID","Atlas Link","Date Text","Boundary Date","Precision","Days Until Stale","Handoff","Context"');
    const total = report.stale.length + report.dueSoon.length + report.upcoming.length;
    expect(lines.length - 1).toBe(total); // one data row per claim
    // Buckets appear in stale → due-soon → upcoming order.
    const buckets = lines.slice(1).map((l) => l.slice(1, l.indexOf('","')));
    const firstUpcoming = buckets.indexOf("upcoming");
    const lastStale = buckets.lastIndexOf("stale");
    if (firstUpcoming !== -1 && lastStale !== -1) expect(lastStale).toBeLessThan(firstUpcoming);
  });
});
