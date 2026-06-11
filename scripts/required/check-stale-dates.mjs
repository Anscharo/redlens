#!/usr/bin/env bun
/**
 * Stale-dates check — CLI/worker twin of the /reports/stale-dates page.
 *
 * Reuses src/lib/staleDates.ts (Bun runs the TS import directly, same as
 * build-history with history-db.ts) against public/docs.json and the actual
 * current date. The atlas worker runs this every cron cycle BEFORE its
 * early-exit gate, so the log tracks staleness daily even when the atlas
 * itself hasn't moved.
 *
 * Output: stdout summary + per-claim lines for stale and due-soon buckets;
 * `[drift] stale-dates:` warnings on stderr so a future hookup to the
 * atlas-drift issue pipeline needs no changes here. Always exits 0.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildStaleDatesReport } from "../../src/lib/staleDates";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOCS = path.join(ROOT, "public/docs.json");

if (!fs.existsSync(DOCS)) {
  console.warn("stale-dates: public/docs.json not built — skipping");
  process.exit(0);
}

const docs = JSON.parse(fs.readFileSync(DOCS, "utf8")).nodes;
const report = buildStaleDatesReport(docs);

console.log(
  `stale-dates: ${report.totalDateMentions} dated mentions — ` +
    `${report.stale.length} stale, ${report.dueSoon.length} due within 7d, ` +
    `${report.upcoming.length} upcoming`,
);
for (const c of report.stale) {
  console.log(`  STALE ${c.dateISO} (${-c.daysUntilStale}d overdue) ${c.docNo} — ${c.title}`);
}
for (const c of report.dueSoon) {
  console.log(`  DUE   ${c.dateISO} (in ${c.daysUntilStale}d) ${c.docNo} — ${c.title}`);
}
if (report.stale.length) {
  console.warn(
    `[drift] stale-dates: ${report.stale.length} future-tense claim(s) with past dates ` +
      `(oldest: ${report.stale[0].dateISO} ${report.stale[0].docNo})`,
  );
}
