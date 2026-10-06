// Curated, model-ready atlas reports — each is its own tool (atlas_report_*)
// rather than one `atlas_report` dispatcher, so every report advertises only its
// own focused description + response shape (a caller never has to infer it).
// Order here is the order MCP lists them and the system prompt's Tools section.
import type { ReportTool } from "./report-tool.ts";
import { multisigsTool } from "./multisigs.ts";
import { primitiveMatrixTool } from "./primitive-matrix.ts";
import { facilitatorResponsibilitiesTool } from "./facilitator-responsibilities.ts";
import { govOpsResponsibilitiesTool } from "./govops-responsibilities.ts";
import { rewardsTool } from "./rewards.ts";
import { activeDataTool } from "./active-data.ts";
import { staleDatesTool } from "./stale-dates.ts";
import { processesTool } from "./processes.ts";
import { oeaAssessmentTool } from "./oea-assessment.ts";
import { riskRulesTool } from "./risk-rules.ts";
import { onchainAddressesTool } from "./onchain-addresses.ts";

export const REPORT_TOOLS: readonly ReportTool[] = [
  multisigsTool,
  primitiveMatrixTool,
  facilitatorResponsibilitiesTool,
  govOpsResponsibilitiesTool,
  rewardsTool,
  activeDataTool,
  staleDatesTool,
  processesTool,
  oeaAssessmentTool,
  riskRulesTool,
  onchainAddressesTool,
];
