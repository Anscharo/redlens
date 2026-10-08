// The vote-evidence eval's last section: every labeled case where an arm's
// answer differs from gold, abstentions aside.

import type { Report } from "./eval-vote-evidence-report.ts";

export function disagreements(r: Report): void {
  console.log("\ndisagreements with gold");
  for (const x of r.subject.filter((x) => x.gold !== "unlabeled")) {
    const preds = { heuristic: x.heuristic, ...labelsOf(x.decisions, (d) => d.label), llm: x.llm?.label };
    const off = Object.entries(preds).filter(([, p]) => p !== undefined && p !== x.gold && p !== "abstain");
    if (off.length) console.log(`  subject ${x.slice} ${x.docNo} ${x.key.slice(0, 8)}… gold=${x.gold} ${off.map(([a, p]) => `${a}=${p}`).join(" ")} (${x.vote})`);
  }
  for (const x of r.poll.filter((x) => x.gold !== "unlabeled")) {
    const want = x.acceptable.length ? x.acceptable : ["none"];
    const arms = { heuristic: x.heuristic, lexical: x.lexical, history: x.history, ...labelsOf(x.decisions, (d) => d.pick), llm: x.llm };
    const off = Object.entries(arms).filter(([, p]) => p !== undefined && !want.includes(String(p)));
    if (off.length) console.log(`  poll ${x.docNo} ${x.key.slice(0, 8)}… want=${want.join("|")} ${off.map(([a, p]) => `${a}=${p}`).join(" ")}`);
  }
}

function labelsOf<T, V>(decisions: Record<string, T> | undefined, get: (d: T) => V): Record<string, V> {
  return Object.fromEntries(Object.entries(decisions ?? {}).map(([arm, d]) => [arm, get(d)]));
}
