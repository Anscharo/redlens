// What each per-address parameter is set on: the subject's own symbol and
// decimals (an aToken, a vault, a Curve pool's LP token), and for a max
// exchange rate the vault's asset, so a reader can show "spUSDC" instead of a
// hash and the rate as assets per share. Only what the chain answers is
// attached; a subject whose decimals() fails (an OTC desk, a pool with no LP
// token) keeps none.
import type { AmountUnit, PauParam, PauSnapshot } from "../../lib/pau.ts";
import { EVM_ADDRESS_EXACT_RE } from "../../lib/patterns.ts";
import type { ChainReader } from "./snapshot.ts";
import { tokenUnits } from "./units.ts";

/** Events whose value is a 1e36-scaled assets-per-share rate of the subject vault. */
export const EXCHANGE_RATE_EVENTS = new Set(["MaxExchangeRateSet", "ERC4626MaxExchangeRateSet"]);

const isAddress = (s: string) => EVM_ADDRESS_EXACT_RE.test(s);

/** Each exchange-rate vault's asset(), lower-cased; a failed read is left out. */
async function assetsOf(read: ChainReader, chain: string, vaults: string[]): Promise<Map<string, string>> {
  const res = await read(chain, vaults.map((address) => ({ address, functionName: "asset" as const, args: [] })));
  return new Map(vaults.flatMap((v, i) => (typeof res[i] === "string" ? [[v, (res[i] as string).toLowerCase()] as [string, string]] : [])));
}

/** The snapshot with each address-keyed parameter's subject token, and an exchange-rate vault's asset, attached where the chain answers. */
export async function withParamSubjects(snap: PauSnapshot, read: ChainReader): Promise<PauSnapshot> {
  const params = snap.contracts.flatMap((c) => c.params ?? []);
  const subjects = [...new Set(params.map((p) => p.subject.toLowerCase()).filter(isAddress))];
  if (subjects.length === 0) return snap;
  const vaults = [...new Set(params.filter((p) => EXCHANGE_RATE_EVENTS.has(p.event)).map((p) => p.subject.toLowerCase()).filter(isAddress))];
  const assets = vaults.length ? await assetsOf(read, snap.chain, vaults) : new Map<string, string>();
  const units = await tokenUnits(read, snap.chain, [...new Set([...subjects, ...assets.values()])]);
  const attach = (p: PauParam): PauParam => {
    const s = p.subject.toLowerCase();
    const subjectToken: AmountUnit | undefined = units.get(s);
    const asset = EXCHANGE_RATE_EVENTS.has(p.event) ? units.get(assets.get(s) ?? "") : undefined;
    return { ...p, ...(subjectToken ? { subjectToken } : {}), ...(asset ? { asset } : {}) };
  };
  return { ...snap, contracts: snap.contracts.map((c) => (c.params ? { ...c, params: c.params.map(attach) } : c)) };
}
