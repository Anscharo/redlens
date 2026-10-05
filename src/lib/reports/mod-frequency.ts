import type { ReportMeta } from "./types";

export const modFrequency = {
  id: "mod-frequency",
  title: "Modification Frequency",
  description:
    "An edit timeline by month, week, or commit, a per-section and per-type share matching a typed ≤/> edit-count filter (with the Agent Scope split out by agent, each downloadable separately), and the matching document list.",
  group: "health",
  provenance: "live",
  scope: { label: "modfreq", placeholder: "Filter docs — doc no, title, type, section" },
} as const satisfies ReportMeta;
