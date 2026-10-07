// Aggregation and printing for eval:summary. Pure: no I/O, no model calls.
export interface Row {
  thread: string;
  kind: "real" | "synthetic";
  label: string;
  model: string;
  prefixChars: number;
  probes: number;
  correct: number;
  partial: number;
  missing: number;
  wrong: number;
  retention: number | null;
  fabrications: string[];
  unmatchedIds: string[];
  parseFailure: boolean;
  atCap: boolean;
  error: string | null;
  summaryChars: number;
  latencyMs: number;
  input: number;
  output: number;
  costUsd: number;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const pct = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

export function scoreboard(rows: Row[]) {
  const graded = rows.filter((r) => r.retention !== null);
  const probes = sum(graded.map((r) => r.probes));
  return {
    threads: rows.length,
    retention: probes ? (sum(graded.map((r) => r.correct)) + 0.5 * sum(graded.map((r) => r.partial))) / probes : null,
    wrong: sum(rows.map((r) => r.wrong)),
    fabrications: sum(rows.map((r) => r.fabrications.length)),
    unmatchedIds: sum(rows.map((r) => r.unmatchedIds.length)),
    parseFailures: rows.filter((r) => r.parseFailure).length,
    atCap: rows.filter((r) => r.atCap).length,
    p50s: pct(rows.map((r) => r.latencyMs), 0.5) / 1000,
    p90s: pct(rows.map((r) => r.latencyMs), 0.9) / 1000,
    inputTok: sum(rows.map((r) => r.input)),
    outputTok: sum(rows.map((r) => r.output)),
    costUsd: sum(rows.map((r) => r.costUsd)),
  };
}

const f = (n: number | null, d = 1): string => (n === null ? "n/a" : (n * (d === 3 ? 1 : 100)).toFixed(d === 3 ? 3 : 1));

export function printBoard(title: string, rows: Row[], models: string[]): void {
  console.log(`\n== ${title} ==`);
  console.log("model                    n  retain%  wrong  fab  badIds  parseFail  atCap  p50s   p90s   inTok     outTok   cost$");
  for (const m of models) {
    const s = scoreboard(rows.filter((r) => r.model === m));
    console.log(
      `${m.padEnd(22)} ${String(s.threads).padStart(3)}  ${f(s.retention).padStart(6)}  ${String(s.wrong).padStart(5)}  ${String(s.fabrications).padStart(3)}  ${String(s.unmatchedIds).padStart(6)}  ${String(s.parseFailures).padStart(9)}  ${String(s.atCap).padStart(5)}  ${s.p50s.toFixed(1).padStart(5)}  ${s.p90s.toFixed(1).padStart(5)}  ${String(s.inputTok).padStart(8)}  ${String(s.outputTok).padStart(7)}  ${s.costUsd.toFixed(4)}`,
    );
  }
}

export function printRows(rows: Row[]): void {
  console.log("\n== Per thread ==");
  for (const r of rows) {
    const bad = r.error ? ` ERROR ${r.error}` : r.parseFailure ? " PARSE-FAIL" : "";
    console.log(
      `${r.label.padEnd(44)} ${r.model.padEnd(20)} prefix ${String(r.prefixChars).padStart(6)}  sum ${String(r.summaryChars).padStart(5)}  retain ${f(r.retention).padStart(5)}% (${r.correct}c/${r.partial}p/${r.missing}m/${r.wrong}w of ${r.probes})  fab ${r.fabrications.length}  badIds ${r.unmatchedIds.length}  ${(r.latencyMs / 1000).toFixed(1)}s${bad}`,
    );
  }
}
