// Every Sky spell cast on Ethereum, read from DSPause into spell_casts. A spell
// runs its plan through DSPause.exec, which logs an anonymous LogNote: topic0 is
// the exec selector, topic1 the caller, and the caller is the spell. The tx the
// note sits in is the cast, whoever sent it (a keeper, a gas station, an
// EIP-7702 account), so a cast is never read from the tx's own `to`.
import type { SqlTag } from "../sql-types.ts";
import { CONFIRMATIONS } from "./sync-events.ts";

/** MCD_PAUSE on the chainlog. */
export const DS_PAUSE = "0xbe286431454714f511008713973d3b053a2d38f3";
/** exec(address,bytes32,bytes,uint256) as ds-note writes it: the selector, right-padded. */
export const EXEC_NOTE = `0x168ccd67${"0".repeat(56)}`;

export interface NoteLog {
  topics: string[];
  blockNumber: number;
  timeStamp: number;
  transactionHash: string;
}

export interface CastDeps {
  /** DSPause's exec notes from `fromBlock` to `toBlock`; null when no explorer serves Ethereum. */
  notes: (fromBlock: number, toBlock: number) => Promise<NoteLog[] | null>;
  head: () => Promise<number | null>;
  now?: () => number;
}

export const spellOfNote = (l: Pick<NoteLog, "topics">) => `0x${l.topics[1].slice(-40)}`.toLowerCase();

async function cursorOf(db: SqlTag): Promise<number> {
  const rows = (await db`SELECT next_block FROM spell_cast_cursor WHERE id = 1`) as { next_block: string | number }[];
  return rows.length ? Number(rows[0].next_block) : 0;
}

async function mark(db: SqlTag, next: number, at: Date, error: string | null): Promise<void> {
  await db`
    INSERT INTO spell_cast_cursor (id, next_block, checked_at, last_error) VALUES (1, ${next}, ${at}, ${error})
    ON CONFLICT (id) DO UPDATE SET next_block = excluded.next_block, checked_at = excluded.checked_at, last_error = excluded.last_error`;
}

async function store(db: SqlTag, logs: NoteLog[]): Promise<number> {
  let added = 0;
  for (const l of logs.filter((x) => x.topics[0]?.toLowerCase() === EXEC_NOTE && x.topics[1])) {
    const res = (await db`
      INSERT INTO spell_casts (tx_hash, spell, block, block_time)
      VALUES (${l.transactionHash.toLowerCase()}, ${spellOfNote(l)}, ${l.blockNumber}, ${new Date(l.timeStamp * 1000)})
      ON CONFLICT DO NOTHING RETURNING tx_hash`) as unknown[];
    added += res.length;
  }
  return added;
}

export interface CastSync {
  added: number;
  /** First block not yet read; a cast at or past it is not known yet. */
  nextBlock: number;
  error: string | null;
}

/** Reads every cast since the cursor up to the confirmed head. A failed read keeps the cursor and records why. */
export async function syncSpellCasts(db: SqlTag, deps: CastDeps): Promise<CastSync> {
  const at = new Date((deps.now ?? Date.now)());
  const from = await cursorOf(db);
  const head = await deps.head();
  if (head === null) return { added: 0, nextBlock: from, error: "no Ethereum head" };
  const to = head - CONFIRMATIONS;
  if (to < from) return { added: 0, nextBlock: from, error: null };
  try {
    const logs = await deps.notes(from, to);
    if (logs === null) throw new Error("no explorer serves ethereum");
    const added = await store(db, logs);
    await mark(db, to + 1, at, null);
    return { added, nextBlock: to + 1, error: null };
  } catch (e) {
    const error = String((e as Error).message ?? e).slice(0, 300);
    await mark(db, from, at, error);
    return { added: 0, nextBlock: from, error };
  }
}

/** The spell a tx cast; null when the casts are read past its block and it is none; undefined while they are not. */
export async function castIn(db: SqlTag, tx: string, block: number): Promise<string | null | undefined> {
  const rows = (await db`SELECT spell FROM spell_casts WHERE tx_hash = ${tx}`) as { spell: string }[];
  if (rows.length) return rows[0].spell;
  return (await cursorOf(db)) > block ? null : undefined;
}
