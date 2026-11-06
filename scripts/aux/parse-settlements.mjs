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
 *   --quiet       one summary line instead of the full stats dump (dev-preflight)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { parseReportsDir, parseWorkbook, reconcile } from "../lib/settlement-xlsx.mjs";
import { printStats, THRESHOLD } from "./settlement-stats-print.ts";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARCHIVE_URL =
  "https://github.com/soterlabs/settlement-reports/archive/refs/heads/main.tar.gz";
// Both callers run unattended — `pnpm dev`'s preflight and the Docker image
// build — so a network that accepts the connection and then stalls must not
// hang the boot/build forever. Failure is already tolerated by both.
const FETCH_TIMEOUT_MS = 60_000;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const quiet = argv.includes("--quiet");
const dirFlag = flagValue(argv, "--dir");
const outFlag = flagValue(argv, "--out");
const outPath = path.resolve(ROOT, outFlag ?? "public/settlements.json");

function flagValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`usage: pnpm settlements:parse [--dir <path>] [--out <path>] [--dry-run] [--quiet]`);
    process.exit(1);
  }
  return v;
}

async function fetchReportsTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "settlement-reports-"));
  const tgz = path.join(tmp, "src.tgz");
  const res = await fetch(ARCHIVE_URL, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
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

/** One line for unattended callers: coverage plus the reconcile flag count. */
function printSummary(bundle, dest) {
  const { reports } = bundle;
  const primes = [...new Set(reports.map((r) => r.prime))].sort();
  const months = [...new Set(reports.map((r) => r.month))].sort();
  const flags = reports.filter((r) => {
    const rec = reconcile(r);
    return rec.dSky > THRESHOLD || rec.dP2G > THRESHOLD || rec.dCof > THRESHOLD;
  }).length;
  console.log(
    `settlements: ${reports.length} reports · ${primes.length} primes (${primes.join(", ")}) · ` +
      `${months[0] ?? "—"} … ${months[months.length - 1] ?? "—"} · ${flags} reconcile flag(s)` +
      (dest ? ` → ${dest}` : ""),
  );
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

    if (!quiet) printStats(bundle);

    if (!dryRun) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2) + "\n");
    }
    if (quiet) {
      printSummary(bundle, dryRun ? null : path.relative(ROOT, outPath));
    } else if (!dryRun) {
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
