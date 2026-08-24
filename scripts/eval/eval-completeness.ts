// Class-completeness tool-choice eval (docs/plans/chat-class-completeness.md Phase 4).
// Scores whether a trace listed the class (atlas_filter / class-mode atlas_first_seen)
// instead of answering a superlative from ranked search. The tool-choice arm runs
// on traces without a judge. Live chains run only when OPENROUTER_API_KEY is set.
import fs from "node:fs";
import path from "node:path";
import { scoreCompletenessToolChoice, type ToolChoiceCall } from "../../src/server/chat/verify/completeness.ts";
import { COMPLETENESS_QUERIES, INCIDENT_UUID } from "./eval-completeness-queries.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const REPORT_PATH = path.join(ROOT, ".cache", "eval-completeness.json");

const incident = COMPLETENESS_QUERIES[0]!;

const fixtures: { id: string; q: string; calls: ToolChoiceCall[]; expectPass: boolean }[] = [
  {
    id: "incident-search-then-ids",
    q: incident.q,
    expectPass: false,
    calls: [
      { name: "atlas_search", args: { query: "rate limit", k: 10 } },
      { name: "atlas_first_seen", args: { ids: ["a", "b", "c"] } },
    ],
  },
  {
    id: "incident-class-mode",
    q: incident.q,
    expectPass: true,
    calls: [{ name: "atlas_first_seen", args: { title: "Rate Limit" } }],
  },
  {
    id: "listing-complete-filter",
    q: "What are all rate limit ids in the atlas?",
    expectPass: true,
    calls: [{ name: "atlas_filter", args: { title: "Rate Limit" }, result: { total: 400, has_more: false } }],
  },
  {
    id: "listing-has-more",
    q: "What are all rate limit ids in the atlas?",
    expectPass: false,
    calls: [{ name: "atlas_filter", args: { title: "Rate Limit" }, result: { total: 400, has_more: true } }],
  },
];

const rows = fixtures.map((f) => {
  const scored = scoreCompletenessToolChoice(f.q, f.calls);
  return { ...f, pass: scored.pass, reason: scored.reason, ok: scored.pass === f.expectPass };
});

const failed = rows.filter((r) => !r.ok);
console.log(`tool-choice fixtures: ${rows.length} (${rows.filter((r) => r.ok).length} ok)`);
for (const r of rows) {
  console.log(`  ${r.ok ? "ok" : "FAIL"} ${r.id}: ${r.reason}`);
}
console.log(`incident UUID lock: ${INCIDENT_UUID} (older than 2026-07-10)`);

if (!process.env.OPENROUTER_API_KEY) {
  console.log("\n(no OPENROUTER_API_KEY — skipped live default/strong chains; tool-choice fixtures still scored)");
} else {
  console.log("\nOPENROUTER_API_KEY is set — live chain scoring is left to eval:bakeoff (incident query).");
}

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify({ fixtures: rows, incidentUuid: INCIDENT_UUID }, null, 2));
console.log(`\nwrote ${path.relative(ROOT, REPORT_PATH)}`);

if (failed.length) {
  console.error(`\n${failed.length} fixture(s) scored wrong`);
  process.exit(1);
}
