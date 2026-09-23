// Scoring + printing for eval-refute-screen.ts. Pure except the one cached
// list-price lookup used to put a dollar figure on gemma's tokens.
import fs from "node:fs";
import path from "node:path";
import { config } from "../../src/server/config.ts";
import { needsGemma, SCREEN_CONTRADICTED_THRESHOLD, type ScreenResult } from "../../src/server/chat/verify/refute-screen.ts";
import { TRUE_DEFECT, type Case } from "./eval-refute-screen-cases.ts";

export interface GemmaOutcome {
  parsed: boolean;
  timedOut: boolean;
  candidates: { answer_span: string; evidence_span: string; why: string }[];
  discarded: number;
  notFound: string[];
  latencyMs: number | null;
  wallMs: number;
  usage: { input: number; output: number } | null;
}
export interface Row { c: Case; screen: ScreenResult | null; gemma: GemmaOutcome | null }

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9][a-z0-9.,%-]*/g) ?? []);
function onTarget(span: string, units: string[]): boolean {
  const a = words(span);
  return units.some((u) => {
    const b = words(u);
    const shared = [...a].filter((w) => b.has(w)).length;
    return shared / Math.max(1, Math.min(a.size, b.size)) >= 0.6;
  });
}
const gAny = (r: Row) => (r.gemma?.candidates.length ?? 0) > 0;
const gTarget = (r: Row) => !!r.gemma?.candidates.some((x) => onTarget(x.answer_span, r.c.targetUnits));
const flagged = (r: Row) => r.screen?.flagged === true;
const routes = (r: Row) => needsGemma(r.screen);
const frac = (a: number, b: number) => `${a}/${b}${b ? ` (${Math.round((100 * a) / b)}%)` : ""}`;
const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : NaN);
const count = (rs: Row[], f: (r: Row) => boolean) => rs.filter(f).length;
const SEMANTIC = /^(contradiction|number)\/(value:contradictable|entity|no-unit:entity)$/;

async function listPrice(model: string): Promise<{ prompt: number; completion: number } | null> {
  const f = path.join(".cache", "eval-refute-screen", "pricing.json");
  try {
    const all = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : await (await fetch(`${config.openrouterBaseUrl}/models`)).json();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(all));
    const m = (all.data as { id: string; pricing: { prompt: string; completion: string } }[]).find((x) => x.id === model);
    return m ? { prompt: Number(m.pricing.prompt), completion: Number(m.pricing.completion) } : null;
  } catch {
    return null;
  }
}

export async function printReport(rows: Row[], o: { gemmaModel: string; gemmaRan: boolean; spent: Record<string, number> }): Promise<void> {
  const G = o.gemmaRan;
  const muts = rows.filter((r) => r.c.cls !== "baseline");
  const base = rows.filter((r) => r.c.cls === "baseline");
  const clean = base.filter((r) => !TRUE_DEFECT.has(r.c.id));
  const col = (s: string, w = 13) => s.padEnd(w);

  console.log(`\n── per mutation class (screen threshold P(contradicted) ≥ ${SCREEN_CONTRADICTED_THRESHOLD}; gemma = ≥1 span-validated candidate, pre-confirm) ──`);
  console.log(`  ${col("class", 36)}${col("n", 5)}${col("Jev flags")}${col("→ gemma")}${G ? `${col("gemma any")}${col("gemma target")}${col("gate keeps")}${col("Jev-only")}` : ""}`);
  const groups = new Map<string, Row[]>();
  for (const r of muts) groups.set(`${r.c.cls}${r.c.sub ? `/${r.c.sub}` : ""}`, [...(groups.get(`${r.c.cls}${r.c.sub ? `/${r.c.sub}` : ""}`) ?? []), r]);
  for (const [k, rs] of [...groups].sort()) {
    const cells = [frac(count(rs, flagged), rs.length), frac(count(rs, routes), rs.length)];
    if (G) cells.push(frac(count(rs, gAny), rs.length), frac(count(rs, gTarget), rs.length), `${count(rs, (r) => routes(r) && gAny(r))}/${count(rs, gAny)}`, String(count(rs, (r) => flagged(r) && !gAny(r))));
    console.log(`  ${col(k, 36)}${col(String(rs.length), 5)}${cells.map((c) => col(c)).join("")}`);
  }
  const sem = muts.filter((r) => SEMANTIC.test(`${r.c.cls}/${r.c.sub}`));
  console.log(`\n  planted name/number contradictions (the plan's 85/100 set): Jev flags ${frac(count(sem, flagged), sem.length)}${G ? `, gemma any ${frac(count(sem, gAny), sem.length)}, gemma on target ${frac(count(sem, gTarget), sem.length)}` : ""}`);

  console.log(`\n── stored answers (baseline paragraphs) ──`);
  const st = (r: Row) => (!r.screen ? "failed" : !r.screen.fits ? "unfit" : r.screen.statements.length === 0 ? "empty" : "judged");
  console.log(`  clean paragraphs ${clean.length}: judged ${count(clean, (r) => st(r) === "judged")}, empty ${count(clean, (r) => st(r) === "empty")}, unfit ${count(clean, (r) => st(r) === "unfit")}, failed ${count(clean, (r) => st(r) === "failed")}`);
  console.log(`  Jev flags ${frac(count(clean, flagged), clean.length)} of clean paragraphs; gate skips gemma on ${frac(count(clean, (r) => !routes(r)), clean.length)}`);
  const defects = base.filter((r) => TRUE_DEFECT.has(r.c.id));
  console.log(`  adjudicated real defects: Jev flags ${count(defects, flagged)}/${defects.length}${G ? `, gemma any ${count(defects, gAny)}/${defects.length}` : ""}`);
  if (G) {
    console.log(`  gemma candidates on clean paragraphs (pre-confirm false flags): ${frac(count(clean, gAny), clean.length)}; timed out ${frac(count(base, (r) => !!r.gemma?.timedOut), base.length)}`);
    const lost = muts.filter((r) => gAny(r) && !routes(r));
    const all = rows.length;
    console.log(`\n── projected "gate" mode ──`);
    console.log(`  mutations: gemma alone catches ${count(muts, gAny)}, gate keeps ${count(muts, (r) => routes(r) && gAny(r))} (on target: ${count(muts, gTarget)} → ${count(muts, (r) => routes(r) && gTarget(r))})`);
    console.log(`  gemma calls: shadow/off ${all}, gate ${count(rows, routes)} over all cases; on stored answers ${base.length} → ${count(base, routes)} (${frac(count(base, (r) => !routes(r)), base.length)} saved)`);
    for (const r of lost) console.log(`    lost by gate: ${r.c.id} [${r.c.cls}/${r.c.sub}] Jev P=${r.screen?.maxContradicted.toFixed(2)} — gemma: ${r.gemma!.candidates[0].why}`);
    const jOnly = rows.filter((r) => flagged(r) && !gAny(r) && r.c.cls !== "baseline");
    console.log(`  Jev flagged, gemma silent (mutations): ${jOnly.length}`);
  }

  const jl = rows.filter((r) => r.screen && r.screen.statements.length).map((r) => r.screen!.latencyMs);
  console.log(`\n── latency / spend ──`);
  console.log(`  Jev per paragraph: p50 ${pct(jl, 50)} ms, p95 ${pct(jl, 95)} ms, max ${Math.max(...jl)} ms (n ${jl.length}, as measured when first fetched)`);
  const ratio = rows.filter((r) => r.screen?.inputTokens).map((r) => r.screen!.inputTokens! / r.screen!.estTokens);
  console.log(`  budget estimate: billed/estimated input tokens p50 ${pct(ratio, 50).toFixed(2)}, max ${Math.max(...ratio).toFixed(2)}; largest billed ${Math.max(0, ...rows.map((r) => r.screen?.inputTokens ?? 0))}`);
  console.log(`  Jev spend: $${o.spent.jevNew.toFixed(4)} this run (${o.spent.jevCalls} calls, ${o.spent.jevErrors} errors); $${o.spent.jevAll.toFixed(4)} for the whole measurement`);
  if (G) {
    const gl = rows.filter((r) => r.gemma?.parsed).map((r) => r.gemma!.latencyMs ?? r.gemma!.wallMs);
    const tin = rows.reduce((s, r) => s + (r.gemma?.usage?.input ?? 0), 0);
    const tout = rows.reduce((s, r) => s + (r.gemma?.usage?.output ?? 0), 0);
    const price = await listPrice(o.gemmaModel);
    const usd = price ? ` ≈ $${(tin * price.prompt + tout * price.completion).toFixed(4)} at list price` : "";
    console.log(`  gemma per paragraph: p50 ${pct(gl, 50)} ms, p95 ${pct(gl, 95)} ms; timeouts ${count(rows, (r) => !!r.gemma?.timedOut)}/${rows.length}; ${o.spent.gemmaCalls} new calls, ${o.spent.gemmaErrors} uncached errors`);
    console.log(`  gemma tokens (whole measurement): ${tin} in / ${tout} out${usd}`);
  }
}
