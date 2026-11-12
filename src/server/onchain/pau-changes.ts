// redline_liquidity_changes: the configuration changes the Liquidity Layer page lists,
// one row per transaction, newest first. The history is the one GET
// /api/pau/history serves (src/server/pau/history.ts).
import { explorerTxUrl } from "../../lib/explorer.ts";
import { PAU_CHANGES_NOTE } from "../../lib/pauLayout.ts";
import type { PauChange, PauHistoryEntry, PauQueuedStep } from "../../lib/pauHistory.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { resolveEntity } from "../retrieval/entity-resolve.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import { currentPauHistory } from "../pau/history.ts";
import { sameChain } from "./query.ts";

export interface PauChangeQuery {
  entity?: string;
  chain?: string;
  origin?: string;
  spell?: string;
  query?: string;
  limit: number;
}

const clip = (v: unknown): unknown => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 157)}…` : v;
};

function changeRow(c: PauChange) {
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c.args)) args[k] = clip(v);
  const before = c.before && JSON.stringify(c.before).length <= 400 ? c.before : undefined;
  return { event: c.event, role: c.role, contract: c.contract, subject: c.subject, label: c.label, args, ...(before ? { before } : {}) };
}

function entryRow(e: PauHistoryEntry) {
  const o = e.origin;
  return {
    chain: e.chain, time: e.time, tx: e.tx, url: explorerTxUrl(e.chain, e.tx),
    origin: o ? { kind: o.kind, path: o.path, spell: o.spell, evidence: o.evidence } : null,
    executive: e.executive?.title ? { title: e.executive.title, date: e.executive.date, url: e.executive.url } : null,
    changes: e.changes.map(changeRow),
  };
}

const hay = (e: PauHistoryEntry) =>
  [e.chain, e.origin?.kind, e.origin?.spell, e.origin?.evidence, e.executive?.title, ...e.changes.map((c) => `${c.event} ${c.label ?? ""} ${c.subject ?? ""}`)]
    .join(" ").toLowerCase();

function selected(e: PauHistoryEntry, q: PauChangeQuery, id: string | null, words: string[]): boolean {
  if (id && !e.primes.includes(id)) return false;
  if (!sameChain(e.chain, q.chain)) return false;
  if (q.origin && e.origin?.kind !== q.origin) return false;
  if (q.spell && e.origin?.spell?.toLowerCase() !== q.spell.toLowerCase()) return false;
  return words.every((w) => hay(e).includes(w));
}

/** Queued steps follow the entity, the chain and a spell address. An origin other than spell is a change that already ran, so it lists none. */
function queuedSelected(s: PauQueuedStep, q: PauChangeQuery, id: string | null): boolean {
  if (q.origin && q.origin !== "spell") return false;
  if (q.spell && s.id.toLowerCase() !== q.spell.toLowerCase()) return false;
  if (id && !s.primes.includes(id)) return false;
  return sameChain(s.chain, q.chain);
}

/** The prime's PAU changes. A history that cannot be built is an error, not an empty list. */
export async function pauChanges(ix: Indexes, q: PauChangeQuery): Promise<ToolResult> {
  const ent = q.entity ? resolveEntity(ix, q.entity) : null;
  if (q.entity && !ent) return { error: `No entity matches '${q.entity}'. Use atlas_entities to find its slug.` };
  let body;
  try {
    body = await currentPauHistory();
  } catch (e) {
    return { error: `PAU change history is unavailable: ${(e as Error).message}` };
  }
  const id = ent?.id ?? null;
  const words = (q.query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  const rows = body.entries.filter((e) => selected(e, q, id, words)).reverse();
  const limit = Math.min(Math.max(1, q.limit || 20), 80);
  return {
    note: PAU_CHANGES_NOTE,
    count: rows.length,
    ...(rows.length > limit ? { truncated: true } : {}),
    queued: (body.queued ?? []).filter((s) => queuedSelected(s, q, id)),
    changes: rows.slice(0, limit).map(entryRow),
  };
}
