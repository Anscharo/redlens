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
    `${summary.resolvedByContainment ?? 0} reverse∩containment + ${summary.resolvedByLlm} LLM∩matcher` +
    `${(summary.frontierCalls || summary.frontierCached) ? ` + ${summary.resolvedByFrontier} frontier∩signal` : ""})`,
  );
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
      ...summary.llm, concurrency,
      ...(summary.frontierCalls ? { frontier: summary.frontier } : {}),
    },
    count: decisions.length,
    decisions,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(file, null, 2));
}

// Frontier HINTS (uncorroborated frontier picks) — surfaced in the curation UI as a
// suggested predecessor + reasoning the human confirms. Static, gitignored, never on the
// build path; lets the page drop its live LLM call (everything is pre-computed offline).
export function writeProposals(outPath, model, proposals) {
  const map = {};
  for (const p of proposals) map[p.caseKey] = { chosenKey: p.chosenKey, why: p.why };
  const file = { kind: "html-era-curation-proposals", source: "frontier", model, count: proposals.length, proposals: map };
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

export function writeLlmCache(outPath, cache) {
  const file = { kind: "html-era-curation-llm-cache", count: cache.size, entries: Object.fromEntries(cache) };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(file, null, 2));
}
