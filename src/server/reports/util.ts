// Shared helpers for the atlas_report builders. Graph edge/entity meta and
// source_doc_nos arrive as JSON strings on the server Indexes; these normalize
// them defensively (never throw on malformed data — return empty).
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { fitToBudget, TRUNCATION_HINT } from "../chat/output-budget.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { parseMetaObject } from "../../lib/meta.ts";

// Reads a committed artifact (processes.json, oea-report.json, risk-assessment.json,
// …) out of public/ — the same flat directory the frontend fetches from, so the
// report builder reads exactly what the page would. Returns null rather than
// throwing on a missing/malformed file: a tool call should degrade to "nothing
// to report" (an empty report, not a 500), the same way a boot with no atlas
// artifacts yet degrades elsewhere in this server.
export function readPublicJson<T>(file: string, publicDir: string = config.publicDir): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(publicDir, file), "utf8")) as T;
  } catch {
    return null;
  }
}

export function parseMeta(raw: string | null): Record<string, unknown> {
  return parseMetaObject(raw) ?? {};
}

export { parseDocNos } from "../../lib/meta.ts";

// `total` counts every matching row; [payloadKey] holds those that fit the budget.
export function rowsEnvelope(
  report: string,
  rows: unknown[],
  payloadKey: string,
  extra: Record<string, unknown> = {},
): ToolResult {
  const { kept, truncated } = fitToBudget(rows);
  const result: ToolResult = { report, total: rows.length, returned: kept.length, truncated, ...extra, [payloadKey]: kept };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}
