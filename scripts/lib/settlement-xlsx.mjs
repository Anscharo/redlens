/**
 * Parse Soter Labs MSC settlement workbooks (the published xlsx under
 * settlement-reports/reports/<prime>/<YYYY-MM>/).
 *
 * The Venues tab is the load-bearing surface: it carries the CoF
 * re-attribution (CoF alloc / Profit to Sky / Profit to Grove) that
 * summary.md does not. Headers are matched by name, never by index —
 * a regrouped sheet must throw rather than silently shift columns.
 *
 * "Period inflow" on the sheet is value_eom − value_som (a proxy in
 * build_settlement_xlsx.py), not MSC period_inflow. Mapped as
 * positionDelta.
 *
 * See .claude/skills/settlement-reports/SKILL.md for what each reconcile()
 * delta actually detects (dCof is the load-bearing one), the fail-loud
 * Summary contract, and the known upstream blocks that do not foot.
 */

import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

export const VENUE_HEADERS = Object.freeze([
  "Venue",
  "Label",
  "Chain",
  "Pricing cat.",
  "Position SoM",
  "Position EoM",
  "Period inflow",
  "actual_revenue",
  "external_revenue",
  "revenue (to prime)",
  "sd_revenue (to Sky)",
  "Avg value",
  "Weight",
  "CoF alloc",
  "Profit to Sky",
  "Profit to Grove",
  "Utilized Deduction (avg)",
  "Spread Reimb",
  "Notes",
]);

export const SYNTHETIC_VENUE_IDS = Object.freeze(["SPREAD", "PSM_CURVE_DEDUCT"]);

/**
 * Summary rows this parser must find. `cellNum` returns 0 for a missing
 * cell and 0 is a LEGITIMATE value here (Keel/Skybase genuinely run at
 * CoF 0), so a renamed label is otherwise indistinguishable from a real
 * zero. Upstream already spells CoF two ways — "CoF on utilized" in the
 * xlsx, "prime cost of funds" in summary.md — so treat a miss as a
 * layout change and throw, exactly as parseVenues does for its headers.
 */
export const REQUIRED_SUMMARY_ROWS = Object.freeze([
  "prime_agent_revenue",
  "+ agent_rate",
  "CoF on utilized",
  "+ SDE revenue",
]);

/** Block totals (the unlabeled bold row that closes each Summary block). */
export const REQUIRED_SUMMARY_TOTALS = Object.freeze(["prime", "sky", "comparison"]);

const POSITION_ONLY_RE = /^position-only venues/i;
const SKIP_PRIMES = new Set(["non_msc", "sky_total"]);

export async function parseWorkbook(buffer, meta = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const venuesSheet = wb.getWorksheet("Venues");
  if (!venuesSheet) {
    throw new Error("settlement xlsx is missing a 'Venues' sheet");
  }
  const summarySheet = wb.getWorksheet("Summary");
  if (!summarySheet) {
    throw new Error("settlement xlsx is missing a 'Summary' sheet");
  }
  const { venues } = parseVenues(venuesSheet);
  const { headline, period, settleVersion, generatedAt } = parseSummary(summarySheet);
  return {
    prime: meta.prime ?? null,
    month: meta.month ?? null,
    settleVersion,
    generatedAt,
    period,
    headline,
    venues,
  };
}

export async function parseReportsDir(root, source = {}) {
  const reportsDir = resolveReportsDir(root);
  const files = listSettlementXlsx(reportsDir);
  if (files.length === 0) {
    throw new Error(`no *_settlement_*.xlsx under ${reportsDir}`);
  }
  const reports = [];
  for (const file of files) {
    const ident = identifyReport(reportsDir, file);
    if (!ident) continue;
    const report = await parseWorkbook(fs.readFileSync(file), ident);
    reports.push(report);
  }
  reports.sort((a, b) =>
    a.prime === b.prime ? a.month.localeCompare(b.month) : a.prime.localeCompare(b.prime),
  );
  return {
    source: { repo: "soterlabs/settlement-reports", ...source },
    reports,
  };
}

export function reconcile(report) {
  const p2s = sum(report.venues.map((v) => v.profitToSky));
  const p2g = sum(report.venues.map((v) => v.profitToGrove));
  const rev = sum(report.venues.map((v) => v.revenueToPrime));
  const cofAlloc = sum(report.venues.map((v) => v.cofAlloc));
  const spread = sum(report.venues.map((v) => v.spreadReimb));
  const h = report.headline;
  return {
    sumProfitToSky: p2s,
    sumProfitToGrove: p2g,
    sumRevenueToPrime: rev,
    sumCofAlloc: cofAlloc,
    sumSpreadReimb: spread,
    // dSky / dP2G restate the venue table against block totals derived from
    // that same table, so they are ~0 by construction and detect very
    // little. dCof is the one that bites: grove_sheet.py allocates the
    // GROSS CoF across venues and refunds the sUSDS spread inside Profit
    // to Sky, so Σ CoF alloc − Σ Spread Reimb ≡ headline.cof. A renamed
    // "CoF on utilized" label (which parses as 0) breaks it immediately.
    dSky: Math.abs(p2s - h.skyRevenue),
    dP2G: Math.abs(p2g - h.profitToGrove),
    dRevenue: Math.abs(rev - h.primeAgentRevenue),
    dCof: Math.abs(cofAlloc - spread - h.cof),
    // supplyKept is the prime's supply-side revenue as settlement-cycle
    // itself defines it (load/summary.py: prime_agent_revenue − prime_cof).
    // NOT Σ Profit to Grove: that sum drops prime-level revenue with no
    // venue row (PSM3 sUSDS appreciation) and the spread reimbursement.
    supplyKept: h.primeAgentRevenue - h.cof,
    // The workbook's Comparison block prints prime_agent_revenue and −CoF
    // as addends but totals them with Σ Profit to Grove, so it does not
    // foot. Informational, not a flag — it is an upstream rendering bug we
    // measure rather than one we can fix here.
    dComparisonFoot: Math.abs(h.primeAgentRevenue - h.cof - h.profitToGrove),
  };
}

function resolveReportsDir(root) {
  const abs = path.resolve(root);
  if (fs.existsSync(path.join(abs, "reports"))) return path.join(abs, "reports");
  return abs;
}

function listSettlementXlsx(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /_settlement_.*\.xlsx$/i.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

function identifyReport(reportsDir, file) {
  const rel = path.relative(reportsDir, file);
  const parts = rel.split(path.sep);
  if (parts.length < 3) return null;
  const prime = parts[0];
  const month = parts[1];
  if (SKIP_PRIMES.has(prime)) return null;
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return { prime, month };
}

function parseVenues(ws) {
  const headerRow = findVenueHeaderRow(ws);
  if (headerRow == null) {
    throw new Error("Venues sheet has no header row (expected a 'Venue' row containing 'Profit to Sky')");
  }
  const col = headerMap(ws.getRow(headerRow));
  const missing = VENUE_HEADERS.filter((h) => col[h] == null);
  if (missing.length) {
    throw new Error(`Venues header missing required column(s): ${missing.join(", ")}`);
  }
  const venues = [];
  const last = lastRow(ws);
  for (let r = headerRow + 1; r <= last; r++) {
    const row = ws.getRow(r);
    const vid = cellStr(row.getCell(col.Venue)).trim();
    const label = cellStr(row.getCell(col.Label)).trim();
    if (!vid) {
      if (POSITION_ONLY_RE.test(label) || POSITION_ONLY_RE.test(cellStr(row.getCell(1)))) break;
      if (looksLikePositionOnlyAhead(ws, r + 1, last)) break;
      continue;
    }
    if (vid === "Venue") break;
    if (POSITION_ONLY_RE.test(vid) || POSITION_ONLY_RE.test(label)) break;
    venues.push({
      id: vid,
      label,
      chain: cellStr(row.getCell(col.Chain)).trim(),
      pricingCategory: cellStr(row.getCell(col["Pricing cat."])).trim(),
      valueSom: cellNum(row.getCell(col["Position SoM"])),
      valueEom: cellNum(row.getCell(col["Position EoM"])),
      positionDelta: cellNum(row.getCell(col["Period inflow"])),
      actualRevenue: cellNum(row.getCell(col.actual_revenue)),
      externalRevenue: cellNum(row.getCell(col.external_revenue)),
      revenueToPrime: cellNum(row.getCell(col["revenue (to prime)"])),
      sdRevenue: cellNum(row.getCell(col["sd_revenue (to Sky)"])),
      avgValue: cellNum(row.getCell(col["Avg value"])),
      weight: cellNum(row.getCell(col.Weight)),
      cofAlloc: cellNum(row.getCell(col["CoF alloc"])),
      profitToSky: cellNum(row.getCell(col["Profit to Sky"])),
      profitToGrove: cellNum(row.getCell(col["Profit to Grove"])),
      utilizedDeductionAvg: cellNum(row.getCell(col["Utilized Deduction (avg)"])),
      spreadReimb: cellNum(row.getCell(col["Spread Reimb"])),
      notes: cellStr(row.getCell(col.Notes)).trim(),
      synthetic: SYNTHETIC_VENUE_IDS.includes(vid),
    });
  }
  return { venues, headerRow };
}

function findVenueHeaderRow(ws) {
  const last = lastRow(ws);
  for (let r = 1; r <= last; r++) {
    const map = headerMap(ws.getRow(r));
    if (map.Venue != null && map["Profit to Sky"] != null) return r;
  }
  return null;
}

function looksLikePositionOnlyAhead(ws, from, last) {
  for (let r = from; r <= last; r++) {
    const a = cellStr(ws.getRow(r).getCell(1)).trim();
    if (!a) continue;
    return POSITION_ONLY_RE.test(a);
  }
  return false;
}

function parseSummary(ws) {
  const headline = {
    primeAgentRevenue: 0,
    agentRate: 0,
    distributionRewards: 0,
    chroniclePoints: 0,
    gar: 0,
    primeAgentTotalRevenue: 0,
    cof: 0,
    sdeRevenue: 0,
    skyRevenue: 0,
    profitToGrove: 0,
  };
  let period = null;
  let settleVersion = null;
  let generatedAt = null;
  let section = null;
  const seen = new Set();
  const totals = new Set();
  const last = lastRow(ws);
  const mark = (key, value) => {
    seen.add(key);
    return value;
  };

  for (let r = 1; r <= last; r++) {
    const row = ws.getRow(r);
    const a = cellStr(row.getCell(1)).trim();
    const b = row.getCell(2);
    const al = a.toLowerCase();

    if (a === "Prime side") {
      section = "prime";
      continue;
    }
    if (a === "Sky side") {
      section = "sky";
      continue;
    }
    if (al.includes("comparison") && al.includes("profit to grove")) {
      section = "comparison";
      continue;
    }

    if (al === "period") {
      period = parsePeriod(cellStr(b));
      continue;
    }
    if (al === "generated") {
      generatedAt = cellStr(b).trim() || null;
      continue;
    }
    if (al === "pipeline") {
      settleVersion = cellStr(b).trim() || null;
      continue;
    }

    if (!a) {
      if (section && isNumericCell(b)) {
        const n = cellNum(b);
        if (section === "prime") headline.primeAgentTotalRevenue = n;
        else if (section === "sky") headline.skyRevenue = n;
        else if (section === "comparison") headline.profitToGrove = n;
        totals.add(section);
        section = null;
      }
      continue;
    }

    if (section === "prime") {
      if (al.startsWith("prime_agent_revenue")) headline.primeAgentRevenue = mark("prime_agent_revenue", cellNum(b));
      else if (al.startsWith("+ agent_rate")) headline.agentRate = mark("+ agent_rate", cellNum(b));
      else if (al.startsWith("+ distribution_rewards")) headline.distributionRewards = cellNum(b);
      else if (al.startsWith("+ chronicle_points")) headline.chroniclePoints = cellNum(b);
      else if (al.startsWith("+ governance_accessibility_rewards")) headline.gar = cellNum(b);
      continue;
    }
    if (section === "sky") {
      if (al.startsWith("cof on utilized")) headline.cof = mark("CoF on utilized", cellNum(b));
      else if (al.includes("sde revenue")) headline.sdeRevenue = mark("+ SDE revenue", cellNum(b));
      continue;
    }
    // comparison rows are only used for the unlabeled total
  }

  const missing = REQUIRED_SUMMARY_ROWS.filter((k) => !seen.has(k));
  if (missing.length) {
    throw new Error(
      `Summary sheet missing required row(s): ${missing.join(", ")}. ` +
        `A renamed label parses as 0, which is indistinguishable from a real zero — ` +
        `verify the new wording upstream, then update REQUIRED_SUMMARY_ROWS.`,
    );
  }
  const missingTotals = REQUIRED_SUMMARY_TOTALS.filter((k) => !totals.has(k));
  if (missingTotals.length) {
    throw new Error(`Summary sheet missing block total row(s): ${missingTotals.join(", ")}`);
  }

  return { headline, period, settleVersion, generatedAt };
}

function parsePeriod(text) {
  const m = String(text).match(
    /(\d{4}-\d{2}-\d{2})\s*(?:→|->)\s*(\d{4}-\d{2}-\d{2})\s*\((\d+)\s*days?\)/i,
  );
  if (!m) return null;
  return { start: m[1], end: m[2], nDays: Number(m[3]) };
}

function headerMap(row) {
  const map = {};
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = cellStr(cell).trim();
    if (name) map[name] = colNumber;
  });
  return map;
}

function lastRow(ws) {
  return Math.max(ws.rowCount || 0, ws.actualRowCount || 0, 1);
}

function cellStr(cell) {
  const v = cell?.value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text ?? "").join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.hyperlink != null && v.text == null) return String(v.hyperlink);
  }
  return String(v);
}

function isNumericCell(cell) {
  const v = cell?.value;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "object" && v != null && typeof v.result === "number") return Number.isFinite(v.result);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return true;
  return false;
}

function cellNum(cell) {
  const v = cell?.value;
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "object" && v != null && v.result != null) {
    const n = Number(v.result);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sum(xs) {
  return xs.reduce((a, b) => a + b, 0);
}
