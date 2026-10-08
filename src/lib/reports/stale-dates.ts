import type { ReportMeta } from "./types";

export const staleDates = {
  id: "stale-dates",
  title: "Stale Dates",
  description:
    "Future-tense claims checked against today — dates the atlas still phrases as upcoming but that have already passed, plus claims due within the next week — each checked against the Sky vote record, as are past-tense claims that a dated Executive Vote happened. Not an atlas concept: computed by the Redline Portal from atlas prose against the current date.",
  group: "health",
  provenance: "live",
  scope: { label: "stale", placeholder: "Filter claims — date, doc, text" },
  chatTool: "atlas_report_stale_dates",
} as const satisfies ReportMeta;
