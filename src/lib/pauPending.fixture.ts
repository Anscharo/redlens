// Shared fixtures for the on-chain step tests: one Spark deployment on Base
// administered by its Executor, a key it holds, the atlas change that wrote a
// value and the spells it names, a spell's PAU changes, queued action sets and
// vote-record executives.
import type { HistoryEntry } from "./history.ts";
import type { StoredPauSnapshot } from "./pau.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import type { PauHistoryEntry, PauQueuedStep } from "./pauHistory.ts";
import type { PendingContext } from "./pauPending.ts";
import type { IndexedExecutive } from "./votes/vote-index.ts";

export const DEP = "spark:base:monolithic";
const at = (day: string) => ({ block: 1, time: `${day}T00:00:00Z`, tx: "0xset" });

export const limit = (setOn: string) => ({
  key: "0xk", configured: { maxAmount: "5", slope: "0" }, setAt: at(setOn), changes: 1,
  data: { maxAmount: "5", slope: "0", lastAmount: "0", lastUpdated: "0" }, available: "0",
});

export const check = (status: ValueCheck["status"], setOn = "2026-07-01", extra: Partial<ValueCheck> = {}): ValueCheck => ({
  docId: "d", instance: "I", instanceDocId: null, label: "Inflow maxAmount", field: "maxAmount", stated: "10,000,000 USDC", status,
  key: "0xk", chain: "base", kind: "monolithic", contract: "0xrl", limit: limit(setOn), readAt: null, ...extra,
});

/** The deployment; `beam` lets the Configurator set key 0xk. */
export const snap = (beam = false): StoredPauSnapshot => ({
  deployment: DEP, prime: "spark", primeName: "Spark", chain: "base", kind: "monolithic", fetchedAt: "2026-11-10T00:00:00Z",
  contracts: [{
    role: "rateLimits", address: "0xrl", events: 1, historyComplete: true, rateLimits: [limit("2026-07-01")],
    roles: [{ role: "0xadmin", name: "DEFAULT_ADMIN_ROLE", account: "0xEX", since: at("2025-01-01"), holds: true }],
    ...(beam ? { beam: { beamState: "0xbs", hop: null, maxChange: null, defaults: [{ key: "0xk", maxAmount: "1", slope: "1", scope: "contract" as const, setAt: null }], historyComplete: true } } : {}),
  }],
});

/** The atlas change that wrote the stated value on `date`, by PR #363, naming `spells` (undefined: its PR record is not read). */
export const edit = (date: string, spells?: string[], diff: HistoryEntry["diff"] = [["+", "| maxAmount | 10,000,000 USDC |"]]): HistoryEntry => ({
  date, commitHash: date, changeType: "modified", changeKind: "semantic", pr: 363, diff, ...(spells ? { spells } : {}),
});

/** A change spell `spell` made on Base to `subject` on the RateLimits. */
export const spellEntry = (spell: string, landed: string, subject = "0xother"): PauHistoryEntry => ({
  chain: "base", tx: `0x${landed}`, block: 1, time: `${landed}T00:00:00Z`, primes: ["spark"],
  origin: { kind: "spell", path: "op-stack", spell, starSpell: null, l1Tx: null, from: null, to: null, relay: null, evidence: "e" },
  executive: null,
  changes: [{ deployments: [DEP], contract: "0xrl", role: "rateLimits", event: "RateLimitDataSet", args: {}, subject, label: null, before: null }],
});

export const actionSet = (queued: string, executes: string | null, contract = "0xex"): PauQueuedStep => ({
  kind: "action-set", chain: "base", contract, id: "7", tx: "0xqueue", time: `${queued}T00:00:00Z`, at: executes && `${executes}T00:00:00Z`, primes: [],
});

/** The `date` executive; cast ones executed on `executed`. */
export const exec = (date: string, cast: boolean, executed: string | null = null, spell = "0xspell"): IndexedExecutive => ({
  date, title: `Executive ${date}`, url: `https://vote/${date}`, outOfSchedule: false, cast, spell, text: "", executed,
});

export const ctx = (today: string, o: Partial<PendingContext> = {}): PendingContext => ({
  executives: [], pau: { entries: [], queued: [] }, snaps: [snap()], today, ...o,
});
