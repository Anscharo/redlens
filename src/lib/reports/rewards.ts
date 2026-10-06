import type { ReportMeta } from "./types";

export const rewards = {
  id: "rewards",
  title: "Integrator Reward Relationships",
  description:
    "Every Distribution Reward and Integration Boost instance each Prime Agent has invoked — reward codes, partner names, and on-chain reward addresses.",
  group: "onchain",
  provenance: "live",
  scope: { label: "rewards", placeholder: "Filter instances — name, partner, address" },
  chatTool: "atlas_report_rewards",
} as const satisfies ReportMeta;
