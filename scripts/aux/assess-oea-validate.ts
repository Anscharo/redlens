// Response validation for the OEA assessment. Hand-rolled (no response_format:
// json_schema — support is inconsistent across the target models); the error
// string doubles as the corrective retry message.

import { PRECISION_ELEMENTS, type Assessment } from "../../src/lib/oeaAssessment";
import { stripFences, resolveUuid } from "./assess-common";

export type ValidationResult =
  | { ok: true; value: Assessment }
  // citationOnly carries the otherwise-valid assessment so the caller can
  // apply the downgrade-to-weak fallback after retries are exhausted.
  | { ok: false; error: string; citationOnly?: boolean; value?: Assessment };

const RATINGS = new Set(["weak", "mid", "strong"]);
const STATES = new Set(["present", "partial", "absent"]);

export function validateAssessment(
  raw: string,
  docIds: Set<string>,
  byPrefix: Map<string, string | null>,
): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (err) {
    return { ok: false, error: `not valid JSON: ${(err as Error).message}` };
  }
  const a = parsed as Assessment;
  const errors: string[] = [];
  if (!RATINGS.has(a?.precision?.rating)) errors.push("precision.rating must be weak|mid|strong");
  if (typeof a?.precision?.reasoning !== "string" || !a.precision.reasoning.trim())
    errors.push("precision.reasoning must be a non-empty string");
  for (const k of PRECISION_ELEMENTS) {
    if (!STATES.has(a?.precision?.elements?.[k]))
      errors.push(`precision.elements.${k} must be present|partial|absent`);
  }
  if (!RATINGS.has(a?.incentives?.rating)) errors.push("incentives.rating must be weak|mid|strong");
  if (typeof a?.incentives?.reasoning !== "string" || !a.incentives.reasoning.trim())
    errors.push("incentives.reasoning must be a non-empty string");
  if (!Array.isArray(a?.incentives?.mechanismUuids) || a.incentives.mechanismUuids.some((u) => typeof u !== "string"))
    errors.push("incentives.mechanismUuids must be an array of strings");
  if (errors.length) return { ok: false, error: errors.join("; ") };

  // Rubric: a mid/strong incentives rating without a cited mechanism is invalid.
  const resolved = a.incentives.mechanismUuids
    .map((u) => resolveUuid(u, docIds, byPrefix))
    .filter((u): u is string => u !== null);
  if (a.incentives.rating !== "weak" && resolved.length === 0) {
    return {
      ok: false,
      citationOnly: true,
      value: { ...a, incentives: { ...a.incentives, mechanismUuids: [] } },
      error: `incentives rated ${a.incentives.rating} but no citation resolves to a real atlas doc uuid — cite a mechanism from the catalog or rate weak with "none found"`,
    };
  }
  return {
    ok: true,
    value: { ...a, incentives: { ...a.incentives, mechanismUuids: resolved } },
  };
}

// Conservative fallback when retries fail on the citation rule alone
// (rubric: the catch-all / no mechanism is always weak).
export function downgradeToWeak(a: Assessment): Assessment {
  return {
    ...a,
    incentives: {
      rating: "weak",
      mechanismUuids: [],
      reasoning: `${a.incentives.reasoning} [downgraded from ${a.incentives.rating}: no valid mechanism citation]`,
    },
  };
}
