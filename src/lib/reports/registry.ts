// Every report, one entry per file in this directory. Adding a report is a new
// entry file plus one line in REPORTS; ReportId, the route tables in routes.ts
// and the /reports index in reportCatalog.ts all derive from this list. Order
// here is the order within each index group.
import { activeData } from "./active-data";
import { crossview } from "./crossview";
import { govOpsResponsibilities } from "./gov-ops-responsibilities";
import { modFrequency } from "./mod-frequency";
import { oeaAssessment } from "./oea-assessment";
import { ofResponsibilities } from "./of-responsibilities";
import { onchainAddresses } from "./onchain-addresses";
import { potentialMistakes } from "./potential-mistakes";
import { processes } from "./processes";
import { rewards } from "./rewards";
import { riskRules } from "./risk-rules";
import { staleDates } from "./stale-dates";

export const REPORTS = [
  ofResponsibilities,
  govOpsResponsibilities,
  oeaAssessment,
  onchainAddresses,
  rewards,
  riskRules,
  processes,
  activeData,
  crossview,
  potentialMistakes,
  staleDates,
  modFrequency,
] as const;

export type ReportId = (typeof REPORTS)[number]["id"];

export const reportPath = (id: ReportId): string => `/reports/${id}`;
