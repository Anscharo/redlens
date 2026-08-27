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

// A per-prime view called with no prime used to dead-end: the error named no
// valid values, so the model had no way to recover and reported that no
// settlement data existed while the workbooks sat on disk. The error now
// carries the roster, derived from the bundle.
test("a per-prime view with no prime returns the available primes so the caller can retry", () => {
  for (const view of ["month", "series", "venues"] as const) {
    const out = buildMscView(bundle(), [], { view });
    expect(String(out.error)).toContain(`view=${view}`);
    expect(out.available_primes).toEqual(primesOf(bundle()));
  }
});

// A prime the caller invented reaches the "no published workbook" branch, not
// the "unrecognised prime" one — settlementPrimeKeys maps most strings to
// candidate keys. Either way the caller must be handed the real roster.
test("a prime with no workbook still returns the available primes", () => {
  const out = buildMscView(bundle(), [], { view: "venues", prime: "not-a-prime" });
  expect(out.error).toBeTruthy();
  expect(out.available_primes).toEqual(primesOf(bundle()));
});

test("compare and terms need no prime — they must not report a missing one", () => {
  for (const view of ["compare", "terms"] as const) {
    const out = buildMscView(bundle(), [], { view });
    expect(String(out.error ?? "")).not.toContain("prime or actor_slug is required");
  }
});

test("the prime roster is derived from the bundle, not hardcoded", () => {
  const b = bundle();
  b.reports.push({ ...b.reports[0], prime: "newprime", month: "2026-07" });
  const out = buildMscView(b, [], { view: "venues" });
  expect(out.available_primes).toContain("newprime");
});

function primesOf(b: SettlementsBundle): string[] {
  return [...new Set(b.reports.map((r) => r.prime))].sort();
}

// ── aggregate: the cross-prime, multi-month roll-up ────────────────────────
// The invariants these guard are documented in
// .claude/skills/settlement-reports/SKILL.md. Both are silent failures: the
// wrong basis still returns a plausible number.

test("aggregate needs no prime and covers every prime in the month", () => {
  const out = buildMscView(bundle(), [], { view: "aggregate" });
  expect(out.error).toBeUndefined();
  expect(Array.isArray(out.by_prime)).toBe(true);
  expect((out.top_venues as unknown[]).length).toBeGreaterThan(0);
});

// Invariant 1. On this fixture (as on 5 of 6 real primes) both bases coincide,
// so the assertion is written against supplyKept() directly rather than a
// number that would still pass on the wrong basis.
test("aggregate supply_kept is par - cof, never the venue-row sum", () => {
  const b = bundle();
  const out = buildMscView(b, [], { view: "aggregate", from: "0000-00", to: "9999-99" });
  const rows = out.by_prime as { prime: string; supply_kept: number }[];
  for (const row of rows) {
    const reps = b.reports.filter((r) => r.prime === row.prime);
    expect(row.supply_kept).toBeCloseTo(reps.reduce((n, r) => n + supplyKept(r), 0), 6);
  }
});

// Invariant 2: cof + sde = to_sky, and cof is nested UNDER to_sky, never beside
// it — a peer row would let a reader add it and double-count Sky's take.
test("aggregate nests cof/sde under to_sky and foots the three-way identity", () => {
  const out = buildMscView(bundle(), [], { view: "aggregate", from: "0000-00", to: "9999-99" });
  const eco = out.ecosystem as {
    to_sky: number; supply_kept: number; demand_side: number;
    prime_agent_revenue: number; foot_delta: number;
    to_sky_components: { cof?: number; sde?: number };
  };
  expect(eco).not.toHaveProperty("cof");
  const { cof = 0, sde = 0 } = eco.to_sky_components;
  expect(cof + sde).toBeCloseTo(eco.to_sky, 6);
  expect(eco.foot_delta).toBeCloseTo(0, 6);
});

// value_eom is a STOCK. Summing it across months would invent money.
test("aggregate takes the latest value_eom rather than summing the stock", () => {
  const b = bundle();
  const spark = b.reports.filter((r) => r.prime === "spark").sort((x, y) => x.month.localeCompare(y.month));
  if (spark.length > 1) {
    const out = buildMscView(b, [], { view: "aggregate", from: "0000-00", to: "9999-99" });
    const rows = out.top_venues as { prime: string; id: string; value_eom_latest: number }[];
    const last = spark[spark.length - 1];
    for (const v of last.venues) {
      const row = rows.find((r) => r.prime === "spark" && r.id === v.id);
      if (row) expect(row.value_eom_latest).toBeCloseTo(v.valueEom ?? 0, 6);
    }
  }
});

test("aggregate reports an empty range instead of inventing zeros", () => {
  const out = buildMscView(bundle(), [], { view: "aggregate", from: "1999-01", to: "1999-12" });
  expect(String(out.error)).toContain("no published workbooks");
  expect(Array.isArray(out.months_available)).toBe(true);
});

// metric=cof must reach INTO to_sky_components, where Invariant 2 nests it.
// Asserting the ordering property (rather than a fixture-specific sequence)
// keeps this valid whatever the fixture's numbers are — and it fails on the
// silent to_sky fallback, which was the actual bug.
test("aggregate ranks by cof using the nested component, not a to_sky fallback", () => {
  const out = buildMscView(bundle(), [], { view: "aggregate", metric: "cof", from: "0000-00", to: "9999-99" });
  const rows = out.by_prime as { to_sky_components: { cof?: number } }[];
  const cofs = rows.map((r) => Math.abs(r.to_sky_components.cof ?? 0));
  expect(cofs).toEqual([...cofs].sort((a, b) => b - a));
  expect(out.metric).toBe("cof");
});

// Invariant 2 as a SHAPE, not just a footnote: no money view may expose cof as
// a sibling of to_sky/supply_kept/demand_side. cof is nearly all of to_sky, so
// a reader adding the flat key roughly doubles Sky's take.
test("no money view exposes cof as a peer of the three flows", () => {
  const compare = buildMscView(bundle(), [], { view: "compare", month: "2026-07" });
  for (const row of compare.rows as Record<string, unknown>[]) {
    expect(row).not.toHaveProperty("cof");
    expect(row).toHaveProperty("to_sky_components");
  }
  const agg = buildMscView(bundle(), [], { view: "aggregate", from: "0000-00", to: "9999-99" });
  for (const row of agg.by_prime as Record<string, unknown>[]) {
    expect(row).not.toHaveProperty("cof");
  }
  expect(agg.ecosystem as Record<string, unknown>).not.toHaveProperty("cof");
});

// The Atlas defines Net Revenue as a cash-basis, post-expense figure
// (A.2.3.1.2.1.1). Nothing here computes it, and an ecosystem-wide to_sky total
// reads exactly like an answer to "what did Sky earn" — so the caveat must
// travel with the data, not only in the terms view.
test("every money view carries the not-Net-Revenue caveat", () => {
  const views = [
    buildMscView(bundle(), [], { view: "aggregate", from: "0000-00", to: "9999-99" }),
    buildMscView(bundle(), [], { view: "compare", month: "2026-07" }),
    buildMscView(bundle(), [], { view: "month", prime: "spark" }),
  ];
  for (const v of views) {
    expect((v.traps as string[]).some((t) => /not.*Net Revenue/i.test(t))).toBe(true);
  }
});

test("terms marks Sky Direct Exposure as Atlas-defined and cost of funds as not", () => {
  const terms = buildMscView(bundle(), [], { view: "terms" }).terms as { term: string; meaning: string }[];
  const sde = terms.find((t) => t.term === "Sky Direct Exposure");
  expect(sde?.meaning).toMatch(/ATLAS-DEFINED/);
  expect(terms.find((t) => t.term === "Cost of funds")?.meaning).toMatch(/NOT Atlas vocabulary/);
});
