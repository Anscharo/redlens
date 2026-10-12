// Folds stored PAU events, their origins and the executive records into the
// change history GET /api/pau/history serves: one entry per transaction that
// changed configuration, oldest first. Events of the governance contracts
// themselves (Plot, ActionsSet*, the Configurator's) are evidence of origin and
// never entries. Pure.
import type { ExecutiveRef, PauChange, PauHistoryEntry, PauOrigin } from "../../lib/pauHistory.ts";
import { deploymentId, type PauRegistry } from "../../lib/pauRegistry.ts";
import { subjectKey } from "./admin-events.ts";
import { ORIGIN_EVENTS } from "./governance-events.ts";
import { roleName } from "./replay.ts";

export interface EventRow {
  chain: string;
  tx: string;
  contract: string;
  event: string;
  args: Record<string, unknown>;
  block: number;
  time: string;
}

interface Owner {
  role: string;
  deployments: string[];
  primes: string[];
}

/** Each registry deployment contract's role, deployments and primes, by chain:address. */
export function ownersOf(reg: PauRegistry): Map<string, Owner> {
  const out = new Map<string, Owner>();
  for (const d of reg.deployments) {
    for (const m of d.members) {
      const key = `${d.chain}:${m.address}`;
      const o = out.get(key) ?? { role: m.role, deployments: [], primes: [] };
      o.deployments.push(deploymentId(d));
      if (!o.primes.includes(d.prime)) o.primes.push(d.prime);
      out.set(key, o);
    }
  }
  return out;
}

// Events that set a value (a limit, a parameter); role, membership and
// integration events add or remove, so they have no "before".
const SETS_VALUE = (event: string) => !/^(Role|Integration)|(Added|Removed)$/.test(event);

/** Builds each change, remembering every value's last setting so the next one can say what it replaced. */
function changeMaker() {
  const last = new Map<string, Record<string, unknown>>();
  return (e: EventRow, owner: Owner | undefined): PauChange => {
    const subject = e.args[subjectKey(e.event) ?? ""];
    const key = `${e.chain}:${e.contract}:${e.event}:${String(subject)}`;
    const before = SETS_VALUE(e.event) ? (last.get(key) ?? null) : null;
    if (SETS_VALUE(e.event)) last.set(key, e.args);
    const label = e.event.startsWith("Role") ? roleName(String(e.args.role)) : null;
    const base = { deployments: owner?.deployments ?? [], contract: e.contract, role: owner?.role ?? "shared", event: e.event, args: e.args };
    return { ...base, subject: subject === undefined ? null : String(subject), label, before };
  };
}

type ExecutiveOf = (spell: string) => ExecutiveRef;

export function buildEntries(rows: EventRow[], owners: Map<string, Owner>, origins: Map<string, PauOrigin>, executiveOf: ExecutiveOf): PauHistoryEntry[] {
  const byTx = new Map<string, PauHistoryEntry>();
  const changeOf = changeMaker();
  const blank = (e: EventRow, key: string): PauHistoryEntry => ({ chain: e.chain, tx: e.tx, block: e.block, time: e.time, primes: [], origin: origins.get(key) ?? null, executive: null, changes: [] });
  for (const e of rows.filter((x) => !ORIGIN_EVENTS.has(x.event))) {
    const key = `${e.chain}:${e.tx}`;
    const owner = owners.get(`${e.chain}:${e.contract}`);
    const entry = byTx.get(key) ?? blank(e, key);
    for (const p of owner?.primes ?? []) if (!entry.primes.includes(p)) entry.primes.push(p);
    entry.changes.push(changeOf(e, owner));
    byTx.set(key, entry);
  }
  const entries = [...byTx.values()];
  for (const x of entries) if (x.origin?.kind === "spell" && x.origin.spell) x.executive = executiveOf(x.origin.spell);
  return entries.sort((a, b) => a.time.localeCompare(b.time) || a.chain.localeCompare(b.chain));
}
