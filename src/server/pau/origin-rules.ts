// The rules that say where one transaction's PAU changes came from, tried in
// order; the first rule that applies decides. Each rule reads only what the
// chain proves: stored events of governance contracts the registry lists, the
// DSPause cast list (casts.ts), a bridge message id (origin-links.ts) and the
// transaction itself. A rule that applies but lacks its evidence answers
// "unknown", which the worker retries, rather than letting a weaker rule claim
// the transaction.
import type { OriginPath, PauOrigin } from "../../lib/pauHistory.ts";

export interface TxEvent {
  contract: string;
  event: string;
  args: Record<string, unknown>;
}

export interface TxContext {
  chain: string;
  tx: string;
  block: number;
  events: TxEvent[];
}

export interface Located {
  tx: string;
  block: number;
}

export interface L1Link extends Located {
  path: Extract<OriginPath, "op-stack" | "arbitrum">;
  messageId: string;
}

export interface OriginDeps {
  /** The registry role of a contract on a chain (starGuard, executor, configurator, …). */
  roleOf: (chain: string, contract: string) => string | undefined;
  cast: (tx: string, block: number) => Promise<string | null | undefined>;
  plot: (starGuard: string, starSpell: string, atOrBefore: number) => Promise<Located | null>;
  queued: (chain: string, executor: string, id: number) => Promise<Located | null>;
  link: (chain: string, queued: Located) => Promise<L1Link | null>;
  /** The stored events of one Ethereum transaction (empty when it changed nothing on Ethereum). */
  ethereumEvents: (tx: string) => Promise<TxEvent[]>;
  tx: (chain: string, hash: string, block: number) => Promise<{ from: string; to: string | null } | null>;
  /** Whether every governance contract's events on `chain` are read past `block`, so an absent one is truly absent. */
  evidenceRead: (chain: string, block: number) => Promise<boolean>;
}

export interface OriginRule {
  id: string;
  applies: (c: TxContext, d: OriginDeps) => boolean;
  /** null: the rule does not decide after all, the next one is tried. */
  resolve: (c: TxContext, d: OriginDeps) => Promise<PauOrigin | null>;
}

const BLANK: PauOrigin = { kind: "unknown", path: null, spell: null, starSpell: null, l1Tx: null, from: null, to: null, relay: null, evidence: "" };
export const origin = (o: Partial<PauOrigin> & Pick<PauOrigin, "kind" | "evidence">): PauOrigin => ({ ...BLANK, ...o });

const from = (c: TxContext, d: OriginDeps, role: string, event: string) =>
  c.events.find((e) => e.event === event && d.roleOf(c.chain, e.contract) === role);

async function viaStarGuard(c: TxContext, d: OriginDeps): Promise<PauOrigin> {
  const exec = from(c, d, "starGuard", "Exec")!;
  const star = String(exec.args.addr);
  const plot = await d.plot(exec.contract, star, c.block);
  if (!plot) return origin({ kind: "unknown", starSpell: star, evidence: `StarGuard ${exec.contract} executed ${star}; no stored Plot for it yet` });
  const spell = await d.cast(plot.tx, plot.block);
  if (spell === undefined) return origin({ kind: "unknown", starSpell: star, evidence: `Plot tx ${plot.tx} is past the casts read so far` });
  if (spell === null) return origin({ kind: "unknown", starSpell: star, evidence: `Plot tx ${plot.tx} holds no DSPause.exec, so no spell plotted it` });
  const evidence = `StarGuard ${exec.contract} Exec(${star}); its Plot is in tx ${plot.tx}, where DSPause.exec ran spell ${spell}`;
  return origin({ kind: "spell", path: "starguard", spell, starSpell: star, l1Tx: c.tx, evidence });
}

async function viaCast(c: TxContext, d: OriginDeps): Promise<PauOrigin | null> {
  const spell = await d.cast(c.tx, c.block);
  if (spell === undefined) return origin({ kind: "unknown", evidence: `the DSPause casts are not read to block ${c.block} yet` });
  if (spell === null) return null;
  return origin({ kind: "spell", path: "direct", spell, l1Tx: c.tx, evidence: `DSPause.exec in this tx ran spell ${spell}` });
}

export const STAR_GUARD_RULE: OriginRule = { id: "starguard", applies: (c, d) => !!from(c, d, "starGuard", "Exec"), resolve: viaStarGuard };
export const CAST_RULE: OriginRule = { id: "cast", applies: (c) => c.chain === "ethereum", resolve: viaCast };

/** The Ethereum rules alone, for the L1 transaction a relay came from. */
export async function ethereumOrigin(c: TxContext, d: OriginDeps): Promise<PauOrigin | null> {
  for (const rule of [STAR_GUARD_RULE, CAST_RULE]) if (rule.applies(c, d)) return rule.resolve(c, d);
  return null;
}
