// Citation gate CLI — check that an Atlas-derived report cites every normative
// claim in context. Use on any report draft written to a file before it is
// published anywhere (file, remote, or the SAbR site).
//
//   node scripts/aux/report-cite-check.mjs <report.md> [<more.md> ...]
//   cat report.md | node scripts/aux/report-cite-check.mjs   # stdin
//   pnpm cite:check <report.md>
//
// Exit 0 when clean, 1 when any normative claim lacks an in-context Atlas
// citation. See scripts/lib/report-citations.mjs and CLAUDE.md “Citation dictate”.

import fs from "node:fs";
import { analyzeReportCitations, formatUncited } from "../lib/report-citations.mjs";

function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

const files = process.argv.slice(2).filter((a) => !a.startsWith("-"));
let failed = false;

if (files.length === 0) {
  const md = readStdin();
  if (!md.trim()) {
    console.error("Usage: node scripts/aux/report-cite-check.mjs <report.md> [...]  (or pipe markdown on stdin)");
    process.exit(2);
  }
  const { uncited } = analyzeReportCitations(md);
  console.log(formatUncited(uncited, "stdin"));
  failed = uncited.length > 0;
} else {
  for (const f of files) {
    const md = fs.readFileSync(f, "utf8");
    const { uncited } = analyzeReportCitations(md);
    console.log(formatUncited(uncited, f));
    if (uncited.length) failed = true;
  }
}

process.exit(failed ? 1 : 0);
