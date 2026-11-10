// Shared fixtures for the on-chain step tests: one Spark deployment on Base
// administered by its Executor, a key it holds, the atlas change that wrote a
// value and the spells it names, a spell's PAU changes, queued action sets and
// vote-record executives.
import type { HistoryEntry } from "./history.ts";
import type { StoredPauSnapshot } from "./pau.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import type { PauHistoryEntry, PauQueuedStep } from "./pauHistory.ts";
import type { PendingContext } from "./pauPending.ts";
import type { PrimePoll } from "./primePolls.ts";
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

/** The atlas change that wrote the stated value on `date`, by a fixture pull request, naming `spells` (undefined: its PR record is not read). */
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

/** Keel's Solana deployment: its limits on the controller, keyed by account, and its admin and Freezer Permissions. */
export const SVM_ADMIN = "FDFsoboECfazAq1eLvwBLZXhoxjPvTy4wCzPdbqnk7Zk";
export const SVM_ACCOUNT = "3vFbJmcbVrGTzZM1rZUBnpvWkkvKpbJEy6ZqgaGMBAJt";
export const svmSnap = (adminHolds = true): StoredPauSnapshot => {
  const perm = (address: string, account: string, name: string, holds: boolean) => ({ role: "permission" as const, address, events: 0, historyComplete: true, roles: [{ role: "permission", account, name, since: null, holds }] });
  return {
    deployment: "bc6aed17-2969-4d04-9af6-c7bf3e4497e6:solana:svm", prime: "bc6aed17-2969-4d04-9af6-c7bf3e4497e6", primeName: "Keel", chain: "solana", kind: "svm", fetchedAt: "2026-11-10T00:00:00Z",
    contracts: [
      { role: "rateLimits", address: "EeobZr57FSmNvw8Hs719iULJNqv3XLrTB5uPezvC2ND3", events: 0, historyComplete: true, rateLimits: [{ ...limit("2026-07-01"), key: SVM_ACCOUNT }] },
      perm("Gwn4JH8UZYxtx1w5WAwapJSFw97Pwo6gzRF3hSvCmC81", SVM_ADMIN, "DEFAULT_ADMIN_ROLE", adminHolds),
      perm("EREEUH114dTibhZcgdQfL8gRgfDA8psNkqrkqdrd7btk", "PcJcgdWmFZznhhfN28i6T8GHcwA6jmFGuUeNNGvcSY2", "DEFAULT_ADMIN_ROLE", false),
      perm("B24DtbKAV25fcZ6e3buqfB8CSuuiFLRsHHojBGigntff", "FreezerKey11111111111111111111111111111111", "FREEZER", true),
    ],
  };
};
/** A Solana Integration's limit the atlas states, as the check keys it (the account, lowercased). */
export const svmCheck = (status: ValueCheck["status"], extra: Partial<ValueCheck> = {}): ValueCheck =>
  check(status, "2026-07-01", { chain: "solana", kind: "svm", contract: "EeobZr57FSmNvw8Hs719iULJNqv3XLrTB5uPezvC2ND3", key: SVM_ACCOUNT.toLowerCase(), ...extra });
/** A LayerZero governance message sent on `sent` that no Solana receipt holds. */
export const lzMessage = (sent: string): PauQueuedStep => ({
  kind: "lz-message", chain: "ethereum", contract: "0x27fc1dd771817b53be48dc28789533bea53c9cca", id: "0xguid", tx: "0xsend", time: `${sent}T00:00:00Z`, at: null, primes: [],
});

/** A Prime Snapshot poll linking PR 363 (the fixture's writing change), proposed in the `threadDate` spell's thread. */
export const poll = (id: string, o: Partial<PrimePoll> = {}): PrimePoll => ({
  id, space: "grovefinance.eth", title: "[Base] Raise the deposit rate limit", end: "2026-10-29", passed: true, threadDate: "2026-11-05", prs: [363], ...o,
});

/** The `date` executive; cast ones executed on `executed`. */
export const exec = (date: string, cast: boolean, executed: string | null = null, spell = "0xspell"): IndexedExecutive => ({
  date, title: `Executive ${date}`, url: `https://vote/${date}`, outOfSchedule: false, cast, spell, text: "", executed,
});

export const ctx = (today: string, o: Partial<PendingContext> = {}): PendingContext => ({
  executives: [], pau: { entries: [], queued: [] }, snaps: [snap()], today, now: Date.parse(`${today}T12:00:00Z`), openPrs: [], pollsByPr: new Map(), snapshots: new Map(), ...o,
});
