// File-write + console-report helpers for the HTML-era auto-curator, shared by the
// standalone tool and `build-history-curation.mjs --auto` so both emit an identical
// decisions file + summary. The decisions file is apply-ready (the shape the curation
// UI exports, consumed by `pnpm htmlhist:apply`) and the curation UI's pre-fill baseline.

import fs from "node:fs";
import path from "node:path";

const tallyByKind = (list) => list.reduce((m, c) => ((m[c.kind] = (m[c.kind] || 0) + 1), m), {});

export function reportAutoCuration(data, decisions, summary) {
  const resolvedKeys = new Set(decisions.map((d) => d.caseKey));
  const full = {
    ...summary,
    resolvedByKind: tallyByKind((data.cases || []).filter((c) => resolvedKeys.has(c.key))),
    residualByKind: tallyByKind((data.cases || []).filter((c) => !resolvedKeys.has(c.key))),
  };
  console.error("\n=== auto-curation ===");
  console.error(JSON.stringify(full, null, 2));
  console.error(
    `\nhand-review queue: ${summary.totalCases} → ${summary.residual}  ` +
    `(${summary.reductionPct}% auto-resolved: ${summary.resolvedByForwardReverse} forward∩reverse + ` +
    `${summary.resolvedByContainment ?? 0} reverse∩containment + ` +
    `${summary.resolvedByPositional ? `${summary.resolvedByPositional} positional∩signal + ` : ""}` +
    `${summary.resolvedByCluster ? `${summary.resolvedByCluster} cluster∩families + ` : ""}${summary.resolvedByLlm} LLM∩matcher` +
    `${(summary.frontierCalls || summary.frontierCached) ? ` + ${summary.resolvedByFrontier} frontier∩signal` : ""})` +
    `${summary.positionalHints ? `  ·  ${summary.positionalHints} positional hints (advisory)` : ""}`,
  );
  if (summary.conflictsDemoted) {
    console.error(`conflict sweep: ${summary.conflictsDemoted} double-booked claim(s) demoted to residual (kept the strongest per older occurrence)`);
  }
  if (summary.cluster?.multiClusters) {
    const c = summary.cluster;
    console.error(
      `cluster (${(c.models || []).join(" ∩ ")}): ${c.multiClusters} multi-clusters → ` +
      `${c.locked} locked + ${c.lockedNone} created-here · ${c.disagreed} residual/disagreed · ${c.conflicts} conflicts` +
      `${c.windowed ? ` · ${c.windowed} oversized handled via windowed decomposition` : ""}`,
    );
  }
  if (summary.frontierCalls || summary.frontierCached) {
    console.error(
      `frontier (${summary.frontierModel}): ${summary.frontierCalls} new + ${summary.frontierCached ?? 0} cached → ` +
      `${summary.resolvedByFrontier} locked + ${summary.frontierHints} hints` +
      `${summary.frontier?.limited ? ` · ${summary.frontier.limited} still uncached (re-run --frontier to continue)` : ""}`,
    );
  }
}

export function writeAutoDecisions(outPath, data, decisions, summary, concurrency) {
  const file = {
    kind: "html-era-history-decisions",
    source: "auto-curate",
    builtFrom: { migrationSha: data.meta?.migrationSha, lastHtmlSha: data.meta?.lastHtmlSha },
    auto: {
      forwardReverse: summary.resolvedByForwardReverse,
      containment: summary.resolvedByContainment,
      ...(summary.resolvedByPositional ? { positional: summary.resolvedByPositional } : {}),
      ...(summary.positionalHints ? { positionalHints: summary.positionalHints } : {}),
      ...(summary.conflictsDemoted ? { conflictsDemoted: summary.conflictsDemoted } : {}),
      ...(summary.cluster?.multiClusters ? { cluster: summary.cluster } : {}),
      ...summary.llm, concurrency,
      ...(summary.frontierCalls ? { frontier: summary.frontier } : {}),
    },
    count: decisions.length,
    decisions,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(file, null, 2));
}

// HINTS — uncorroborated suggested predecessors surfaced in the curation UI as a suggested
// predecessor + reasoning the human confirms. Two sources share this file: the opt-in
// frontier model (pass 3) and the deterministic positional pass (self-corroborated picks on
// matcher-null residual). Each entry keeps its `via` so the UI can show provenance. Static,
// gitignored, never on the build path; lets the page drop its live LLM call.
export function writeProposals(outPath, model, proposals) {
  const map = {};
  for (const p of proposals) map[p.caseKey] = { chosenKey: p.chosenKey, why: p.why, via: p.via || "frontier" };
  const file = { kind: "html-era-curation-proposals", source: "frontier+positional", model, count: proposals.length, proposals: map };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(file, null, 2));
}

// Resume cache: a prior run's LLM/frontier asks, keyed `${pass}|${caseKey}` → {chosenKey, why,
// model}. Loading it lets a capped run REUSE earlier results (no re-spend) and spend the cap on
// new cases only, so the frontier can be completed in batches across sessions/deploys. Stable
// because caseKeys are content-addressed; a model swap re-asks just that pass (per-entry model).
export function loadLlmCache(inPath) {
  try {
    const file = JSON.parse(fs.readFileSync(inPath, "utf8"));
    return new Map(Object.entries(file.entries || {}));
  } catch {
    return new Map();
  }
}

// Atomic write (temp + rename) so a crash/interrupt mid-write can't truncate the cache — a
// half-written cache would silently lose every prior ask on the next resume.
export function writeLlmCache(outPath, cache) {
  const file = { kind: "html-era-curation-llm-cache", count: cache.size, entries: Object.fromEntries(cache) };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
  fs.renameSync(tmp, outPath);
}
