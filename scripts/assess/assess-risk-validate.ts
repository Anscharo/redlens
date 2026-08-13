// Response validation for the risk-rules assessment. Hand-rolled (no
// response_format — support is inconsistent across the target models); the
// error string doubles as the corrective retry message.

import type { Rating } from "../../src/lib/oeaAssessment";
import type { RiskDomain } from "../../src/lib/riskRules";
import type { Preciseness, RiskTriage, RiskRating } from "../../src/lib/riskAssessment";
import { stripFences, resolveUuid } from "./assess-common";

const RATINGS = new Set<Rating>(["weak", "mid", "strong"]);
const DOMAINS = new Set<RiskDomain>(["peg", "alloc", "sc"]);

export type TriageValidation = { ok: true; value: RiskTriage } | { ok: false; error: string };

export function validateTriage(raw: string): TriageValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (err) {
    return { ok: false, error: `not valid JSON: ${(err as Error).message}` };
  }
  const t = parsed as RiskTriage;
  const errors: string[] = [];
  if (typeof t?.inScope !== "boolean") errors.push("inScope must be true|false");
  if (typeof t?.isRule !== "boolean") errors.push("isRule must be true|false");
  if (!Array.isArray(t?.domains) || t.domains.some((d) => !DOMAINS.has(d)))
    errors.push('domains must be an array drawn from "peg"|"alloc"|"sc"');
  if (typeof t?.description !== "string" || !t.description.trim())
    errors.push("description must be a non-empty string");
  if (t?.inScope === true && Array.isArray(t?.domains) && t.domains.length === 0)
    errors.push("inScope is true but domains is empty — name at least one domain");
  if (errors.length) return { ok: false, error: errors.join("; ") };
  return {
    ok: true,
    value: {
      inScope: t.inScope,
      isRule: t.isRule,
      domains: [...new Set(t.domains)],
      description: t.description.trim().slice(0, 300),
    },
  };
}

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
