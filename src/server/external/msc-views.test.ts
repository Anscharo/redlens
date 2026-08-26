import { test, expect } from "bun:test";
import { buildMscView, briefFromView } from "./msc-views.ts";
import { answerHasMscDisclaimer, MSC_REQUIRED_DISCLAIMER } from "./envelope.ts";
import { clipQuestion } from "./subagent.ts";
import type { SettlementsBundle } from "../../lib/settlements.ts";
import { supplyKept } from "../../lib/settlements.ts";

function bundle(): SettlementsBundle {
  return {
    source: { repo: "soterlabs/settlement-reports" },
    reports: [
      {
        prime: "spark",
        month: "2026-06",
        settleVersion: "0.4.0",
        generatedAt: null,
        period: { start: "2026-06-01", end: "2026-06-30", nDays: 30 },
        headline: {
          primeAgentRevenue: 10_000_000,
          skyRevenue: 4_000_000,
          profitToGrove: 8_000_000,
          cof: 3_500_000,
          sdeRevenue: 500_000,
          agentRate: 100_000,
        },
        venues: [
          {
            id: "S1",
            label: "SparkLend",
            chain: "ethereum",
            synthetic: false,
            revenueToPrime: 9_000_000,
            cofAlloc: 3_000_000,
            profitToSky: 3_000_000,
            profitToGrove: 6_000_000,
            valueEom: 50_000_000,
          },
        ],
      },
      {
        prime: "spark",
        month: "2026-07",
        settleVersion: "0.4.0",
        generatedAt: null,
        period: { start: "2026-07-01", end: "2026-07-31", nDays: 31 },
        headline: {
          primeAgentRevenue: 12_000_000,
          skyRevenue: 5_000_000,
          profitToGrove: 9_000_000,
          cof: 4_000_000,
          sdeRevenue: 1_000_000,
          agentRate: 200_000,
        },
        venues: [
          {
            id: "S1",
            label: "SparkLend",
            chain: "ethereum",
            synthetic: false,
            revenueToPrime: 10_000_000,
            cofAlloc: 3_500_000,
            profitToSky: 3_500_000,
            profitToGrove: 6_500_000,
            valueEom: 55_000_000,
          },
        ],
      },
      {
        prime: "grove",
        month: "2026-07",
        settleVersion: "0.4.0",
        generatedAt: null,
        period: { start: "2026-07-01", end: "2026-07-31", nDays: 31 },
        headline: {
          primeAgentRevenue: 2_000_000,
          skyRevenue: 1_200_000,
          profitToGrove: 800_000,
          cof: 800_000,
          sdeRevenue: 400_000,
        },
        venues: [],
      },
    ],
  };
}

const topics = [
  {
    title: "MSC #11 - Settlement Summary (July 2026)",
    url: "https://forum.skyeco.com/t/july",
    postedAt: "2026-08-01T00:00:00.000Z",
    period: ["2026-07"],
  },
];

test("month view: supply_kept is par − cof, not Σ profitToGrove; envelope is not_atlas", () => {
  const v = buildMscView(bundle(), topics, { view: "month", prime: "spark", month: "2026-07" });
  expect(v.not_atlas).toBe(true);
  expect(v.source_class).toBe("external");
  expect(v.required_disclaimer).toBe(MSC_REQUIRED_DISCLAIMER);
  const tw = v.three_way as { to_sky: number; supply_kept: number };
  const report = bundle().reports[1]!;
  expect(tw.supply_kept).toBe(supplyKept(report));
  expect(tw.supply_kept).toBe(8_000_000);
  expect(tw.supply_kept).not.toBe(report.headline.profitToGrove);
  expect(JSON.stringify(v)).not.toContain("profitToGrove");
  expect((v.forum as { url: string }).url).toBe("https://forum.skyeco.com/t/july");
  expect(v.workbook_url).toContain("reports/spark/2026-07");
});

test("month view without month uses latest published for the prime", () => {
  const v = buildMscView(bundle(), topics, { view: "month", actor_slug: "spark-party" });
  expect((v.cycle as { month: string }).month).toBe("2026-07");
});

test("missing prime/month does not invent dollars", () => {
  const v = buildMscView(bundle(), topics, { view: "month", prime: "spark", month: "2019-01" });
  expect(v.error).toBeTruthy();
  expect(v.three_way).toBeUndefined();
});

test("series is ordered three-way points without venues or profitToGrove", () => {
  const v = buildMscView(bundle(), topics, { view: "series", prime: "spark", last_n: 6 });
  const points = v.points as Array<{ month: string; to_sky: number }>;
  expect(points.map((p) => p.month)).toEqual(["2026-06", "2026-07"]);
  expect(JSON.stringify(v)).not.toContain("profitToGrove");
  expect(v.rows).toBeUndefined();
});

test("compare ranks primes by to_sky", () => {
  const v = buildMscView(bundle(), topics, { view: "compare", month: "2026-07", metric: "to_sky" });
  const rows = v.rows as Array<{ prime: string; to_sky: number }>;
  expect(rows[0]!.prime).toBe("spark");
  expect(rows[1]!.prime).toBe("grove");
});

test("venues includes headline vs venue sum gap note", () => {
  const v = buildMscView(bundle(), topics, { view: "venues", prime: "spark", month: "2026-07" });
  const gap = v.headline_vs_venue_sum as { gap: number; note: string };
  expect(gap.gap).toBe(2_000_000);
  expect(gap.note.toLowerCase()).toContain("supply kept");
});

test("terms view is not_atlas and cites the pipeline not atlas docs", () => {
  const v = buildMscView(bundle(), topics, { view: "terms" });
  expect(v.not_atlas).toBe(true);
  const sources = v.sources as Array<{ kind: string }>;
  expect(sources.some((s) => s.kind === "soter_pipeline")).toBe(true);
});

test("briefFromView copies three-way figures and never includes op_html", () => {
  const v = buildMscView(bundle(), topics, { view: "month", prime: "spark", month: "2026-07" });
  const b = briefFromView(v);
  expect(JSON.stringify(b)).not.toContain("op_html");
  expect((b.figures as unknown[]).length).toBeGreaterThan(0);
});

test("disclaimer helper requires not-from-atlas plus a real source name", () => {
  expect(answerHasMscDisclaimer("Spark sent $5 to Sky.")).toBe(false);
  expect(
    answerHasMscDisclaimer(
      "These figures are not from the Atlas. They come from Soter Labs workbooks for July 2026.",
    ),
  ).toBe(true);
});

test("clipQuestion caps length", () => {
  expect(clipQuestion("  a  ".repeat(400)).length).toBeLessThanOrEqual(500);
});
