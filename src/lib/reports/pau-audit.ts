import type { ReportMeta } from "./types";

export const pauAudit = {
  id: "pau-audit",
  title: "PAU Values Needing Audit",
  description:
    "Every Prime Agent PAU value, controller and role claim where the Atlas and the chain disagree or cannot be compared, grouped by why: the Atlas is probably out of date, a spell may not have executed yet, the Atlas lacks the detail to check, a registry conflict, or ambiguous. With CSV export.",
  group: "onchain",
  provenance: "live",
  scope: { label: "pau", placeholder: "Filter PAU values — prime, chain, instance, value, reason, doc" },
} as const satisfies ReportMeta;
