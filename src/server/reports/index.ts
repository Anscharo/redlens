// Curated, model-ready atlas reports — each is its own MCP tool (atlas_report_*)
// rather than one `atlas_report` dispatcher, so every report advertises only its
// own focused description + response shape (a caller never has to infer it). Each
// builder is a self-contained vertical slice too expensive for the LLM to
// assemble interactively from primitive graph calls. This barrel just re-exports
// them for tool-registry.ts.
export { buildMultisigsReport } from "./multisigs.ts";
export { buildPrimitiveMatrixReport } from "./primitive-matrix.ts";
export { buildFacilitatorResponsibilitiesReport } from "./facilitator-responsibilities.ts";
export { buildGovOpsResponsibilitiesReport } from "./govops-responsibilities.ts";
export { buildRewardsReport } from "./rewards.ts";
export { buildActiveDataReport } from "./active-data.ts";
