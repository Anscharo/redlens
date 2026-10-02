import type { ReportGroupKey } from "./types";

export interface ReportGroupDef {
  key: ReportGroupKey;
  title: string;
  /** One line under the heading saying what the group is for. */
  hint: string;
}

/**
 * The /reports index sections, in display order. Grouped by subject — what each
 * report is about — because that is how people browse; provenance rides along
 * as a per-card badge so neither axis distorts the other.
 */
export const REPORT_GROUP_DEFS: ReportGroupDef[] = [
  { key: "roles", title: "Roles & duties", hint: "Who the Atlas obliges to do what." },
  { key: "onchain", title: "On-chain & money", hint: "Addresses the Atlas names and the reward relationships it records." },
  { key: "rules", title: "Rules & risk", hint: "The constraints the Atlas places on behaviour." },
  { key: "structure", title: "Atlas structure", hint: "How the Atlas is put together and what it contains." },
  { key: "health", title: "Atlas health", hint: "Whether the Atlas is accurate, current, and how it is changing." },
];
