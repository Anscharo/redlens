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

export const MSC_VIEWS = ["month", "series", "compare", "venues", "aggregate", "terms"] as const;
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

// Which of these are Atlas vocabulary and which are workbook vocabulary is
// load-bearing, and it runs BOTH ways. Most of these words are Soter/OEA
// coinages the Atlas never defines — verified absent from
// vendor/next-gen-atlas/content/. But "Sky Direct Exposure" IS an Atlas-defined
// term (A.2.2.10.1.1.1.1), so describing it as workbook-only is the same class
// of error in reverse.
const TERMS = [
  {
    term: "Cost of funds",
    meaning:
      "The interest the Prime owes Sky on capital Sky minted to it. In these workbooks it is part of To Sky (sky revenue − Sky Direct Exposure), not a separate payout to add on top. NOT Atlas vocabulary — the Atlas calls the same thing \"an interest expense of the Prime Agent and revenue of Sky\" (A.2.4.2.1) and says it is charged on a utilized balance defined in A.2.4.2.1.2. The daily accrual and day-count used to compute it are Soter implementation choices; the Atlas specifies neither.",
  },
  {
    term: "Supply kept",
    meaning:
      "What the Prime keeps from the venue book after paying Sky: prime agent revenue minus cost of funds. Not the Comparison block's sum of per-venue Profit to Grove — that sum drops Spark's non-venue revenue and spread reimbursement. NOT Atlas vocabulary.",
  },
  {
    term: "Sky Direct Exposure",
    meaning:
      "An ATLAS-DEFINED term (A.2.2.10.1.1.1.1) — unlike the other words on this list. The Atlas excludes USDS attributable to a Sky Direct Exposure from the utilized balance interest is charged on (A.2.4.2.1.2), and excludes it from sUSDS netting (A.2.4.2.1.3). In these workbooks it is the remainder of Sky's take after cost of funds: material for Grove, near-zero for Spark, zero for Obex.",
  },
  {
    term: "Demand-side",
    meaning:
      "Agent rate plus distribution rewards, Chronicle points, and accessibility rewards (GAR) when present. Keel and Skybase settle as demand-side-only cycles. NOT Atlas vocabulary, and note the direction flips by party: Distribution Rewards are an EXPENSE of the Sky Protocol in the Atlas (A.2.3.1.2.1.3.3) and revenue to the Prime here.",
  },
  {
    term: "Net Revenue",
    meaning:
      "An Atlas term these workbooks do NOT compute. The Atlas defines Net Revenue as Income minus Expenses (A.2.3.1.2.1.1), recognised on a cash basis by when USDS/DAI enter or leave the Sky Surplus Buffer (A.2.3.1.2.1), then allocated through the waterfall in A.2.3.1.2. To Sky is part of one Income component (Stability Fees From Base Rate, A.2.3.1.2.1.2.1) before any Expenses — Sky Savings Rate paid to sUSDS holders (A.2.3.1.2.1.3.1) and the reward expenses are not deducted anywhere in these figures. Never present To Sky, or a sum of it, as Sky's net revenue.",
  },
];

// Carried by every money-bearing view. The Atlas defines "Net Revenue" as a
// specific, cash-basis, post-expense figure (A.2.3.1.2.1.1 / A.2.3.1.2.1),
// and nothing in these workbooks is it — To Sky is part of ONE Income
// component before any Expenses are subtracted. The risk is highest on the
// cross-prime roll-up, where a single ecosystem-wide number reads exactly like
// an answer to "what did Sky earn", so the caveat travels with the data rather
// than living only in the terms view a caller may never request.
const NOT_NET_REVENUE =
  "to_sky is the interest a Prime owes Sky plus Sky Direct Exposure, as calculated by Soter. It is NOT the Sky Protocol's Net Revenue: the Atlas defines that as Income minus Expenses recognised on a cash basis at the Sky Surplus Buffer (A.2.3.1.2.1.1, A.2.3.1.2.1). These amounts sit inside one Income component (Stability Fees From Base Rate, A.2.3.1.2.1.2.1); Expenses such as the Sky Savings Rate paid to sUSDS holders (A.2.3.1.2.1.3.1) are not deducted here, and the allocation waterfall (A.2.3.1.2) has not been applied. Never present these figures, or a sum of them, as Sky's net revenue.";

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
  const traps: string[] = [NOT_NET_REVENUE];
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

// The primes this bundle actually has workbooks for, sorted. Derived, never a
// literal list: primes are added upstream as Soter publishes them, and a stale
// hardcoded roster would send the model chasing a prime with no reports (or
// hide a new one entirely).
// cof + sde = skyRevenue, so both are reported UNDER to_sky rather than beside
// it (Invariant 2). Near-zero parts are omitted so a prime with no Sky Direct
// Exposure doesn't carry a meaningless `sde: 0`.
function componentsOf(cof: number, sde: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (Math.abs(cof) >= NEAR_ZERO) out.cof = cof;
  if (Math.abs(sde) >= NEAR_ZERO) out.sde = sde;
  return out;
}

export function primesInBundle(bundle: SettlementsBundle): string[] {
  return [...new Set(bundle.reports.map((r) => r.prime))].sort();
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
      [{ kind: "soter_pipeline", note: "SAbR reading of soterlabs/settlement-cycle — not Atlas documents." }],
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
    // cof is nested under to_sky_components, not left as a peer key beside
    // to_sky/supply_kept/demand_side. THREE_WAY_NOTE already said in prose that
    // it is a component and not a fourth destination, but a flat `cof` sibling
    // invites exactly the addition that note forbids — and cof is ~all of
    // to_sky, so double-counting it nearly doubles Sky's take. Matching the
    // shape to the invariant beats trusting the reader to heed the footnote,
    // and keeps compare consistent with month and aggregate.
    const rankOfRow = (r: { to_sky: number; supply_kept: number; demand_side: number; to_sky_components: Record<string, number> }) =>
      metric === "cof" ? (r.to_sky_components.cof ?? 0) : r[metric];
    const rows = bundle.reports
      .filter((r) => r.month === month)
      .map((r) => ({
        prime: r.prime,
        month: r.month,
        to_sky: r.headline.skyRevenue,
        supply_kept: supplyKept(r),
        demand_side: demandSideRevenue(r.headline),
        to_sky_components: componentsOf(r.headline.cof, r.headline.sdeRevenue),
      }))
      .sort((a, b) => Math.abs(rankOfRow(b)) - Math.abs(rankOfRow(a)));
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
      traps: [NOT_NET_REVENUE],
    });
  }

  // ── aggregate: the only CROSS-prime, multi-month view ────────────────────
  // Everything else is either one prime (month/series/venues) or one month
  // (compare), so "top venues across the ecosystem" and "total to Sky this
  // year" had no answer and read as "no settlement data".
  //
  // Two accounting rules govern every number below; both are load-bearing and
  // both are easy to get wrong by summing the convenient column (see
  // .claude/skills/settlement-reports/SKILL.md):
  //   1. Supply-side revenue is `prime_agent_revenue − cof` (supplyKept), NEVER
  //      Σ per-venue profit_to_grove. The venue sum silently drops non-venue
  //      revenue and spread reimbursement — a $7.29M gap across published
  //      workbooks, ALL of it Spark, invisible on every other prime.
  //   2. Cost of funds is not a fourth flow: it is a COMPONENT of To Sky
  //      (cof + sde = skyRevenue), so it is nested under to_sky_components and
  //      never emitted as a peer of to_sky/supply_kept/demand_side, or a reader
  //      adds them and counts Sky's take twice.
  // `foot_delta` re-checks rule 2's identity on the aggregate itself, so a
  // future basis regression shows up in the payload instead of silently
  // shipping a wrong total.
  if (view === "aggregate") {
    const all = [...new Set(bundle.reports.map((r) => r.month))].sort();
    const latest = all[all.length - 1];
    let months: string[];
    if (raw.from || raw.to) {
      months = all.filter((m) => (!raw.from || m >= raw.from) && (!raw.to || m <= raw.to));
    } else if (raw.month && raw.month !== "latest") {
      months = all.filter((m) => m === raw.month);
    } else {
      months = latest ? [latest] : [];
    }
    months = months.slice(-24); // same ceiling as series — bounds the payload
    const reports = bundle.reports.filter((r) => months.includes(r.month));
    if (reports.length === 0) {
      return wrap([], { view, error: "no published workbooks in that range", months_available: all });
    }

    const byPrime = new Map<string, { prime: string; months: string[]; to_sky: number; supply_kept: number; demand_side: number; prime_agent_revenue: number; cof: number; sde: number }>();
    for (const r of reports) {
      const row = byPrime.get(r.prime) ?? { prime: r.prime, months: [], to_sky: 0, supply_kept: 0, demand_side: 0, prime_agent_revenue: 0, cof: 0, sde: 0 };
      row.months.push(r.month);
      row.to_sky += r.headline.skyRevenue;
      row.supply_kept += supplyKept(r); // par − cof, never Σ profit_to_grove
      row.demand_side += demandSideRevenue(r.headline);
      row.prime_agent_revenue += r.headline.primeAgentRevenue;
      row.cof += r.headline.cof;
      row.sde += r.headline.sdeRevenue;
      byPrime.set(r.prime, row);
    }
    const metric = (MSC_METRICS.includes(raw.metric as MscMetric) ? raw.metric : "to_sky") as MscMetric;
    // cof is nested under to_sky_components (Invariant 2), so ranking by it has
    // to reach into the component rather than a top-level key. An earlier cut
    // fell back to to_sky here while still echoing metric:"cof" in the payload
    // — silently answering a different question than the one asked, and one
    // that only LOOKS right because cof and to_sky differ merely by SDE.
    const rankOf = (r: { to_sky: number; supply_kept: number; demand_side: number; to_sky_components: Record<string, number> }) =>
      metric === "cof" ? (r.to_sky_components.cof ?? 0) : r[metric];
    const primeRows = [...byPrime.values()]
      .map((r) => ({
        prime: r.prime,
        months: r.months.sort(),
        to_sky: r.to_sky,
        supply_kept: r.supply_kept,
        demand_side: r.demand_side,
        to_sky_components: componentsOf(r.cof, r.sde),
      }))
      .sort((a, b) => Math.abs(rankOf(b)) - Math.abs(rankOf(a)));

    // Venue rows keyed by prime+id: two primes can reuse an id, and the same
    // venue across months is one venue whose FLOWS add up. value_eom is a
    // STOCK (end-of-month balance) — summing it across months would invent
    // money, so it takes the latest month's value instead.
    const venueMap = new Map<string, { prime: string; id: string; label: string; chain: string; revenue_to_prime: number; profit_to_sky: number; profit_to_grove: number; value_eom: number; last: string; months: number }>();
    for (const r of reports) {
      for (const v of r.venues) {
        const key = `${r.prime}::${v.id}`;
        const cur = venueMap.get(key);
        if (!cur) {
          venueMap.set(key, { prime: r.prime, id: v.id, label: v.label, chain: v.chain, revenue_to_prime: v.revenueToPrime, profit_to_sky: v.profitToSky, profit_to_grove: v.profitToGrove, value_eom: v.valueEom ?? 0, last: r.month, months: 1 });
          continue;
        }
        cur.revenue_to_prime += v.revenueToPrime;
        cur.profit_to_sky += v.profitToSky;
        cur.profit_to_grove += v.profitToGrove;
        cur.months += 1;
        if (r.month >= cur.last) {
          cur.last = r.month;
          cur.label = v.label;
          cur.value_eom = v.valueEom ?? 0; // stock: latest, not summed
        }
      }
    }
    const topVenues = [...venueMap.values()]
      .sort((a, b) => Math.abs(b.revenue_to_prime) - Math.abs(a.revenue_to_prime))
      .slice(0, 20)
      .map((v) => ({ prime: v.prime, id: v.id, label: v.label, chain: v.chain, revenue_to_prime: v.revenue_to_prime, profit_to_sky: v.profit_to_sky, profit_to_grove: v.profit_to_grove, value_eom_latest: v.value_eom, months_counted: v.months }));

    const eco = primeRows.reduce(
      (a, r) => ({ to_sky: a.to_sky + r.to_sky, supply_kept: a.supply_kept + r.supply_kept, demand_side: a.demand_side + r.demand_side }),
      { to_sky: 0, supply_kept: 0, demand_side: 0 },
    );
    const totalCof = reports.reduce((n, r) => n + r.headline.cof, 0);
    const totalSde = reports.reduce((n, r) => n + r.headline.sdeRevenue, 0);
    const totalPar = reports.reduce((n, r) => n + r.headline.primeAgentRevenue, 0);
    // (skyRevenue + supplyKept + demand) must equal (par + demand + sde).
    const footDelta = eco.to_sky + eco.supply_kept + eco.demand_side - (totalPar + eco.demand_side + totalSde);

    const venueSum = reports.reduce((n, r) => n + r.venues.reduce((m, v) => m + v.revenueToPrime, 0), 0);
    const traps = [
      NOT_NET_REVENUE,
      "supply_kept is prime agent revenue minus cost of funds, per prime, then summed. It is NOT the sum of per-venue Profit to Grove — that basis drops non-venue revenue and spread reimbursement.",
      "cost of funds is a component of to_sky (cof + sde = to_sky), not a fourth flow. Do not add it to to_sky.",
      "value_eom_latest is an end-of-month balance from the newest month counted, not a sum across months.",
    ];
    if (Math.abs(venueSum - totalPar) >= NEAR_ZERO) {
      traps.push(
        `Venue revenue rows sum $${Math.round(venueSum)} against headline prime agent revenue $${Math.round(totalPar)} (gap $${Math.round(Math.abs(venueSum - totalPar))}). Rank venues by these rows, but never total them into a headline.`,
      );
    }

    const sources: MscSourceRow[] = reports.map((r) => ({ kind: "soter_workbook" as const, prime: r.prime, month: r.month, url: workbookUrl(r.prime, r.month) }));
    return wrap(sources, {
      view,
      months,
      primes: primeRows.map((r) => r.prime),
      metric,
      by_prime: primeRows,
      ecosystem: { ...eco, prime_agent_revenue: totalPar, to_sky_components: componentsOf(totalCof, totalSde), foot_delta: footDelta },
      top_venues: topVenues,
      traps,
    });
  }

  // Both of these errors carry `available_primes`, derived from the loaded
  // bundle rather than hardcoded, so a caller that guessed wrong can retry
  // correctly on the very next round instead of concluding the data does not
  // exist. Without it, `view=venues` with no prime was a dead end: the model
  // had no way to learn WHICH views need a prime or what the valid values are,
  // so it reported that no settlement data was available while the workbooks
  // sat right there on disk.
  const slug = resolvePrime(raw);
  if (!slug) {
    return wrap([], {
      error: `prime or actor_slug is required for view=${view}`,
      view,
      available_primes: primesInBundle(bundle),
    });
  }
  if (settlementPrimeKeys(slug).length === 0) {
    return wrap([], { error: `unrecognised prime: ${slug}`, view, available_primes: primesInBundle(bundle) });
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
    // The error a WRONG prime actually lands on: settlementPrimeKeys maps most
    // strings to candidate keys, so an invented slug reaches here rather than
    // the "unrecognised prime" branch above. It therefore needs the roster too
    // — otherwise a single bad guess still reads as "there is no settlement
    // data", which is the failure this whole path exists to prevent.
    return wrap([], {
      view,
      error: "no published workbook for this prime/month",
      prime: slug,
      month: raw.month ?? null,
      available_primes: primesInBundle(bundle),
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
