// What BeamState lets the Configurator (cBEAM) do to one RateLimits without a
// spell: set a key up to its default ("init") limit, or raise it by at most
// maxChange once per hop. A default set for this RateLimits wins; one left at
// zero falls back to the general default (rateLimits_ = address(0)), as
// BeamState.getInitRateLimits does. Values are read live, so a default whose
// event was never read still shows for every key the RateLimits holds; the
// replay adds when each was set, and the keys only BeamState names.
import type { BeamDefault, BeamLimits, SetAt } from "../../lib/pau.ts";
import { setAt, type PauEventRow } from "./replay.ts";
import type { ChainReader, ContractHistory } from "./snapshot.ts";

const ZERO = `0x${"0".repeat(40)}`;
type Scope = BeamDefault["scope"];
type Pair = { maxAmount: string; slope: string };

/** A chain's BeamState and its stored admin history. */
export interface BeamSource {
  address: string;
  history: ContractHistory;
}

export interface ReplayedBeam {
  /** The last AddRateLimits / DelRateLimits for this RateLimits; null when there was none. */
  registered: boolean | null;
  /** Each default in force, by `key:scope`. */
  defaults: Map<string, Pair & { setAt: SetAt }>;
}

/** BeamState's history as it bears on one RateLimits (lowercase address). */
export function replayBeam(events: PauEventRow[], rateLimits: string): ReplayedBeam {
  const out: ReplayedBeam = { registered: null, defaults: new Map() };
  for (const e of events) {
    const target = String(e.args.rateLimits_).toLowerCase();
    if (/^(Add|Del)RateLimits$/.test(e.event) && target === rateLimits) out.registered = e.event === "AddRateLimits";
    if (target !== rateLimits && target !== ZERO) continue;
    const at = `${String(e.args.key)}:${target === ZERO ? "general" : "contract"}`;
    if (e.event === "AddInitRateLimits") out.defaults.set(at, { maxAmount: String(e.args.maxAmount), slope: String(e.args.slope), setAt: setAt(e) });
    if (e.event === "DelInitRateLimits") out.defaults.delete(at);
  }
  return out;
}

const num = (v: unknown) => (typeof v === "bigint" ? v.toString() : null);
const pair = (v: unknown): Pair | null => (Array.isArray(v) ? { maxAmount: String(v[0]), slope: String(v[1]) } : null);
const isSet = (p: Pair | null | undefined): p is Pair => !!p && (p.maxAmount !== "0" || p.slope !== "0");

async function registration(read: ChainReader, chain: string, beam: string, rl: string) {
  const res = await read(chain, (["rateLimits", "getHop", "getMaxChange"] as const).map((functionName) => ({ address: beam, functionName, args: [rl] })));
  return { registered: typeof res[0] === "bigint" ? res[0] !== 0n : null, hop: num(res[1]), maxChange: num(res[2]) };
}

/** The default in force for each key: this RateLimits' own when set, else the general one; a failed read falls back to the replay. */
async function liveDefaults(read: ChainReader, chain: string, beam: string, rl: string, keys: string[], replayed: ReplayedBeam): Promise<BeamDefault[]> {
  const calls = keys.flatMap((key) => [rl, ZERO].map((target) => ({ address: beam, functionName: "initRateLimits" as const, args: [key, target] })));
  const res = await read(chain, calls);
  return keys.flatMap((key, i) => {
    const value = (scope: Scope, j: number) => pair(res[2 * i + j]) ?? replayed.defaults.get(`${key}:${scope}`);
    const own = value("contract", 0);
    const general = value("general", 1);
    const [v, scope]: [Pair, Scope] | [null, null] = isSet(own) ? [own, "contract"] : isSet(general) ? [general, "general"] : [null, null];
    if (!v) return [];
    return [{ key, maxAmount: v.maxAmount, slope: v.slope, scope, setAt: replayed.defaults.get(`${key}:${scope}`)?.setAt ?? null }];
  });
}

/** BeamState's hold on one RateLimits, or null when it does not manage that contract. */
export async function beamLimits(read: ChainReader, chain: string, beam: BeamSource, rateLimits: string, heldKeys: string[]): Promise<BeamLimits | null> {
  const rl = rateLimits.toLowerCase();
  const replayed = replayBeam(beam.history.events, rl);
  const live = await registration(read, chain, beam.address, rl);
  if (!(live.registered ?? replayed.registered)) return null;
  const keys = [...new Set([...heldKeys, ...[...replayed.defaults.keys()].map((k) => k.split(":")[0])])];
  const defaults = await liveDefaults(read, chain, beam.address, rl, keys, replayed);
  return { beamState: beam.address, hop: live.hop, maxChange: live.maxChange, defaults, historyComplete: beam.history.complete };
}
