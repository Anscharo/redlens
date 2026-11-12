// A value the chain changed after the atlas last wrote it: governance can act
// before the atlas is edited (a spell-update pull request waits for the spell
// to execute, then records it). The key's last change is read from the PAU
// history (who made it: a spell and its executive, the Operator, or something
// else). A merged pull request that belongs to that spell (it names it, or its
// Prime poll is one that spell's executive carries) and edited the value's
// document without changing the value says the atlas passed it by; an open
// one that belongs to it is the atlas update still to come. Pure.
import { prSpellRefs, resolveSpellRefs } from "./atlasPrSpell.ts";
import type { HistoryEntry } from "./history.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import { entryOf, type PauHistoryEntry } from "./pauHistory.ts";
import type { ChainChange, OnchainStep, PendingContext } from "./pauPending.ts";

/** An open pull request against the atlas, as GET /api/preview/open-prs serves it. */
export interface OpenAtlasPr {
  number: number;
  title: string;
  url: string;
  body: string;
  /** ISO; the year a spell reference without one is read against. */
  updatedAt: string;
}

/** Who made a change, as its history entry proves it. */
function madeBy(e: PauHistoryEntry | undefined): ChainChange["by"] {
  if (e?.origin?.kind === "operator") return { kind: "operator" };
  if (e?.origin?.kind !== "spell" && e?.origin?.kind !== "relayed") return { kind: "other" };
  const x = e.executive;
  return { kind: "spell", spell: x?.date ? { title: x.title, date: x.date, url: x.url } : null };
}

/** Whether a PR belongs to the spell dated `date`: its own words name it, or an executive of that date carries one of its Prime polls. */
function belongsTo(pr: number, spells: readonly string[], date: string, ctx: PendingContext): boolean {
  if (spells.includes(date)) return true;
  return (ctx.pollsByPr?.get(pr) ?? []).some((p) => (ctx.snapshots?.get(p.id) ?? []).some((x) => x.date === date));
}

/** The open pull request that belongs to the spell dated `date`, if one does. */
export function recordingPr(prs: readonly OpenAtlasPr[], date: string, ctx: PendingContext): OpenAtlasPr | null {
  return prs.find((p) => belongsTo(p.number, resolveSpellRefs(prSpellRefs(p.title, p.body), (p.updatedAt || date).slice(0, 10)), date, ctx)) ?? null;
}

/** The change to the value's document, on or after the chain change, by a PR that belongs to the spell dated `date`. */
const passedBy = (entries: readonly HistoryEntry[], date: string, setOn: string, ctx: PendingContext) =>
  entries.find((e) => e.pr && e.date.slice(0, 10) >= setOn && (e.changeType === "added" || e.changeType === "modified") && belongsTo(e.pr, e.spells ?? [], date, ctx));

/**
 * The step for a key the chain set after the atlas last wrote its value: the
 * atlas update an open PR holds, or none; `missedBy` names a merged PR that
 * records the spell and edited the document without the value. Null when the
 * open PRs are not read and no merged PR passed it by.
 */
export function chainLedStep(c: ValueCheck, entries: readonly HistoryEntry[], ctx: PendingContext): OnchainStep | null {
  if (!c.limit || !c.chain) return null;
  const { tx, time } = c.limit.setAt;
  const change: ChainChange = { chain: c.chain, tx, setOn: time.slice(0, 10), by: madeBy(entryOf(ctx.pau, c.chain, tx)) };
  const date = change.by.kind === "spell" ? change.by.spell?.date : null;
  const missed = date ? passedBy(entries, date, change.setOn, ctx) : undefined;
  if (missed) return { kind: "unrecorded", change, missedBy: { pr: missed.pr!, date: missed.date.slice(0, 10) } };
  if (!ctx.openPrs) return null;
  const pr = date ? recordingPr(ctx.openPrs, date, ctx) : null;
  return pr ? { kind: "recording", change, pr: { number: pr.number, title: pr.title, url: pr.url } } : { kind: "unrecorded", change };
}
