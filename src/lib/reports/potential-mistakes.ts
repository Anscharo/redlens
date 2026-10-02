import type { ReportMeta } from "./types";

export const potentialMistakes = {
  id: "potential-mistakes",
  title: "Potential Mistakes",
  description:
    "Suspected defects in the Atlas source text — typos, grammar slips, broken cross-references, wrong figures and internal contradictions, each quoted and linked to its document. Not an atlas concept and not a build artifact: an LLM-generated sweep that is re-run by hand, so findings can lag the current Atlas.",
  group: "health",
  provenance: "ai-assessed",
  scope: { label: "mistakes", placeholder: "Filter findings — doc no, title, quoted text, issue" },
} as const satisfies ReportMeta;
