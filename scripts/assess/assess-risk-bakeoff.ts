// `pnpm risk:assess --bakeoff`: rates the calibration paragraphs with every
// candidate assess model and prints them side by side, plus a per-model
// summary (valid replies, preciseness hits on the docs with an expected value,
// time, spend). Writes nothing. Run it with OPENROUTER_APP_KIND=eval so the
// spend is labelled as an eval.

import type { RiskCandidate } from "../../src/lib/riskRules";
import type { RiskRating } from "../../src/lib/riskAssessment";

type Assess = (c: RiskCandidate, model: string) => Promise<{ value: RiskRating | null; last?: { value?: RiskRating } }>;

export const BAKEOFF_MODELS = ["anthropic/claude-haiku-5.5", "openai/gpt-6-luna", "deepseek/deepseek-v4-pro"];

// Expected preciseness and enforcement come from docs/risk-assessment-rubric.md's calibration.
const CALIBRATION: { uuid: string; note: string; preciseness?: number; enforcement?: string }[] = [
  { uuid: "475fe222-9e4a-4e9d-9be6-a7a424ce02f8", note: "Minimum ASC", preciseness: 5 },
  { uuid: "bce9331b-04ca-4c50-9783-098739fc72c8", note: "Liquidation Penalty", preciseness: 3 },
  { uuid: "035ec13b-5676-45f0-a3b3-8b8e24a4adcf", note: "Legal/Regulatory Risk Monitoring", preciseness: 2, enforcement: "weak" },
  { uuid: "a2df2b73-c1c5-40d6-b87e-43ba24f54870", note: "IJRC stub", preciseness: 1 },
  { uuid: "39473e1a-63f8-433b-a850-08f53b2dcf02", note: "Lite PSM" },
  { uuid: "12b7d480-68a0-4493-9534-d6915f86c112", note: "Risk-Capital Incident Response" },
  { uuid: "5c3dd35a-0c67-44c2-b51b-d40bc865af85", note: "Conservatorship" },
  { uuid: "fd1f682c-2d8a-47c5-8c1d-d95a0a2f2021", note: "Risk-based insurance pricing" },
];

interface Tally { valid: number; hits: number; expected: number; ms: number }

export async function runBakeoff(candidates: RiskCandidate[], assess: Assess, spend: Map<string, number>, models = BAKEOFF_MODELS) {
  const tally = new Map(models.map((m) => [m, { valid: 0, hits: 0, expected: 0, ms: 0 } as Tally]));
  for (const cal of CALIBRATION) {
    const c = candidates.find((x) => x.uuid === cal.uuid);
    if (!c) { console.warn(`bakeoff: ${cal.note} ${cal.uuid} not in candidates`); continue; }
    const want = `${cal.preciseness ?? "?"}${cal.enforcement ? `/${cal.enforcement}` : ""}`;
    console.log(`\n=== ${c.docNo} ${c.title} (stub=${c.stub}) · expect ${want}`);
    const results = await Promise.all(models.map(async (model) => {
      const t0 = Date.now();
      const r = await assess(c, model);
      return { model, r, ms: Date.now() - t0 };
    }));
    for (const { model, r, ms } of results) printResult(model, r, ms, cal, tally.get(model)!);
  }
  console.log(`\nmodel | valid | preciseness hits | seconds | spend`);
  for (const [m, t] of tally) {
    console.log(`${m} | ${t.valid}/${CALIBRATION.length} | ${t.hits}/${t.expected} | ${(t.ms / 1000).toFixed(0)} | $${(spend.get(m) ?? 0).toFixed(4)}`);
  }
}

function printResult(model: string, r: Awaited<ReturnType<Assess>>, ms: number, cal: (typeof CALIBRATION)[number], t: Tally) {
  const v = r.value ?? r.last?.value;
  t.ms += ms;
  if (r.value) t.valid++;
  if (cal.preciseness !== undefined) { t.expected++; if (v?.preciseness === cal.preciseness) t.hits++; }
  console.log(`  ${model} (${(ms / 1000).toFixed(1)}s${r.value ? "" : ", INVALID"}): ${v?.description ?? "-"}`);
  console.log(`    preciseness ${v?.preciseness} — ${v?.precisenessReasoning}`);
  console.log(`    enforcement ${v?.enforcement} [${v?.mechanismUuids?.map((u) => u.slice(0, 8)).join(", ") ?? ""}] — ${v?.enforcementReasoning}`);
}
