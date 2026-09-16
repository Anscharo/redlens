// The /reports index catalog: which reports exist, how they group, where each
// one's data comes from, and the per-card copy search embeds.
//
// Kept as a pure module (no React) so the grouping is testable without
// rendering, per the house rule that report data logic lives in src/lib/.
// Filtering lives in reportIndexSearch.ts (lexical + optional semantic ids) —
// this file must not import that module, or the server embedder and the
// catalog completeness check would share a cycle.
//
// Titles and descriptions stay in routes.ts — they are shared with visit-history
// capture and the chat's page-context line. This module adds the two things
// the index itself needs: grouping and provenance. Search (and ReportsIndex)
// both read from here so a new report can't be listed in one and invisible
// to the other.

import type { ReportId } from "../types";
import { REPORT_TITLES, REPORT_DESCRIPTIONS } from "./routes";

/**
 * Where a report's rows come from — the axis that tells a reader how much to
 * trust what they are looking at, and how current it is.
 *
 * `live` is the norm and is deliberately NOT badged in the UI: badging 8 of 12
 * cards identically would be noise. A badge means "there is a caveat here".
 */
export type ReportProvenance =
  | "live" // recomputed from the served atlas on every visit
  | "ai-assessed" // LLM-drafted against a published rubric, human-reviewed
  | "curated"; // hand-maintained; can lag the atlas until someone refreshes it

export const REPORT_PROVENANCE: Record<ReportId, ReportProvenance> = {
  "of-responsibilities": "live",
  "gov-ops-responsibilities": "live",
  "oea-assessment": "ai-assessed",
  "active-data": "live",
  rewards: "live",
  "risk-rules": "ai-assessed",
  "onchain-addresses": "live",
  "stale-dates": "live",
  "mod-frequency": "live",
  processes: "curated",
  crossview: "live",
  "potential-mistakes": "ai-assessed",
};

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

/**
 * Grouped by subject — what each report is *about* — because that is how people
 * browse. Provenance rides along as a per-card badge rather than a second set of
 * sections, so neither axis has to distort the other.
 */
export const REPORT_GROUPS: ReportGroup[] = [
  {
    title: "Roles & duties",
    hint: "Who the Atlas obliges to do what.",
    reports: ["of-responsibilities", "gov-ops-responsibilities", "oea-assessment"],
  },
  {
    title: "On-chain & money",
    hint: "Addresses the Atlas names and the reward relationships it records.",
    reports: ["onchain-addresses", "rewards"],
  },
  {
    title: "Rules & risk",
    hint: "The constraints the Atlas places on behaviour.",
    reports: ["risk-rules"],
  },
  {
    title: "Atlas structure",
    hint: "How the Atlas is put together and what it contains.",
    reports: ["processes", "active-data", "crossview"],
  },
  {
    title: "Atlas health",
    hint: "Whether the Atlas is accurate, current, and how it is changing.",
    reports: ["potential-mistakes", "stale-dates", "mod-frequency"],
  },
];

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

function toCard(id: ReportId, category: string, hint: string): ReportCard {
  return {
    id,
    title: REPORT_TITLES[id],
    description: REPORT_DESCRIPTIONS[id],
    provenance: REPORT_PROVENANCE[id],
    category,
    hint,
  };
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

function provenanceLabel(card: ReportCard): string | null {
  return card.provenance === "live" ? null : PROVENANCE_LABELS[card.provenance];
}

/** Concatenated haystack — one of the fields scored for semantic search. */
export function reportEmbedText(card: ReportCard): string {
  return [card.title, card.category, card.hint, card.description, provenanceLabel(card)]
    .filter(Boolean)
    .join(". ");
}

/**
 * Texts embedded per card. Title / category / hint / description / badge
 * are scored separately (and alongside the concat) so a short paraphrase of
 * the name isn't diluted by the description. Category and hint repeat
 * across a group; callers should cache by string.
 */
export function reportEmbedFields(card: ReportCard): string[] {
  const label = provenanceLabel(card);
  const fields = [card.title, card.category, card.hint, card.description];
  if (label) fields.push(label);
  fields.push(reportEmbedText(card));
  return fields;
}
