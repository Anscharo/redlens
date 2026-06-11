// Tests for the stale-dates report logic.
// Reads the built docs.json — run `pnpm build:index` first if stale.
// All assertions pin "today" so they don't rot as real time passes.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "../types";
import { buildStaleDatesReport } from "./staleDates";

const ROOT = path.resolve(__dirname, "../..");
const docs: Record<string, AtlasNode> = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8"),
).nodes;

const FIXED_TODAY = new Date("2026-06-11T12:00:00Z");
const report = buildStaleDatesReport(docs, FIXED_TODAY);

describe("stale dates report", () => {
  it("buckets are consistent with daysUntilStale", () => {
    expect(report.stale.every((c) => c.daysUntilStale < 0)).toBe(true);
    expect(report.dueSoon.every((c) => c.daysUntilStale >= 0 && c.daysUntilStale <= 7)).toBe(true);
    expect(report.upcoming.every((c) => c.daysUntilStale > 7)).toBe(true);
  });

  it("finds the known stale governance claims (as of 2026-06-11)", () => {
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

  it("a claim exactly 7 days out lands in dueSoon", () => {
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
