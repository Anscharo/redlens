// The /reports index catalog: section grouping + per-card copy. Titles and
// descriptions stay in routes.ts (visit-history and the chat's page-context
// line also read them); this file is the one place that says which reports
// appear on the index and under which category. Search (lexical + ternlight)
// and ReportsIndex both read from here so a new report can't be listed in one
// and invisible to the other.
import type { ReportId } from "../types";
import { REPORT_DESCRIPTIONS, REPORT_TITLES } from "./routes";

export interface ReportIndexCard {
  id: ReportId;
  title: string;
  description: string;
  category: string;
}

export interface ReportIndexSection {
  title: string;
  reports: ReportIndexCard[];
}

const card = (id: ReportId, category: string): ReportIndexCard => ({
  id,
  title: REPORT_TITLES[id],
  description: REPORT_DESCRIPTIONS[id],
  category,
});

// Ordered sections as they render on /reports. A report belongs to exactly one.
const SECTION_IDS: { title: string; ids: ReportId[] }[] = [
  {
    title: "OEA Reports",
    ids: ["of-responsibilities", "gov-ops-responsibilities", "oea-assessment"],
  },
  {
    title: "General Reports",
    ids: [
      "active-data",
      "rewards",
      "risk-rules",
      "onchain-addresses",
      "stale-dates",
      "mod-frequency",
      "processes",
      "crossview",
    ],
  },
];

export const REPORT_INDEX_SECTIONS: ReportIndexSection[] = SECTION_IDS.map((s) => ({
  title: s.title,
  reports: s.ids.map((id) => card(id, s.title)),
}));

export const REPORT_INDEX_CARDS: ReportIndexCard[] = REPORT_INDEX_SECTIONS.flatMap((s) => s.reports);

/** Concatenated haystack — one of the fields scored for semantic search. */
export function reportEmbedText(card: ReportIndexCard): string {
  return `${card.title}. ${card.category}. ${card.description}`;
}

/**
 * Texts embedded per card. Title / category / description are scored
 * separately (and alongside the concat) so a short paraphrase of the name
 * isn't diluted by the description. Category is repeated across a section;
 * callers should cache by string.
 */
export function reportEmbedFields(card: ReportIndexCard): string[] {
  return [card.title, card.category, card.description, reportEmbedText(card)];
}
