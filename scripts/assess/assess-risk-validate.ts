// Response validation for the risk-rules assessment. Hand-rolled (no
// response_format — support is inconsistent across the target models); the
// error string doubles as the corrective retry message.

import type { Rating } from "../../src/lib/oeaAssessment";
import type { Preciseness, RiskRating } from "../../src/lib/riskAssessment";
import { stripFences, resolveUuid } from "./assess-common";

const RATINGS = new Set<Rating>(["weak", "mid", "strong"]);

export type RatingValidation =
  | { ok: true; value: RiskRating }
  // citationOnly carries the otherwise-valid rating so the caller can apply
  // the downgrade-to-weak fallback after retries are exhausted.
  | { ok: false; error: string; citationOnly?: boolean; value?: RiskRating };

export function validateRating(
  raw: string,
  docIds: Set<string>,
  byPrefix: Map<string, string | null>,
): RatingValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (err) {
    return { ok: false, error: `not valid JSON: ${(err as Error).message}` };
  }
  const r = parsed as RiskRating;
  const errors: string[] = [];
  if (typeof r?.description !== "string" || !r.description.trim())
    errors.push("description must be a non-empty string");
  if (!Number.isInteger(r?.preciseness) || r.preciseness < 1 || r.preciseness > 5)
    errors.push("preciseness must be an integer 1-5");
  if (typeof r?.precisenessReasoning !== "string" || !r.precisenessReasoning.trim())
    errors.push("precisenessReasoning must be a non-empty string");
  if (!Array.isArray(r?.metrics) || r.metrics.some((m) => typeof m !== "string"))
    errors.push("metrics must be an array of strings");
  if (!RATINGS.has(r?.enforcement)) errors.push("enforcement must be weak|mid|strong");
  if (typeof r?.enforcementReasoning !== "string" || !r.enforcementReasoning.trim())
    errors.push("enforcementReasoning must be a non-empty string");
  if (!Array.isArray(r?.mechanismUuids) || r.mechanismUuids.some((u) => typeof u !== "string"))
    errors.push("mechanismUuids must be an array of strings");
  if (errors.length) return { ok: false, error: errors.join("; ") };

  // Rubric: a mid/strong enforcement rating without a cited mechanism is invalid.
  const resolved = r.mechanismUuids
    .map((u) => resolveUuid(u, docIds, byPrefix))
    .filter((u): u is string => u !== null);
  const value: RiskRating = {
    description: r.description.trim().slice(0, 300),
    preciseness: r.preciseness as Preciseness,
    precisenessReasoning: r.precisenessReasoning.trim(),
    metrics: r.metrics,
    enforcement: r.enforcement,
    mechanismUuids: resolved,
    enforcementReasoning: r.enforcementReasoning.trim(),
  };
  if (r.enforcement !== "weak" && resolved.length === 0) {
    return {
      ok: false,
      citationOnly: true,
      value: { ...value, mechanismUuids: [] },
      error: `enforcement rated ${r.enforcement} but no citation resolves to a real atlas doc uuid — cite a mechanism from the rubric's catalog or rate weak with "none found"`,
    };
  }
  return { ok: true, value };
}

// Conservative fallback when retries fail on the citation rule alone
// (rubric: no citable mechanism is always weak).
export function downgradeEnforcement(r: RiskRating): RiskRating {
  return {
    ...r,
    enforcement: "weak",
    mechanismUuids: [],
    enforcementReasoning: `${r.enforcementReasoning} [downgraded from ${r.enforcement}: no valid mechanism citation]`,
  };
}
