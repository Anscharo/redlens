// The /reports index catalog: the report registry (src/lib/reports/) arranged
// into the index's subject groups, plus the provenance badge copy and the
// per-card text search embeds.
//
// A pure module (no React), so the grouping is testable without rendering.
// Filtering lives in reportIndexSearch.ts; this file must not import it, or the
// server embedder and the catalog completeness check would share a cycle.

import type { ReportId } from "../types";
import { REPORT_GROUP_DEFS } from "./reports/groups";
import { REPORTS } from "./reports/registry";
import type { ReportProvenance } from "./reports/types";

export type { ReportProvenance };

export const REPORT_PROVENANCE: Record<ReportId, ReportProvenance> = Object.fromEntries(
  REPORTS.map((r) => [r.id, r.provenance]),
) as Record<ReportId, ReportProvenance>;

/** Badge text. `live` has no badge, so no label. */
export const PROVENANCE_LABELS: Record<Exclude<ReportProvenance, "live">, string> = {
  "ai-assessed": "AI-assessed",
  curated: "curated",
};

/** Badge tooltip — says what the label means for the reader. */
export const PROVENANCE_TITLES: Record<Exclude<ReportProvenance, "live">, string> = {
  "ai-assessed":
    "AI-drafted and human-reviewed rather than recomputed from the Atlas — a starting point, not a verdict.",
  curated:
    "Hand-maintained rather than recomputed from the Atlas, so it can lag until someone refreshes it.",
};

export interface ReportGroup {
  title: string;
  /** One line under the heading saying what the group is for. */
  hint: string;
  reports: ReportId[];
}

/** Index sections in display order; within a group, reports keep registry order. */
export const REPORT_GROUPS: ReportGroup[] = REPORT_GROUP_DEFS.map((g) => ({
  title: g.title,
  hint: g.hint,
  reports: REPORTS.filter((r) => r.group === g.key).map((r) => r.id),
}));

export interface ReportCard {
  id: ReportId;
  title: string;
  description: string;
  provenance: ReportProvenance;
  /** Subject-group title — stamped so search can score the category per card. */
  category: string;
  /** Subject-group hint — same for every card in the group; cached on embed. */
  hint: string;
}

export interface ReportCardGroup {
  title: string;
  hint: string;
  cards: ReportCard[];
}

const BY_ID = new Map(REPORTS.map((r) => [r.id as ReportId, r]));

function toCard(id: ReportId, category: string, hint: string): ReportCard {
  const r = BY_ID.get(id)!;
  return { id, title: r.title, description: r.description, provenance: r.provenance, category, hint };
}

/** Every report id the index renders — the completeness check's input. */
export function catalogReportIds(): ReportId[] {
  return REPORT_GROUPS.flatMap((g) => g.reports);
}

/** The index's groups, unfiltered. Query matching lives in reportIndexSearch. */
export function buildReportCatalog(): ReportCardGroup[] {
  return REPORT_GROUPS.map((g) => ({
    title: g.title,
    hint: g.hint,
    cards: g.reports.map((id) => toCard(id, g.title, g.hint)),
  }));
}

/** Stable catalog identity — a blank-query filter returns this same array. */
export const REPORT_INDEX_GROUPS: ReportCardGroup[] = buildReportCatalog();

export const REPORT_INDEX_CARDS: ReportCard[] = REPORT_INDEX_GROUPS.flatMap((g) => g.cards);

/** Concatenated haystack — one of the fields scored for semantic search. */
export function reportEmbedText(card: ReportCard): string {
  return `${card.title}. ${card.description}`;
}

/**
 * Texts embedded per card. Title and description are scored separately (and
 * alongside the concat) so a short paraphrase of the name isn't diluted by
 * the description. Group titles/hints stay lexical-only: embedding
 * "Atlas health" made any query containing "atlas" light up the whole index.
 */
export function reportEmbedFields(card: ReportCard): string[] {
  return [card.title, card.description, reportEmbedText(card)];
}
