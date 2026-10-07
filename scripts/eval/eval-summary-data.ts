// Inputs for eval:summary. A Thread is the prefix a compaction would summarize.
// Real threads come from the local database; synthetic threads are stitched from
// saved bakeoff runs and are always labelled SYNTHETIC.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { sql } from "../../src/server/db.ts";
import { COMPACT_TAIL, COMPACT_TAIL_FORCED, planCompaction, type ReplayRow } from "../../src/server/chat/context-compact.ts";
import { toolRecall, type RecallToolCall } from "../../src/server/chat/tool-recall-card.ts";
import { BAKEOFF_QUERIES } from "./eval-bakeoff-queries.ts";
import { mulberry32 } from "./eval-bootstrap.ts";

export interface Thread {
  id: string;
  kind: "real" | "synthetic";
  label: string;
  /** The rows the summarizer reads. */
  rows: ReplayRow[];
  /** When set, the rows are summarized in two steps; the second receives the first step's summary. */
  splitAt?: number;
}

export const shortHash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);
export const threadChars = (rows: ReplayRow[]): number =>
  rows.reduce((n, r) => n + r.content.length + (r.toolCalls ?? []).reduce((m, t) => m + (t.recall?.length ?? 0), 0), 0);

type DbRow = { id: string; role: string; content: string; tool_calls: RecallToolCall[] | null };

async function hasPrivateReposColumn(): Promise<boolean> {
  const r = (await sql`SELECT 1 AS x FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'private_repos'`) as unknown[];
  return r.length > 0;
}

/** Real conversations with 6+ messages and no private repos. A thread with no prefix at COMPACT_TAIL keeps COMPACT_TAIL_FORCED rows instead. */
export async function loadRealThreads(): Promise<Thread[]> {
  const guard = (await hasPrivateReposColumn()) ? sql`AND cardinality(c.private_repos) = 0` : sql``;
  const convs = (await sql`
    SELECT c.id FROM conversations c JOIN messages m ON m.conversation_id = c.id
    WHERE true ${guard} GROUP BY c.id HAVING count(m.id) >= 6 ORDER BY min(m.created_at)
  `) as { id: string }[];
  const out: Thread[] = [];
  for (const { id } of convs) {
    const msgs = (await sql`SELECT id, role, content, tool_calls FROM messages WHERE conversation_id = ${id} ORDER BY created_at`) as DbRow[];
    const rows: ReplayRow[] = msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, toolCalls: Array.isArray(m.tool_calls) ? m.tool_calls : null }));
    const plan = planCompaction(rows, COMPACT_TAIL) ?? planCompaction(rows, COMPACT_TAIL_FORCED);
    if (plan && plan.prefix.length >= 2) out.push({ id: `real-${id.slice(0, 8)}`, kind: "real", label: `conversation ${id.slice(0, 8)}`, rows: plan.prefix });
  }
  return out;
}

interface Turn { id: string; query: string; answer: string; cards: string[] }

function loadTurns(): Turn[] {
  const dir = path.resolve(import.meta.dir, "../../.cache");
  const queries = new Map(BAKEOFF_QUERIES.map((q) => [q.id, q.query]));
  const seen = new Set<string>();
  const turns: Turn[] = [];
  for (const f of fs.readdirSync(dir).filter((n) => /^eval-bakeoff.*\.json$/.test(n)).sort()) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const r of (Array.isArray(data) ? data : data.results ?? []) as Record<string, unknown>[]) {
      const query = queries.get(String(r.id));
      const texts = r.toolTexts;
      if (!query || r.error || typeof r.answer !== "string" || r.answer.length < 80 || !Array.isArray(texts)) continue;
      const key = shortHash(r.id + r.answer);
      if (seen.has(key)) continue;
      seen.add(key);
      const cards = texts.map((t, i) => toolRecall("atlas_search", { query: `${query} (${i + 1})` }, String(t), true));
      turns.push({ id: String(r.id), query, answer: r.answer, cards });
    }
  }
  return turns;
}

function rowsFor(turns: Turn[], seed: number, targetChars: number): ReplayRow[] {
  const rng = mulberry32(seed);
  const order = turns.map((t) => ({ t, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.t);
  const rows: ReplayRow[] = [];
  let chars = 0;
  for (let i = 0; chars < targetChars; i++) {
    const t = order[i % order.length];
    const calls: RecallToolCall[] = t.cards.map((recall, j) => ({
      name: "atlas_search", args: { query: t.query }, ok: true, bytes: recall.length, recall, recall_id: `call_${seed}_${i}_${j}`,
    }));
    rows.push({ id: `s${seed}-${i}u`, role: "user", content: t.query });
    rows.push({ id: `s${seed}-${i}a`, role: "assistant", content: t.answer, toolCalls: calls });
    chars = threadChars(rows);
  }
  return rows;
}

/** Threads of about 150k, 350k and 550k characters, plus the 350k thread summarized in two steps. */
export function buildSyntheticThreads(): Thread[] {
  const turns = loadTurns();
  const mk = (k: number): Thread => ({ id: `syn-${k}k`, kind: "synthetic", label: `SYNTHETIC ${k}k chars`, rows: rowsFor(turns, k, k * 1000) });
  const mid = mk(350);
  const chained: Thread = { ...mid, id: "syn-350k-chained", label: "SYNTHETIC 350k chars, chained (two steps)", splitAt: Math.floor(mid.rows.length / 2) };
  return [mk(150), mid, mk(550), chained];
}
