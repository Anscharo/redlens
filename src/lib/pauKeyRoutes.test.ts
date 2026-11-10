// Who can change a rate limit, and the Operator's reach, by the atlas's rules:
// lower at any time; raise to at most max(current × maxChange, default), a hop
// apart since the last raise; a limit locked as unlimited never moves; no
// Operator route without BeamState and the Configurator's admin role.
import { describe, expect, it } from "vitest";
import type { StoredPauSnapshot } from "./pau.ts";
import { check } from "./pauPending.fixture.ts";
import { keyRoutes, raisesTo, statedRaw } from "./pauKeyRoutes.ts";
import { routesText } from "./pauRouteText.ts";

const UNLIMITED = ((1n << 256n) - 1n).toString();
const WAD = 10n ** 18n;
const E6 = 10n ** 6n;
const CONF = "0xconf";
const ADMIN = "0xsubproxy";
const NOW = Date.parse("2026-11-10T12:00:00Z");
const HOP = 57_600;

/** A USDC rate limit holding `max`, with BeamState's bounds and an optional default. */
function snapWith(max: bigint, o: { dflt?: bigint; beam?: boolean; confAdmin?: boolean } = {}): StoredPauSnapshot {
  const lim = { key: "0xk", configured: { maxAmount: String(max), slope: "0" }, setAt: { block: 1, time: "2026-07-01T00:00:00Z", tx: "0xt" }, changes: 1, available: "0",
    data: { maxAmount: String(max), slope: "0", lastAmount: "0", lastUpdated: "0" }, unit: { decimals: 6, symbol: "USDC", source: "token" as const } };
  const roles = [{ role: "0x0", name: "DEFAULT_ADMIN_ROLE", account: ADMIN, since: lim.setAt, holds: true }, ...(o.confAdmin === false ? [] : [{ role: "0x0", name: "DEFAULT_ADMIN_ROLE", account: CONF, since: lim.setAt, holds: true }])];
  const defaults = o.dflt === undefined ? [] : [{ key: "0xk", maxAmount: String(o.dflt), slope: "0", scope: "contract" as const, setAt: null }];
  const beam = o.beam === false ? {} : { beam: { beamState: "0xbs", configurator: CONF, hop: String(HOP), maxChange: String((12n * WAD) / 10n), defaults, historyComplete: true } };
  return { deployment: "p:base:monolithic", prime: "p", primeName: "Grove", chain: "base", kind: "monolithic", fetchedAt: "t", contracts: [{ role: "rateLimits", address: "0xrl", events: 1, historyComplete: true, rateLimits: [lim], roles, ...beam }] };
}
const stated = (s: string, max: bigint) => check("mismatch", "2026-07-01", { stated: s, limit: snapWith(max).contracts[0].rateLimits![0] });
const reach = (s: string, max: bigint, o = {}) => keyRoutes(stated(s, max), [snapWith(max, o)], { entries: [], queued: [] }, NOW)?.operator?.reach;

describe("raisesTo", () => {
  it("compounds by maxChange, takes the default when it is higher, and stops when the bound stops growing", () => {
    expect(raisesTo(100n, 144n, 0n, (12n * WAD) / 10n)).toBe(2);
    expect(raisesTo(0n, 50n, 100n, (12n * WAD) / 10n)).toBe(1);
    expect(raisesTo(0n, 50n, 0n, (12n * WAD) / 10n)).toBeNull();
    expect(raisesTo(100n, 101n, 0n, 0n)).toBeNull();
  });
});

describe("keyRoutes", () => {
  it("states the value in raw units, a slope per second", () => {
    expect(statedRaw(stated("20,000,000 USDC", 0n))).toBe(20_000_000n * E6);
    expect(statedRaw({ ...stated("86,400 USDC per day", 0n), field: "slope" })).toBe(E6);
    const noUnit = { ...stated("20,000,000 USDC", 0n), limit: { ...stated("x", 0n).limit!, unit: undefined } };
    expect(statedRaw(noUnit)).toBe(20_000_000n * E6);
    expect(statedRaw({ ...noUnit, stated: "20,000,000 USDS or USDC" })).toBeNull();
  });
  it("lists the spell admin apart from the Configurator, and has no Operator route without BeamState or its admin role", () => {
    expect(keyRoutes(stated("1 USDC", 0n), [snapWith(0n)], { entries: [], queued: [] }, NOW)?.admins).toEqual([ADMIN]);
    expect(keyRoutes(stated("1 USDC", 0n), [snapWith(0n, { beam: false })], { entries: [], queued: [] }, NOW)?.operator).toBeNull();
    expect(keyRoutes(stated("1 USDC", 0n), [snapWith(0n, { confAdmin: false })], { entries: [], queued: [] }, NOW)?.operator).toBeNull();
  });
  it("lowers at any time, raises in steps a hop apart, and falls short where neither the default nor the step bound reaches", () => {
    expect(reach("10 USDC", 20n * E6)).toEqual({ kind: "lower" });
    expect(reach("144 USDC", 100n * E6)).toEqual({ kind: "raise", raises: 2, first: new Date(NOW).toISOString(), last: new Date(NOW + HOP * 1000).toISOString() });
    expect(reach("50 USDC", 0n, { dflt: 100n * E6 })).toMatchObject({ kind: "raise", raises: 1 });
    expect(reach("50 USDC", 0n)).toEqual({ kind: "beyond" });
  });
  it("waits a hop after the Operator's last raise to the key", () => {
    const raised = { chain: "base", tx: "0xr", block: 1, time: new Date(NOW - 3600_000).toISOString(), primes: ["p"], executive: null,
      origin: { kind: "operator" as const, path: null, spell: null, starSpell: null, l1Tx: null, from: null, to: null, relay: null, evidence: "e" },
      changes: [{ deployments: [], contract: "0xrl", role: "rateLimits", event: "RateLimitDataSet", args: { maxAmount: "100" }, subject: "0xk", label: null, before: { maxAmount: "50" } }] };
    const r = keyRoutes(stated("110 USDC", 100n * E6), [snapWith(100n * E6)], { entries: [raised], queued: [] }, NOW)?.operator?.reach;
    expect(r).toMatchObject({ kind: "raise", raises: 1, first: new Date(NOW - 3600_000 + HOP * 1000).toISOString() });
  });
  it("keeps a limit locked as unlimited where it is", () => {
    expect(reach("10 USDC", BigInt(UNLIMITED))).toEqual({ kind: "locked" });
    expect(reach("10 USDC", 20n * E6, { dflt: BigInt(UNLIMITED) })).toEqual({ kind: "locked" });
  });
  it("says who can set it, in words", () => {
    const r = keyRoutes(stated("50 USDC", 0n), [snapWith(0n)], { entries: [], queued: [] }, NOW)!;
    expect(routesText(r)).toMatch(/^Set by a spell, through 0xsubp…roxy, or through the Configurator, where the Operator cannot raise it that far/);
  });
});
