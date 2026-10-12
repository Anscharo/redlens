// The PAU change history GET /api/pau/history serves (src/server/pau/history.ts):
// every configuration change the stored admin events hold, one entry per
// transaction, each with where it came from (origin.ts) and the executive whose
// spell it was, when the chain proves one. DOM-free, so the server and the
// Radar timeline share one declaration.

export type OriginKind = "spell" | "relayed" | "operator" | "deployment" | "direct" | "unknown";
export type OriginPath = "direct" | "starguard" | "op-stack" | "arbitrum";

export interface RelayRef {
  executor: string;
  actionsSet: number;
  queueTx?: string;
  /** The bridge message id that proves the L1 link: an OP-stack sourceHash or an Arbitrum request id. */
  messageId?: string;
}

/** Where one transaction's changes came from, as the chain proves it. */
export interface PauOrigin {
  kind: OriginKind;
  path: OriginPath | null;
  /** The cast DssSpell; set only for kind "spell". */
  spell: string | null;
  starSpell: string | null;
  /** The Ethereum transaction that ran the star spell or sent the relay. */
  l1Tx: string | null;
  from: string | null;
  to: string | null;
  relay: RelayRef | null;
  /** The rule that matched, in words a reader can check. */
  evidence: string;
}

/** The executive a spell belongs to; title and date are null for a spell older than every record. */
export interface ExecutiveRef {
  title: string | null;
  date: string | null;
  url: string | null;
  source: "vote-record" | "archive" | null;
}

export interface PauChange {
  /** Registry deployment ids (prime:chain:kind) the contract belongs to. */
  deployments: string[];
  contract: string;
  role: string;
  event: string;
  args: Record<string, unknown>;
  /** What the value is for: the rate-limit key, pool, token or role hash the event's first argument names. */
  subject: string | null;
  /** A well-known role's name (DEFAULT_ADMIN_ROLE, RELAYER, …), for a role event. */
  label: string | null;
  /** The previous setting of the same value on the same contract, when the history holds one. */
  before: Record<string, unknown> | null;
}

export interface PauHistoryEntry {
  chain: string;
  tx: string;
  block: number;
  time: string;
  /** Prime entity UUIDs whose PAU contracts changed. */
  primes: string[];
  origin: PauOrigin | null;
  executive: ExecutiveRef | null;
  changes: PauChange[];
}

export interface PauHistoryResponse {
  entries: PauHistoryEntry[];
}

export const EMPTY_PAU_HISTORY: PauHistoryResponse = { entries: [] };

const INDEX = new WeakMap<PauHistoryResponse, Map<string, PauHistoryEntry>>();

/** The entry a transaction made, for the Set-date chips; the index is built once per response. */
export function entryOf(res: PauHistoryResponse, chain: string, tx: string): PauHistoryEntry | undefined {
  let index = INDEX.get(res);
  if (!index) INDEX.set(res, (index = new Map(res.entries.map((e) => [`${e.chain}:${e.tx.toLowerCase()}`, e]))));
  return index.get(`${chain}:${tx.toLowerCase()}`);
}

/** Every entry a spell produced, on any chain: its direct changes and the action sets it relayed. */
export const entriesOfSpell = (res: PauHistoryResponse, spell: string): PauHistoryEntry[] =>
  res.entries.filter((e) => e.origin?.kind === "spell" && e.origin.spell === spell.toLowerCase());

export interface SpellEffects {
  changes: number;
  chains: string[];
  primes: string[];
}

/** How many PAU settings a spell changed, on which chains, for which primes (entity UUIDs). */
export function spellEffects(res: PauHistoryResponse, spell: string): SpellEffects {
  const mine = entriesOfSpell(res, spell);
  return {
    changes: mine.reduce((n, e) => n + e.changes.length, 0),
    chains: [...new Set(mine.map((e) => e.chain))],
    primes: [...new Set(mine.flatMap((e) => e.primes))],
  };
}
