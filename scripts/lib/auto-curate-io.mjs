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
    `${summary.resolvedByContainment ?? 0} reverse∩containment + ${summary.resolvedByLlm} LLM∩matcher)`,
  );
}

export function writeAutoDecisions(outPath, data, decisions, summary, concurrency) {
  const file = {
    kind: "html-era-history-decisions",
    source: "auto-curate",
    builtFrom: { migrationSha: data.meta?.migrationSha, lastHtmlSha: data.meta?.lastHtmlSha },
    auto: { forwardReverse: summary.resolvedByForwardReverse, ...summary.llm, concurrency },
    count: decisions.length,
    decisions,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(file, null, 2));
}
