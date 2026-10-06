// Paired bootstrap of every briefing arm against the `none` arm, and the JSON report.
import fs from "node:fs";
import path from "node:path";
import type { RetrievalQuery } from "./eval-retrieval-queries.ts";
import { formatBootstrap, pairedBootstrap, type BootstrapResult } from "./eval-bootstrap.ts";
import type { ArmResult } from "./eval-retrieval-report.ts";
import { BACKEND, BRIEFING_ARMS, HYBRID, K, NEEDS_BRIEFINGS, OUT, PREFIX, QUERY_STYLE, ROOT, BRIEFING_FILE } from "./eval-retrieval-flags.ts";

interface BootstrapRow extends BootstrapResult {
  arm: string;
  vs: "none";
  policy: string;
  cap: number | null;
  crumb: string | number | null;
  model: string;
  metric: "exact" | "hit";
  slice: string | null;
}

// Both arms scored the same queries (same pool), so rows pair by index. Per slice
// only where n >= 15: below that the interval says nothing a reader should act on.
const SLICE_MIN = 15;
// Arms of one policy, cap, crumb setting and model share a baseline.
const armKey = (r: ArmResult) => `${r.policy}|${r.cap}|${r.crumb_strategy}|${r.crumb_depth}|${r.model}`;
const armLabel = (r: ArmResult) => (r.briefing_text ? `${r.briefings}:${r.briefing_text}` : r.briefings);

function bootstrapRival(base: ArmResult, rival: ArmResult, out: BootstrapRow[]): void {
  const label = armLabel(rival);
  for (const metric of ["exact", "hit"] as const) {
    const scopes: (string | null)[] = [null, ...new Set(base.per_query.map((p) => p.slice))];
    for (const slice of scopes) {
      const rows = base.per_query.flatMap((p, i) =>
        slice === null || p.slice === slice ? [{ [label]: rival.per_query[i]![metric], none: p[metric] }] : [],
      );
      if (slice !== null && rows.length < SLICE_MIN) continue;
      const r = pairedBootstrap(rows, label, "none");
      console.log(`  ${metric.padEnd(5)} ${(slice ?? "overall").padEnd(20)} n=${String(r.n).padStart(3)}  ${formatBootstrap(label, "none", r)}`);
      out.push({ ...r, arm: label, vs: "none", policy: base.policy, cap: base.cap, crumb: base.crumb_strategy ?? base.crumb_depth, model: base.model, metric, slice });
    }
  }
}

export function runBootstrap(results: ArmResult[]): BootstrapRow[] {
  const bootstrapRows: BootstrapRow[] = [];
  if (NEEDS_BRIEFINGS && !BRIEFING_ARMS.includes("none")) {
    console.log("\nno bootstrap: add `none` to --briefings to pair each briefing arm with its baseline.");
  }
  for (const base of results.filter((r) => r.briefings === "none")) {
    const rivals = results.filter((r) => r.briefings !== "none" && armKey(r) === armKey(base));
    if (rivals.length === 0) continue;
    console.log(
      `\npaired bootstrap vs none — policy=${base.policy} cap=${base.cap ?? "none"} crumb=${base.crumb_strategy ?? base.crumb_depth ?? "none"} model=${base.model} (pool=${base.pool}, ${base.per_query.length} queries scored)`,
    );
    if (base.per_query.length === 0) {
      console.log("  no queries scored; nothing to bootstrap.");
      continue;
    }
    for (const rival of rivals) bootstrapRival(base, rival, bootstrapRows);
  }
  return bootstrapRows;
}

export function writeReport(
  queries: RetrievalQuery[],
  results: ArmResult[],
  bootstrap: BootstrapRow[],
  pool: "all" | "covered",
  briefingDocs: number,
): void {
  const report = {
    generated_at: new Date().toISOString(),
    backend: BACKEND,
    k: K,
    hybrid: HYBRID,
    prefix: PREFIX || null,
    query_style: QUERY_STYLE,
    pool,
    briefing_file: briefingDocs > 0 ? path.relative(ROOT, BRIEFING_FILE) : null,
    briefing_documents: briefingDocs,
    query_count: queries.length,
    queries: queries.map((q) => ({
      id: q.id,
      slice: q.slice,
      query: q.query,
      ...(q.differential !== undefined ? { differential: q.differential } : {}),
    })),
    results,
    bootstrap,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`wrote ${OUT}`);
}
