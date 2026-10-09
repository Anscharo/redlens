// What changed between two PAU censuses (pauCensus.ts) that someone should
// look at. Drift lines are `[drift] pau-census: …` and fixed in wording, so the
// healer's comm against the warnings baseline treats a repeat as the same line:
//   - NEW mismatch / not-set: a disagreement (status, deployment, atlas text,
//     raw chain value) the baseline does not hold, saying which side moved;
//   - LOST MATCH: a value that matched now matches nowhere and disagrees
//     nowhere (unread, no key, ambiguous, or absent from the atlas);
//   - unparsed / unknown-chain: a value the reader newly cannot read;
//   - a deployment gone from the snapshots, once, instead of per value;
//   - a prime whose stated values fell below half, once, instead of per value.
// Each kind stops after CAP lines. Resolved disagreements and new values not
// yet comparable are notes, not drift.
import type { ValueStatus } from "./pauAtlasValues.ts";
import { DISAGREE, type CensusSlot, type CensusValue, type PauCensus } from "./pauCensus.ts";

export interface CensusDiff {
  drift: string[];
  notes: string[];
}

const CAP = 25;
const READER_GAPS = new Set<ValueStatus>(["unparsed", "unknown-chain"]);
const PREFIX = "[drift] pau-census:";

const statusOf = (s: CensusSlot): ValueStatus => (Array.isArray(s) ? s[0] : s);
const statuses = (v: CensusValue | undefined) => new Set(Object.values(v?.at ?? {}).map(statusOf));
const hasDisagreement = (v: CensusValue | undefined) => [...statuses(v)].some((s) => DISAGREE.has(s));
const deploymentOf = (slot: string) => slot.split("/").slice(0, 2).join("/");

type Disagreement = [ValueStatus, string | null, string];

/** Each disagreement by `status|chain/kind|raw`, the part compared, with its slot. */
function disagreements(v: CensusValue | undefined): Map<string, [string, Disagreement]> {
  const out = new Map<string, [string, Disagreement]>();
  for (const [slot, s] of Object.entries(v?.at ?? {})) if (Array.isArray(s) && DISAGREE.has(s[0])) out.set(`${s[0]}|${deploymentOf(slot)}|${s[1] ?? ""}`, [slot, s]);
  return out;
}

function capped(lines: string[]): string[] {
  const sorted = [...lines].sort();
  return sorted.length <= CAP ? sorted : [...sorted.slice(0, CAP), `${PREFIX} …and ${sorted.length - CAP} more line(s) like the one above`];
}

function newDisagreements(who: string, p: CensusValue | undefined, v: CensusValue): string[] {
  const before = p && p.stated === v.stated ? disagreements(p) : new Map();
  const moved = !p ? "new in the atlas" : p.stated !== v.stated ? `atlas changed, was "${p.stated}"` : "chain changed";
  return [...disagreements(v)].filter(([k]) => !before.has(k)).map(([, [slot, s]]) => `${PREFIX} NEW ${s[0]} — ${who} on ${deploymentOf(slot)}: atlas "${v.stated}", chain ${s[2]} (${moved})`);
}

/** Deployments in the baseline that the snapshots do not serve. */
function goneDeployments(prev: PauCensus, cur: PauCensus): string[] {
  const now = new Set(cur.deployments);
  return prev.deployments.filter((d) => !now.has(d));
}

/** Primes whose stated values fell below half the baseline's (a parser stopped matching, not a resolution). */
function collapsedPrimes(prev: PauCensus, cur: PauCensus): Set<string> {
  const count = (c: PauCensus) => Object.values(c.values).reduce((m, v) => m.set(v.prime, (m.get(v.prime) ?? 0) + 1), new Map<string, number>());
  const [was, now] = [count(prev), count(cur)];
  return new Set([...was].filter(([prime, n]) => n >= 4 && (now.get(prime) ?? 0) < n / 2).map(([prime]) => prime));
}

interface Context {
  gone: string[];
  collapsed: Set<string>;
  who: (id: string, v: CensusValue) => string;
  lines: { disagree: string[]; lost: string[]; gap: string[] };
}

/** One current value against its baseline entry; true when it is new and not yet comparable. */
function compareValue(ctx: Context, id: string, p: CensusValue | undefined, v: CensusValue): boolean {
  const [was, now] = [statuses(p), statuses(v)];
  const onGone = p && Object.keys(p.at).some((slot) => ctx.gone.includes(`${p.prime}/${deploymentOf(slot)}`));
  ctx.lines.disagree.push(...newDisagreements(ctx.who(id, v), p, v));
  if (was.has("match") && !now.has("match") && !hasDisagreement(v) && !onGone) ctx.lines.lost.push(`${PREFIX} LOST MATCH — ${ctx.who(id, v)}: match → ${[...now].sort().join(", ")}`);
  for (const s of now) if (READER_GAPS.has(s) && !was.has(s)) ctx.lines.gap.push(`${PREFIX} ${s} — ${ctx.who(id, v)}: atlas "${v.stated}"`);
  return !p && !now.has("match") && !hasDisagreement(v);
}

function sourceLines(ctx: Context, name: (prime: string) => string): string[] {
  return [
    ...ctx.gone.map((d) => `${PREFIX} deployment ${name(d.split("/")[0])} ${d.split("/").slice(1).join("/")} is gone from the snapshots; its values are not compared`),
    ...[...ctx.collapsed].map((prime) => `${PREFIX} values stated by ${name(prime)} fell below half the baseline's; check the instance params the census reads before treating this as resolution`),
  ];
}

/** The drift between the accepted baseline and the census now; `name` turns a prime UUID into a name. */
export function diffPauCensus(prev: PauCensus, cur: PauCensus, name: (prime: string) => string): CensusDiff {
  const who = (id: string, v: CensusValue) => `${name(v.prime)} · ${v.instance} · ${v.label} (${v.doc_no ?? "doc removed"}, ${id.split(":")[0]})`;
  const ctx: Context = { gone: goneDeployments(prev, cur), collapsed: collapsedPrimes(prev, cur), who, lines: { disagree: [], lost: [], gap: [] } };
  const pending = Object.entries(cur.values).filter(([id, v]) => compareValue(ctx, id, prev.values[id], v)).length;
  for (const [id, p] of Object.entries(prev.values)) {
    if (!cur.values[id] && statuses(p).has("match") && !ctx.collapsed.has(p.prime)) ctx.lines.lost.push(`${PREFIX} LOST MATCH — ${who(id, p)}: value no longer stated`);
  }
  const resolved = Object.entries(prev.values).filter(([id, p]) => hasDisagreement(p) && !hasDisagreement(cur.values[id])).length;
  const drift = [...sourceLines(ctx, name), ...capped(ctx.lines.disagree), ...capped(ctx.lines.lost), ...capped(ctx.lines.gap)];
  return { drift, notes: [`pau-census: ${resolved} baseline disagreement(s) resolved, ${pending} new value(s) not yet comparable`] };
}
