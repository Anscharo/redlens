#!/usr/bin/env node
/**
 * `pnpm settlements:parse` — read Soter Labs MSC settlement xlsx files
 * into public/settlements.json and print coverage / reconciliation stats.
 *
 * DELIBERATELY NOT PART OF `pnpm build`. The build is offline and
 * deterministic (REPRO=1); fetching settlement-reports would make the
 * same atlas SHA produce different artifacts. Run this by hand, or let
 * the Docker image bake `dist/settlements.json` after `build:vite`.
 * A fetch failure there is a warning, not a failed image.
 *
 * Flags:
 *   --dir <path>  local reports/ tree or settlement-reports checkout
 *                 (default: fetch github.com/soterlabs/settlement-reports@main)
 *   --out <path>  JSON destination (default: public/settlements.json)
 *   --dry-run     parse and print stats, write nothing
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { parseReportsDir, parseWorkbook, reconcile } from "../lib/settlement-xlsx.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARCHIVE_URL =
  "https://github.com/soterlabs/settlement-reports/archive/refs/heads/main.tar.gz";
const THRESHOLD = 1;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const dirFlag = flagValue(argv, "--dir");
const outFlag = flagValue(argv, "--out");
const outPath = path.resolve(ROOT, outFlag ?? "public/settlements.json");

function flagValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`usage: pnpm settlements:parse [--dir <path>] [--out <path>] [--dry-run]`);
    process.exit(1);
  }
  return v;
}

function usd(n) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function fetchReportsTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "settlement-reports-"));
  const tgz = path.join(tmp, "src.tgz");
  const res = await fetch(ARCHIVE_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`fetch ${ARCHIVE_URL}: ${res.status} ${res.statusText}`);
  fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  await execFileAsync("tar", ["-xzf", tgz, "-C", tmp]);
  const extracted = fs
    .readdirSync(tmp, { withFileTypes: true })
    .find((e) => e.isDirectory() && e.name.startsWith("settlement-reports-"));
  if (!extracted) throw new Error(`tarball from ${ARCHIVE_URL} had no settlement-reports-* dir`);
  return {
    reportsDir: path.join(tmp, extracted.name, "reports"),
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
    source: { fetched: ARCHIVE_URL },
  };
}

function printStats(bundle) {
  const { reports } = bundle;
  const primes = [...new Set(reports.map((r) => r.prime))];
  const months = [...new Set(reports.map((r) => r.month))].sort();
  console.log(`reports: ${reports.length}`);
  console.log(`primes:  ${primes.join(", ")}`);
  console.log(`months:  ${months[0] ?? "—"} … ${months[months.length - 1] ?? "—"} (${months.length})`);
  console.log("");
  console.log("venues (PnL rows, synthetic included):");
  for (const p of primes) {
    const rs = reports.filter((r) => r.prime === p);
    const counts = rs.map((r) => r.venues.length);
    const synth = rs.reduce((n, r) => n + r.venues.filter((v) => v.synthetic).length, 0);
    console.log(
      `  ${p.padEnd(10)} months=${String(rs.length).padStart(2)}  ` +
        `venues/month ${Math.min(...counts)}–${Math.max(...counts)}  synthetic=${synth}`,
    );
  }
  console.log("");
  console.log(
    `reconciliation (|Σ P2S − skyRevenue| and |Σ P2G − Comparison total|; flag > ${usd(THRESHOLD)}):`,
  );
  let flags = 0;
  for (const r of reports) {
    const rec = reconcile(r);
    const bad = rec.dSky > THRESHOLD || rec.dP2G > THRESHOLD;
    if (bad) flags++;
    const mark = bad ? "  FLAG" : "";
    const gap =
      rec.dRevenue > THRESHOLD ? `  revenueGap=${usd(rec.dRevenue)}` : "";
    console.log(
      `  ${r.prime}/${r.month}  dSky=${usd(rec.dSky)}  dP2G=${usd(rec.dP2G)}` +
        `  venues=${r.venues.length}${gap}${mark}`,
    );
  }
  console.log(`flags: ${flags} / ${reports.length}`);
  console.log("(revenueGap = |Σ venue.revenueToPrime − primeAgentRevenue|; Spark's is the non-venue PSM3 slice)");

  const sparkJul = reports.find((r) => r.prime === "spark" && r.month === "2026-07");
  if (sparkJul) {
    const top = [...sparkJul.venues]
      .sort((a, b) => Math.abs(b.profitToSky) - Math.abs(a.profitToSky))
      .slice(0, 8);
    console.log("");
    console.log("spark/2026-07 top |Profit to Sky|:");
    for (const v of top) {
      console.log(`  ${v.id.padEnd(18)} ${usd(v.profitToSky).padStart(16)}  ${v.label}`);
    }
  }
}

async function parseOneXlsx(file) {
  const report = await parseWorkbook(fs.readFileSync(file), {
    prime: path.basename(file),
    month: null,
  });
  return { source: { file }, reports: [report] };
}

async function main() {
  let cleanup = () => {};
  try {
    let bundle;
    if (dirFlag) {
      const abs = path.resolve(dirFlag);
      if (abs.endsWith(".xlsx") && fs.statSync(abs).isFile()) {
        bundle = await parseOneXlsx(abs);
      } else {
        bundle = await parseReportsDir(abs, { dir: abs });
      }
    } else {
      const fetched = await fetchReportsTree();
      cleanup = fetched.cleanup;
      bundle = await parseReportsDir(fetched.reportsDir, fetched.source);
    }

    printStats(bundle);

    if (!dryRun) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2) + "\n");
      console.log("");
      console.log(`wrote ${path.relative(ROOT, outPath)}`);
    }
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
