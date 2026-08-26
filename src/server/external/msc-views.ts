// Curated MSC views for chat/MCP. Same accounting Radar uses — never a raw
// workbook dump, never Comparison-block Σ as a headline.

import {
  SETTLEMENT_NEAR_ZERO as NEAR_ZERO,
  collapseAum,
  demandPart,
  demandSideRevenue,
  DEMAND_SERIES,
  isDemandSideCycle,
  reportsForPrime,
  revenueGap,
  settlementPrimeKeys,
  supplyKept,
  type SettlementReport,
  type SettlementsBundle,
} from "../../lib/settlements.ts";
import type { ForumMonthTopic } from "../../lib/forumMonths.ts";
import { forumTopicUrlForMonth } from "../../lib/forumMonths.ts";
import {
  mscEnvelope,
  workbookUrl,
  type MscEnvelope,
  type MscSourceRow,
} from "./envelope.ts";

export const MSC_VIEWS = ["month", "series", "compare", "venues", "terms"] as const;
export type MscViewName = (typeof MSC_VIEWS)[number];

export const MSC_METRICS = ["to_sky", "supply_kept", "demand_side", "cof"] as const;
export type MscMetric = (typeof MSC_METRICS)[number];

export interface MscViewArgs {
  view?: string;
  prime?: string;
  actor_slug?: string;
  month?: string;
  metric?: string;
  last_n?: number;
  from?: string;
  to?: string;
}

const THREE_WAY_NOTE =
  "The three genuine flows are To Sky, supply kept (prime agent revenue − cost of funds), and demand-side. Cost of funds is a component of To Sky, not a fourth destination.";

const TERMS = [
  {
    term: "Cost of funds",
    meaning:
      "The interest the Prime owes Sky on capital Sky minted to it. In these workbooks it is part of To Sky (sky revenue − Sky Direct Exposure), not a separate payout to add on top. It is not Atlas vocabulary.",
  },
  {
    term: "Supply kept",
    meaning:
      "What the Prime keeps from the venue book after paying Sky: prime agent revenue minus cost of funds. Not the Comparison block's sum of per-venue Profit to Grove — that sum drops Spark's non-venue revenue and spread reimbursement.",
  },
  {
    term: "Sky Direct Exposure",
    meaning:
      "The remainder of Sky's take after cost of funds. Material for Grove; near-zero for Spark; zero for Obex.",
  },
  {
    term: "Demand-side",
    meaning:
      "Agent rate plus distribution rewards, Chronicle points, and accessibility rewards (GAR) when present. Keel and Skybase settle as demand-side-only cycles.",
  },
];

export interface ForumHit {
  title: string;
  url: string;
  posted_at: string | null;
}

function forumForMonth(topics: readonly ForumMonthTopic[], month: string): ForumHit | null {
  const url = forumTopicUrlForMonth(topics, month);
  if (!url) return null;
  const hit = topics.find((t) => t.url === url);
  return { title: hit?.title ?? "", url, posted_at: hit?.postedAt ?? null };
}

function sourcesFor(report: SettlementReport | null, forum: ForumHit | null): MscSourceRow[] {
  const out: MscSourceRow[] = [];
  if (report) out.push({ kind: "soter_workbook", prime: report.prime, month: report.month, url: workbookUrl(report.prime, report.month) });
  if (forum) out.push({ kind: "sky_forum", title: forum.title, url: forum.url, posted_at: forum.posted_at });
  return out;
}

function wrap(sources: MscSourceRow[], body: Record<string, unknown>): MscEnvelope & Record<string, unknown> {
  return { ...mscEnvelope(sources), ...body };
}

function resolvePrime(args: MscViewArgs): string {
  return (args.prime ?? args.actor_slug ?? "").trim();
}

function latestMonth(reports: readonly SettlementReport[]): string | null {
  if (reports.length === 0) return null;
  return [...reports].sort((a, b) => a.month.localeCompare(b.month)).at(-1)!.month;
}

function pickReport(bundle: SettlementsBundle, slug: string, month?: string): SettlementReport | null {
  const reports = reportsForPrime(bundle, slug);
  if (reports.length === 0) return null;
  const m = month && month !== "latest" ? month : latestMonth(reports);
  return reports.find((r) => r.month === m) ?? null;
}

function demandParts(report: SettlementReport): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of DEMAND_SERIES) {
    const n = demandPart(report.headline, s.key);
    if (Math.abs(n) >= NEAR_ZERO) out[s.key] = n;
  }
  return out;
}

function monthBody(report: SettlementReport, forum: ForumHit | null) {
  const gap = revenueGap(report);
  const traps: string[] = [];
  if (gap >= NEAR_ZERO) {
    traps.push(
      `Venue revenue rows sum $${Math.round(report.venues.reduce((n, v) => n + v.revenueToPrime, 0))} against headline prime agent revenue $${Math.round(report.headline.primeAgentRevenue)} (gap $${Math.round(gap)}). Do not use Σ Profit to Grove as supply kept.`,
    );
  }
  const { cof, sdeRevenue, skyRevenue } = report.headline;
  const toSkyComponents: Record<string, number> = {};
  if (Math.abs(cof) >= NEAR_ZERO) toSkyComponents.cof = cof;
  if (Math.abs(sdeRevenue) >= NEAR_ZERO) toSkyComponents.sde = sdeRevenue;
  return {
    cycle: {
      prime: report.prime,
      month: report.month,
      period: report.period,
      settleVersion: report.settleVersion,
      kind: isDemandSideCycle(report) ? "demand_only" : "supply",
    },
    three_way: {
      to_sky: skyRevenue,
      supply_kept: supplyKept(report),
      demand_side: demandSideRevenue(report.headline),
      note: THREE_WAY_NOTE,
    },
    to_sky_components: toSkyComponents,
    demand_parts: demandParts(report),
    traps,
    workbook_url: workbookUrl(report.prime, report.month),
    forum,
  };
}

export function buildMscView(
  bundle: SettlementsBundle,
  topics: readonly ForumMonthTopic[],
  raw: MscViewArgs,
): Record<string, unknown> {
  const view = (raw.view as MscViewName | undefined) ?? "month";
  if (!MSC_VIEWS.includes(view)) {
    return wrap([], { error: `unknown view: ${raw.view}`, views: MSC_VIEWS });
  }

  if (view === "terms") {
    return wrap(
      [{ kind: "soter_pipeline", note: "RedLens reading of soterlabs/settlement-cycle — not Atlas documents." }],
      { view: "terms", terms: TERMS },
    );
  }

  if (view === "compare") {
    const month =
      raw.month && raw.month !== "latest"
        ? raw.month
        : latestMonth(bundle.reports);
    if (!month) return wrap([], { view, error: "no published workbooks" });
    const metric = (MSC_METRICS.includes(raw.metric as MscMetric) ? raw.metric : "to_sky") as MscMetric;
    const rows = bundle.reports
      .filter((r) => r.month === month)
      .map((r) => ({
        prime: r.prime,
        month: r.month,
        to_sky: r.headline.skyRevenue,
        supply_kept: supplyKept(r),
        demand_side: demandSideRevenue(r.headline),
        cof: r.headline.cof,
      }))
      .sort((a, b) => Math.abs(b[metric]) - Math.abs(a[metric]));
    const forum = forumForMonth(topics, month);
    const sources: MscSourceRow[] = bundle.reports
      .filter((r) => r.month === month)
      .map((r) => ({ kind: "soter_workbook" as const, prime: r.prime, month: r.month, url: workbookUrl(r.prime, r.month) }));
    return wrap(sourcesFor(null, forum).concat(sources), {
      view,
      month,
      metric,
      rows,
      forum,
      three_way_note: THREE_WAY_NOTE,
    });
  }

  const slug = resolvePrime(raw);
  if (!slug) {
    return wrap([], { error: "prime or actor_slug is required for this view", view });
  }
  if (settlementPrimeKeys(slug).length === 0) {
    return wrap([], { error: "unrecognised prime", view });
  }

  if (view === "series") {
    let reports = reportsForPrime(bundle, slug);
    if (raw.from) reports = reports.filter((r) => r.month >= raw.from!);
    if (raw.to) reports = reports.filter((r) => r.month <= raw.to!);
    const lastN = Math.min(24, Math.max(1, raw.last_n ?? 12));
    reports = reports.slice(-lastN);
    const points = reports.map((r) => ({
      month: r.month,
      to_sky: r.headline.skyRevenue,
      supply_kept: supplyKept(r),
      demand_side: demandSideRevenue(r.headline),
      cof: r.headline.cof,
    }));
    const sources: MscSourceRow[] = reports.slice(-3).map((r) => ({
      kind: "soter_workbook",
      prime: r.prime,
      month: r.month,
      url: workbookUrl(r.prime, r.month),
    }));
    return wrap(sources, {
      view,
      prime: reports[0]?.prime ?? slug,
      points,
      three_way_note: THREE_WAY_NOTE,
    });
  }

  const report = pickReport(bundle, slug, raw.month);
  if (!report) {
    return wrap([], {
      view,
      error: "no published workbook for this prime/month",
      prime: slug,
      month: raw.month ?? null,
    });
  }
  const forum = forumForMonth(topics, report.month);

  if (view === "venues") {
    const ranked = [...report.venues]
      .map((v) => ({
        id: v.id,
        label: v.label,
        chain: v.chain,
        revenue_to_prime: v.revenueToPrime,
        cof_alloc: v.cofAlloc,
        profit_to_sky: v.profitToSky,
        profit_to_grove: v.profitToGrove,
        value_eom: v.valueEom ?? 0,
      }))
      .sort((a, b) => Math.abs(b.profit_to_grove) + Math.abs(b.profit_to_sky) - (Math.abs(a.profit_to_grove) + Math.abs(a.profit_to_sky)));
    const head = ranked.slice(0, 12);
    const tail = ranked.slice(12);
    const rows =
      tail.length === 0
        ? head
        : [
            ...head,
            {
              id: "_other",
              label: `Other venues (${tail.length})`,
              chain: "",
              revenue_to_prime: tail.reduce((n, v) => n + v.revenue_to_prime, 0),
              cof_alloc: tail.reduce((n, v) => n + v.cof_alloc, 0),
              profit_to_sky: tail.reduce((n, v) => n + v.profit_to_sky, 0),
              profit_to_grove: tail.reduce((n, v) => n + v.profit_to_grove, 0),
              value_eom: tail.reduce((n, v) => n + v.value_eom, 0),
            },
          ];
    const venueSum = report.venues.reduce((n, v) => n + v.revenueToPrime, 0);
    return wrap(sourcesFor(report, forum), {
      view,
      cycle: { prime: report.prime, month: report.month },
      rows,
      aum: collapseAum(report.venues),
      headline_vs_venue_sum: {
        venue_revenue_sum: venueSum,
        headline_prime_agent_revenue: report.headline.primeAgentRevenue,
        gap: revenueGap(report),
        note: "The venue-row sum is not supply kept and is not the Comparison-block total. Supply kept is prime agent revenue − cost of funds.",
      },
      forum,
      workbook_url: workbookUrl(report.prime, report.month),
    });
  }

  return wrap(sourcesFor(report, forum), { view: "month", ...monthBody(report, forum) });
}

/** Deterministic brief when the sub-agent is unavailable — numbers only, no narrative. */
export function briefFromView(view: Record<string, unknown>): Record<string, unknown> {
  const figures: { name: string; value: number; unit: string }[] = [];
  const tw = view.three_way as Record<string, number> | undefined;
  if (tw && typeof tw.to_sky === "number") {
    figures.push({ name: "To Sky", value: tw.to_sky, unit: "USD" });
    figures.push({ name: "Supply kept", value: tw.supply_kept, unit: "USD" });
    figures.push({ name: "Demand-side", value: tw.demand_side, unit: "USD" });
  }
  const comps = view.to_sky_components as Record<string, number> | undefined;
  if (comps?.cof != null) figures.push({ name: "Cost of funds (of To Sky)", value: comps.cof, unit: "USD" });
  if (comps?.sde != null) figures.push({ name: "Sky Direct Exposure (of To Sky)", value: comps.sde, unit: "USD" });
  const points = view.points as Array<Record<string, number | string>> | undefined;
  if (points) {
    for (const p of points.slice(-6)) {
      if (typeof p.to_sky === "number") figures.push({ name: `To Sky ${p.month}`, value: p.to_sky, unit: "USD" });
    }
  }
  const rows = view.rows as Array<Record<string, number | string>> | undefined;
  if (view.view === "compare" && rows) {
    for (const r of rows.slice(0, 8)) {
      if (typeof r.to_sky === "number") figures.push({ name: `${r.prime} To Sky`, value: r.to_sky, unit: "USD" });
    }
  }
  return {
    source_class: view.source_class,
    not_atlas: true,
    required_disclaimer: view.required_disclaimer,
    sources: view.sources,
    figures: figures.slice(0, 12),
    forum: view.forum ?? null,
    workbook_url: view.workbook_url ?? null,
    notes: "",
    subagent: "skipped",
  };
}
