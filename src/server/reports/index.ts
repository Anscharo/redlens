// Curated, model-ready atlas reports — each is its own tool (atlas_report_*)
// rather than one `atlas_report` dispatcher, so every report advertises only its
// own focused description + response shape (a caller never has to infer it).
// Each report module is a self-contained vertical slice too expensive for the
// LLM to assemble interactively from primitive graph calls, and exports its own
// tool descriptor (./report-tool.ts).
//
// Adding a report tool is a new module plus one line here. Order here is the
// order in ATLAS_TOOLS (what MCP lists) and in the system prompt's Tools section.
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
