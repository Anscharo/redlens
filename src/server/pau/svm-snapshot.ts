// One svm deployment's snapshot (the Solana ALM program), read live, in the
// shape every PAU reader already takes: each Reserve's and Integration's limit
// is a rate limit keyed by its account's address, on a "rateLimits" contract
// (the controller's state account); each Permission is its own contract with
// its authority as the role holder, holding while its status is Active. The
// program stores a slope per day and an unlimited maximum as u64::MAX; they
// are stored as the EVM controllers keep them (per second, rounded down, and
// the uint256 maximum), so one verdict reads both.
//
// Not set: a stated Integration account, or the Reserve of a stated mint, that
// does not exist (svm-probe.ts), lowercased as every reader compares keys; a
// missing Reserve is keyed "reserve:<mint>", since its address is derived. No history is read, so nothing has a `setAt`
// time and `historyComplete` is false.
import { decodeBase58, encodeBase58, findProgramAddress } from "../../../scripts/lib/solana-pda.mjs";
import type { ContractState, LiveRateLimit, PauSnapshot, SetAt } from "../../lib/pau.ts";
import { deploymentId, membersOf, type PauDeployment, type PauRole } from "../../lib/pauRegistry.ts";
import { decodeIntegration, decodePermission, decodeReserve, mintDecimals, U64_MAX, type SvmIntegration, type SvmLimitState, type SvmReserve } from "./svm-layout.ts";
import type { SvmProbe } from "./svm-probe.ts";
import type { SvmAccounts } from "./svm-reader.ts";

const UNLIMITED = ((1n << 256n) - 1n).toString();
const DAY = 86_400n;
const DRIFT = "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH";
/** A Drift SpotMarket's mint: after its 8-byte discriminator, its own address and its oracle. */
const DRIFT_MINT_AT = 8 + 32 + 32;
const NO_HISTORY: SetAt = { block: 0, time: "", tx: "" };
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Where the controller's Reserve for a mint lives (seeds "reserve", controller, mint). */
export const reserveAddress = (program: string, controller: string, mint: string): string =>
  findProgramAddress([utf8("reserve"), decodeBase58(controller), decodeBase58(mint)], program).address;

/** Where Drift keeps a spot market (seeds "spot_market", index as u16). */
export function driftMarket(index: number): string {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, index, true);
  return findProgramAddress([utf8("spot_market"), b], DRIFT).address;
}

const only = (d: PauDeployment, role: PauRole) => {
  const [m, ...rest] = membersOf(d, role);
  if (!m || rest.length) throw new Error(`${deploymentId(d)} needs exactly one ${role}`);
  return m.address;
};

/** The accounts among `addresses` that exist and belong to the controller, decoded. */
function decodeAll<T extends { controller: string }>(acc: Map<string, Uint8Array | null>, addresses: string[], decode: (b: Uint8Array) => T, controller: string): Map<string, T> {
  return new Map(addresses.flatMap((a) => {
    const b = acc.get(a);
    const x = b ? decode(b) : null;
    return x && x.controller === controller ? [[a, x] as const] : [];
  }));
}

/** A limit in the EVM controllers' terms. */
function limit(address: string, s: SvmLimitState, svm: NonNullable<LiveRateLimit["svm"]>, decimals: number | null): LiveRateLimit {
  const maxAmount = s.maxOutflow === U64_MAX ? UNLIMITED : s.maxOutflow.toString();
  const slope = (s.slope / DAY).toString();
  return {
    key: address, configured: { maxAmount, slope }, setAt: NO_HISTORY, changes: 0,
    data: { maxAmount, slope, lastAmount: s.available.toString(), lastUpdated: "0" }, available: s.available.toString(), svm,
    ...(decimals !== null && svm.mint ? { unit: { decimals, symbol: null, token: svm.mint, source: "token" as const } } : {}),
  };
}

/** A Permission's role, by what its flags let it do. */
const roleName = (flags: string[]) =>
  flags.includes("can_manage_reserves_and_integrations") ? "DEFAULT_ADMIN_ROLE" : flags.includes("can_freeze_controller") ? "FREEZER" : flags.includes("can_execute_swap") ? "RELAYER" : flags.join(" ") || "NONE";

const contract = (role: PauRole, address: string, extra: Partial<ContractState> = {}): ContractState => ({ role, address, events: 0, historyComplete: false, ...extra });

/** Each Permission as its own contract, its authority holding the role its flags grant while it is Active. */
const permissionContracts = (acc: Map<string, Uint8Array | null>, perms: string[]): ContractState[] =>
  perms.flatMap((a) => {
    const b = acc.get(a);
    const p = b ? decodePermission(b) : null;
    return p ? [contract("permission", a, { roles: [{ role: "permission", account: p.authority, since: null, name: roleName(p.flags), holds: p.status === "Active" }] })] : [];
  });

/** Each Integration's mint: its own, else, for Drift, its spot market's. */
async function integrationMints(read: SvmAccounts, ints: Map<string, SvmIntegration>): Promise<Map<string, string>> {
  const drift = [...ints].filter(([, x]) => x.config.type === "Drift").map(([a, x]) => [a, driftMarket(x.config.spotMarketIndex ?? 0)] as const);
  const markets = drift.length ? await read(drift.map(([, m]) => m)) : new Map<string, Uint8Array | null>();
  const fromMarket = (m: string) => markets.get(m)?.slice(DRIFT_MINT_AT, DRIFT_MINT_AT + 32);
  const out = new Map([...ints].flatMap(([a, x]) => (x.config.mint ?? x.config.input ? [[a, (x.config.mint ?? x.config.input)!] as const] : [])));
  for (const [a, m] of drift) if (fromMarket(m)?.length === 32) out.set(a, encodeBase58(fromMarket(m)!));
  return out;
}

/** The deployment's snapshot, read live. */
export async function svmSnapshot(d: PauDeployment, read: SvmAccounts, probe: SvmProbe = { integrations: [], mints: [] }): Promise<PauSnapshot> {
  const program = only(d, "program");
  const controller = only(d, "rateLimits");
  const reserveOf = new Map(probe.mints.map((m) => [m, reserveAddress(program, controller, m)]));
  const reserveAddrs = [...new Set([...membersOf(d, "reserve").map((m) => m.address), ...reserveOf.values()])];
  const intAddrs = [...new Set([...membersOf(d, "integration").map((m) => m.address), ...probe.integrations])];
  const perms = membersOf(d, "permission").map((m) => m.address);
  const acc = await read([...reserveAddrs, ...intAddrs, ...perms]);
  const reserves: Map<string, SvmReserve> = decodeAll(acc, reserveAddrs, decodeReserve, controller);
  const ints: Map<string, SvmIntegration> = decodeAll(acc, intAddrs, decodeIntegration, controller);
  const intMint = await integrationMints(read, ints);
  const mints = [...new Set([...[...reserves.values()].map((r) => r.mint), ...intMint.values()])];
  const mintAcc = await read(mints);
  const dec = (m: string | undefined) => (m && mintAcc.get(m) ? mintDecimals(mintAcc.get(m)!) : null);
  const limits = [
    ...[...reserves].map(([a, r]) => limit(a, r, { account: "reserve", type: "Reserve", mint: r.mint, status: r.status }, dec(r.mint))),
    ...[...ints].map(([a, x]) => limit(a, x, { account: "integration", type: x.config.type, description: x.description, mint: intMint.get(a), ...(x.config.output ? { output: x.config.output } : {}), status: x.status }, dec(intMint.get(a)))),
  ];
  const unsetKeys = [...probe.integrations.filter((a) => acc.get(a) === null), ...[...reserveOf].filter(([, a]) => acc.get(a) === null).map(([m]) => `reserve:${m}`)].map((k) => k.toLowerCase());
  const contracts = [contract("program", program), contract("rateLimits", controller, { rateLimits: limits, unsetKeys }), ...permissionContracts(acc, perms)];
  return { deployment: deploymentId(d), prime: d.prime, primeName: d.primeName, chain: d.chain, kind: d.kind, contracts };
}
