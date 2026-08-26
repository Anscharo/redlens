// Provenance for Monthly Settlement Cycle data. This is NOT Atlas text and
// must never be presented as such — chat, MCP, and the verifier all key off
// these fields.

export const MSC_SOURCE_CLASS = "external" as const;

export const MSC_REQUIRED_DISCLAIMER =
  "These figures are not from the Sky Atlas. They come from Soter Labs Monthly Settlement Cycle workbooks (OEA calculations, not the on-chain GovOps spell) and, when linked, the Sky Forum post for that cycle.";

export const SOTER_REPORTS_REPO = "https://github.com/soterlabs/settlement-reports";

export function workbookUrl(prime: string, month: string): string {
  return `${SOTER_REPORTS_REPO}/tree/main/reports/${prime}/${month}`;
}

export type MscSourceRow =
  | { kind: "soter_workbook"; prime: string; month: string; url: string }
  | { kind: "sky_forum"; title: string; url: string; posted_at: string | null }
  | { kind: "soter_pipeline"; note: string };

export interface MscEnvelope {
  source_class: typeof MSC_SOURCE_CLASS;
  not_atlas: true;
  required_disclaimer: string;
  sources: MscSourceRow[];
}

export function mscEnvelope(sources: MscSourceRow[]): MscEnvelope {
  return {
    source_class: MSC_SOURCE_CLASS,
    not_atlas: true,
    required_disclaimer: MSC_REQUIRED_DISCLAIMER,
    sources,
  };
}

/** True when the user-facing answer repeats the required non-Atlas attribution. */
export function answerHasMscDisclaimer(answer: string): boolean {
  const t = answer.toLowerCase();
  if (!t.includes("not from the") || !t.includes("atlas")) return false;
  return t.includes("soter") || t.includes("workbook") || t.includes("forum") || t.includes("oea");
}

export const ASK_EXTERNAL_MSC = "ask_external_msc"; // chat-only
export const EXTERNAL_MSC = "external_msc"; // MCP-only

export function isExternalMscTool(name: string): boolean {
  return name === ASK_EXTERNAL_MSC || name === EXTERNAL_MSC;
}
