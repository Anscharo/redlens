import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — .mjs without types
import {
  VENUE_HEADERS,
  parseWorkbook,
  parseReportsDir,
  reconcile,
} from "../scripts/lib/settlement-xlsx.mjs";

const HEADER = [...VENUE_HEADERS];

async function workbookBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function addSummary(
  wb: ExcelJS.Workbook,
  opts: {
    par?: number;
    agentRate?: number;
    dr?: number;
    chronicle?: number;
    gar?: number;
    cof?: number;
    sde?: number;
  } = {},
) {
  const par = opts.par ?? 100;
  const agentRate = opts.agentRate ?? 10;
  const dr = opts.dr ?? 0;
  const chronicle = opts.chronicle ?? 0;
  const gar = opts.gar ?? 0;
  const cof = opts.cof ?? 40;
  const sde = opts.sde ?? 20;
  const primeTotal = par + agentRate + dr + chronicle + gar;
  const sky = cof + sde;
  const ws = wb.addWorksheet("Summary");
  ws.addRow(["SPARK — Monthly settlement 2026-07"]);
  ws.addRow([]);
  ws.addRow(["Prime side", "USD"]);
  ws.addRow(["prime_agent_revenue (gross venue yield to prime)", par]);
  ws.addRow(["+ agent_rate (subproxy USDS / sUSDS yield)", agentRate]);
  if (dr) ws.addRow(["+ distribution_rewards (settle-dr-dune)", dr]);
  if (chronicle) ws.addRow(["+ chronicle_points (20% of base rate on Chronicle Farm USDS)", chronicle]);
  if (gar) ws.addRow(["+ governance_accessibility_rewards (share × SNR)", gar]);
  ws.addRow(["", primeTotal]);
  ws.addRow([]);
  ws.addRow(["Sky side", "USD"]);
  ws.addRow(["CoF on utilized (BR × Net_Subs)", cof]);
  ws.addRow(["+ SDE revenue (Sky-Direct, full to Sky)", sde]);
  ws.addRow(["", sky]);
  ws.addRow([]);
  ws.addRow(['Comparison (Grove-style "Profit to Grove")', "USD"]);
  ws.addRow(["prime_agent_revenue", par]);
  ws.addRow(["− CoF (deducted per-venue in display)", -cof]);
  ws.addRow(["", par - cof]);
  ws.addRow([]);
  ws.addRow(["Period", "2026-07-01 → 2026-07-31 (31 days)"]);
  ws.addRow(["Generated", "2026-08-07T11:53:57Z"]);
  ws.addRow(["Pipeline", "0.4.0"]);
}

function venueRow(over: Record<string, unknown> = {}): unknown[] {
  const row: Record<string, unknown> = {
    Venue: "S1",
    Label: "Spark USDS",
    Chain: "ethereum",
    "Pricing cat.": "C",
    "Position SoM": 100,
    "Position EoM": 110,
    "Period inflow": 10,
    actual_revenue: 8,
    external_revenue: 1,
    "revenue (to prime)": 7,
    "sd_revenue (to Sky)": 2,
    "Avg value": 105,
    Weight: 1,
    "CoF alloc": 3,
    "Profit to Sky": 5,
    "Profit to Grove": 4,
    "Utilized Deduction (avg)": 0,
    "Spread Reimb": 0,
    Notes: "",
    ...over,
  };
  return HEADER.map((h) => row[h]);
}

describe("parseWorkbook — Venues", () => {
  it("round-trips CoF columns by header name", async () => {
    const buf = await workbookBuffer((wb) => {
      addSummary(wb, { par: 4, cof: 5, sde: 0 });
      const ws = wb.addWorksheet("Venues");
      ws.addRow(HEADER);
      ws.addRow(
        venueRow({
          "CoF alloc": 3,
          "Profit to Sky": 5,
          "Profit to Grove": 4,
          "Period inflow": 99,
        }),
      );
    });
    const report = await parseWorkbook(buf, { prime: "spark", month: "2026-07" });
    expect(report.venues).toHaveLength(1);
    expect(report.venues[0]).toMatchObject({
      id: "S1",
      cofAlloc: 3,
      profitToSky: 5,
      profitToGrove: 4,
      positionDelta: 99,
      synthetic: false,
    });
    expect(report.venues[0]).not.toHaveProperty("periodInflow");
  });

  it("stops at the position-only subsection", async () => {
    const buf = await workbookBuffer((wb) => {
      addSummary(wb);
      const ws = wb.addWorksheet("Venues");
      ws.addRow(HEADER);
      ws.addRow(venueRow({ Venue: "S1" }));
      ws.addRow([]);
      ws.addRow(["Position-only venues (PnL aggregated at prime level)"]);
      ws.addRow(["Venue", "Label", "Chain", "Pricing cat.", "Position SoM", "Position EoM"]);
      ws.addRow(["S56", "spUSDC", "ethereum", "S2", 10, 12]);
    });
    const report = await parseWorkbook(buf);
    expect(report.venues.map((v: { id: string }) => v.id)).toEqual(["S1"]);
  });

  it("flags synthetic SPREAD / PSM_CURVE_DEDUCT rows", async () => {
    const buf = await workbookBuffer((wb) => {
      addSummary(wb);
      const ws = wb.addWorksheet("Venues");
      ws.addRow(HEADER);
      ws.addRow(venueRow({ Venue: "SPREAD", Label: "30bps sUSDS spread" }));
      ws.addRow(venueRow({ Venue: "PSM_CURVE_DEDUCT", Label: "unattributed BR" }));
      ws.addRow(venueRow({ Venue: "S1" }));
    });
    const report = await parseWorkbook(buf);
    expect(report.venues.filter((v: { synthetic: boolean }) => v.synthetic).map((v: { id: string }) => v.id)).toEqual([
      "SPREAD",
      "PSM_CURVE_DEDUCT",
    ]);
    expect(report.venues[2].synthetic).toBe(false);
  });

  it("throws when a required Venues header is missing", async () => {
    const buf = await workbookBuffer((wb) => {
      addSummary(wb);
      const ws = wb.addWorksheet("Venues");
      ws.addRow(HEADER.filter((h) => h !== "CoF alloc"));
      ws.addRow(venueRow().filter((_, i) => HEADER[i] !== "CoF alloc"));
    });
    await expect(parseWorkbook(buf)).rejects.toThrow(/CoF alloc/);
  });

  it("throws when the Venues sheet is missing", async () => {
    const buf = await workbookBuffer((wb) => {
      addSummary(wb);
    });
    await expect(parseWorkbook(buf)).rejects.toThrow(/Venues/);
  });
});

describe("parseWorkbook — Summary", () => {
  it("reads unlabeled block totals and optional demand-side rows", async () => {
    const buf = await workbookBuffer((wb) => {
      addSummary(wb, {
        par: 100,
        agentRate: 10,
        dr: 5,
        chronicle: 2,
        gar: 3,
        cof: 40,
        sde: 20,
      });
      const ws = wb.addWorksheet("Venues");
      ws.addRow(HEADER);
      ws.addRow(venueRow());
    });
    const report = await parseWorkbook(buf);
    expect(report.headline).toMatchObject({
      primeAgentRevenue: 100,
      agentRate: 10,
      distributionRewards: 5,
      chroniclePoints: 2,
      gar: 3,
      primeAgentTotalRevenue: 120,
      cof: 40,
      sdeRevenue: 20,
      skyRevenue: 60,
      profitToGrove: 60,
    });
    expect(report.period).toEqual({ start: "2026-07-01", end: "2026-07-31", nDays: 31 });
    expect(report.settleVersion).toBe("0.4.0");
    expect(report.generatedAt).toBe("2026-08-07T11:53:57Z");
  });

  it("does not take comparison prime_agent_revenue over the Prime-side value", async () => {
    const buf = await workbookBuffer((wb) => {
      addSummary(wb, { par: 100, cof: 40, sde: 0 });
      const ws = wb.addWorksheet("Venues");
      ws.addRow(HEADER);
    });
    const report = await parseWorkbook(buf);
    expect(report.headline.primeAgentRevenue).toBe(100);
    expect(report.headline.profitToGrove).toBe(60);
  });

  it("reconciles Σ P2S to skyRevenue and Σ P2G to the Comparison total", async () => {
    const buf = await workbookBuffer((wb) => {
      addSummary(wb, { par: 100, cof: 40, sde: 20 });
      const ws = wb.addWorksheet("Venues");
      ws.addRow(HEADER);
      ws.addRow(
        venueRow({
          "revenue (to prime)": 100,
          "Profit to Sky": 60,
          "Profit to Grove": 60,
        }),
      );
    });
    const rec = reconcile(await parseWorkbook(buf));
    expect(rec.dSky).toBe(0);
    expect(rec.dP2G).toBe(0);
    expect(rec.dRevenue).toBe(0);
  });
});

describe("parseReportsDir", () => {
  it("walks reports/<prime>/<YYYY-MM>/*.xlsx and skips aggregators", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "settlement-xlsx-"));
    try {
      const sparkDir = path.join(root, "spark", "2026-07");
      fs.mkdirSync(sparkDir, { recursive: true });
      fs.mkdirSync(path.join(root, "sky_total", "2026-07"), { recursive: true });
      const buf = await workbookBuffer((wb) => {
        addSummary(wb);
        const ws = wb.addWorksheet("Venues");
        ws.addRow(HEADER);
        ws.addRow(venueRow({ Venue: "S1", "Profit to Sky": 5, "Profit to Grove": 4 }));
      });
      fs.writeFileSync(path.join(sparkDir, "spark_settlement_july_2026.xlsx"), buf);
      fs.writeFileSync(
        path.join(root, "sky_total", "2026-07", "sky_total_settlement_july_2026.xlsx"),
        buf,
      );
      const bundle = await parseReportsDir(root);
      expect(bundle.reports).toHaveLength(1);
      expect(bundle.reports[0].prime).toBe("spark");
      expect(bundle.reports[0].month).toBe("2026-07");
      const rec = reconcile(bundle.reports[0]);
      expect(rec.sumProfitToSky).toBe(5);
      expect(rec.sumProfitToGrove).toBe(4);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
