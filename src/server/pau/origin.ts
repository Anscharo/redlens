// Resolves where each stored PAU configuration change came from and writes it
// to pau_tx_origin, one row per transaction. The rules (ORIGIN_RULES) run in
// order and the first that applies decides; a new path is a new entry there.
// Nothing is decided from an absence the history cannot vouch for: until every
// governance contract's events on the chain are read past the transaction, it
// stays unknown and is retried.
import type { PauOrigin } from "../../lib/pauHistory.ts";
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import type { SqlTag } from "../sql-types.ts";
import { OPERATOR_RULE, TX_RULE } from "./origin-direct.ts";
import { RELAY_RULE } from "./origin-relay.ts";
import { CAST_RULE, STAR_GUARD_RULE, origin, type OriginDeps, type OriginRule, type TxContext } from "./origin-rules.ts";
import { cursorsPast, eventsOfTx, pendingTxs, plotOf, queuedOf, saveOrigin } from "./origin-store.ts";
import { castIn } from "./casts.ts";
import { eventTargets } from "./sync-events.ts";

export const ORIGIN_RULES: OriginRule[] = [STAR_GUARD_RULE, RELAY_RULE, CAST_RULE, OPERATOR_RULE, TX_RULE];

const GOVERNANCE_ROLES = new Set(["starGuard", "executor", "configurator"]);

export async function resolveOrigin(c: TxContext, d: OriginDeps): Promise<PauOrigin> {
  if (!(await d.evidenceRead(c.chain, c.block))) return origin({ kind: "unknown", evidence: `governance events on ${c.chain} are not read to block ${c.block} yet` });
  for (const rule of ORIGIN_RULES) {
    if (!rule.applies(c, d)) continue;
    const o = await rule.resolve(c, d);
    if (o) return o;
  }
  return origin({ kind: "unknown", evidence: "no rule applied" });
}

/** Each registry contract's role, by chain:address. A shared contract keeps its shared role. */
export function rolesOf(reg: PauRegistry): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of [...reg.deployments, ...reg.shared]) for (const m of g.members) out.set(`${g.chain}:${m.address}`, m.role);
  return out;
}

export interface OriginIo {
  tx: OriginDeps["tx"];
  link: OriginDeps["link"];
}

/** The rules' evidence readers over one database and registry, plus the injected chain I/O. */
export function originDeps(db: SqlTag, reg: PauRegistry, io: OriginIo): OriginDeps {
  const roles = rolesOf(reg);
  const gov = eventTargets(reg).filter((t) => GOVERNANCE_ROLES.has(roles.get(`${t.chain}:${t.contract}`) ?? ""));
  return {
    roleOf: (chain, contract) => roles.get(`${chain}:${contract}`),
    cast: (tx, block) => castIn(db, tx, block),
    plot: (sg, star, block) => plotOf(db, sg, star, block),
    queued: (chain, ex, id) => queuedOf(db, chain, ex, id),
    ethereumEvents: (tx) => eventsOfTx(db, "ethereum", tx),
    evidenceRead: (chain, block) => {
      const mine = gov.filter((t) => t.chain === chain);
      return cursorsPast(db, chain, [...new Set(mine.map((t) => t.contract))], mine.length, block);
    },
    ...io,
  };
}

export interface OriginRun {
  resolved: number;
  /** How many of those are still unknown and will be retried. */
  unknown: number;
}

/** Resolves pending transactions, oldest first, until `deadline` (epoch ms) or none are left. */
export async function resolveOrigins(db: SqlTag, d: OriginDeps, opts: { deadline: number; retrySeconds: number; now?: () => number }): Promise<OriginRun> {
  const now = opts.now ?? Date.now;
  const pending = await pendingTxs(db, 500, new Date(now() - opts.retrySeconds * 1000));
  const run: OriginRun = { resolved: 0, unknown: 0 };
  for (const p of pending) {
    if (now() >= opts.deadline) break;
    const o = await resolveOrigin({ ...p, events: await eventsOfTx(db, p.chain, p.tx) }, d);
    await saveOrigin(db, p, o, new Date(now()));
    run.resolved++;
    if (o.kind === "unknown") run.unknown++;
  }
  return run;
}
