// The origin rules over fake evidence: which rule decides, and that a rule
// lacking its evidence answers unknown instead of letting a weaker one claim the
// transaction.
import { describe, expect, it } from "bun:test";
import { resolveOrigin } from "./origin.ts";
import type { OriginDeps, TxContext, TxEvent } from "./origin-rules.ts";

const SG = "0x6605aa120fe8b656482903e7757babf56947e45e";
const EX = "0xb037c43b433964a2017cd689f535beb6b0531473";
const CFG = "0xb7e61df6cab0a51e9a5dab1a7dd3f942dde5b929";
const SPELL = "0xed3de16bdf69f697fecf1b4103b9f48d71bddf20";
const STAR = "0x63fa202a7020e8ee0837196783f0fb768cbfe2f1";
const ROLES: Record<string, string> = { [`ethereum:${SG}`]: "starGuard", [`unichain:${EX}`]: "executor", [`ethereum:${CFG}`]: "configurator" };

function deps(over: Partial<OriginDeps> = {}): OriginDeps {
  return {
    roleOf: (chain, contract) => ROLES[`${chain}:${contract}`],
    cast: async (tx) => (tx === "0xplot" || tx === "0xcast" ? SPELL : null),
    plot: async (sg, star) => (sg === SG && star === STAR ? { tx: "0xplot", block: 10 } : null),
    queued: async () => ({ tx: "0xqueue", block: 5 }),
    link: async () => ({ tx: "0xl1", block: 20, path: "op-stack", messageId: "0xsource" }),
    ethereumEvents: async () => [{ contract: SG, event: "Exec", args: { addr: STAR } }],
    tx: async () => ({ from: "0xkeeper", to: "0xsafe" }),
    evidenceRead: async () => true,
    ...over,
  };
}

const rl: TxEvent = { contract: "0xrl", event: "RateLimitDataSet", args: {} };
const ctx = (chain: string, events: TxEvent[], tx = "0xtx"): TxContext => ({ chain, tx, block: 30, events: [rl, ...events] });

describe("resolveOrigin", () => {
  it("credits a StarGuard execution to the spell whose cast plotted it", async () => {
    const o = await resolveOrigin(ctx("ethereum", [{ contract: SG, event: "Exec", args: { addr: STAR } }]), deps());
    expect(o).toMatchObject({ kind: "spell", path: "starguard", spell: SPELL, starSpell: STAR, l1Tx: "0xtx" });
  });
  it("stays unknown while the Plot or the casts are missing", async () => {
    const exec = [{ contract: SG, event: "Exec", args: { addr: STAR } }];
    expect((await resolveOrigin(ctx("ethereum", exec), deps({ plot: async () => null }))).kind).toBe("unknown");
    expect((await resolveOrigin(ctx("ethereum", exec), deps({ cast: async () => undefined }))).kind).toBe("unknown");
  });
  it("credits a direct cast, and waits while the casts are not read that far", async () => {
    expect(await resolveOrigin(ctx("ethereum", [], "0xcast"), deps())).toMatchObject({ kind: "spell", path: "direct", spell: SPELL });
    expect((await resolveOrigin(ctx("ethereum", []), deps({ cast: async () => undefined }))).kind).toBe("unknown");
  });
  it("follows a relayed action set to the spell behind its proven L1 transaction", async () => {
    const o = await resolveOrigin(ctx("unichain", [{ contract: EX, event: "ActionsSetExecuted", args: { id: "2" } }]), deps());
    expect(o).toMatchObject({ kind: "spell", path: "op-stack", spell: SPELL, l1Tx: "0xl1", relay: { executor: EX, actionsSet: 2, queueTx: "0xqueue", messageId: "0xsource" } });
  });
  it("shows an unproven relay as relayed, with no spell", async () => {
    const o = await resolveOrigin(ctx("unichain", [{ contract: EX, event: "ActionsSetExecuted", args: { id: "2" } }]), deps({ link: async () => null }));
    expect(o).toMatchObject({ kind: "relayed", spell: null, l1Tx: null, relay: { executor: EX, actionsSet: 2, queueTx: "0xqueue" } });
  });
  it("stays unknown when the bridge read fails, rather than calling the relay unproven", async () => {
    const o = await resolveOrigin(ctx("unichain", [{ contract: EX, event: "ActionsSetExecuted", args: { id: "2" } }]), deps({ link: async () => Promise.reject(new Error("HTTP 429")) }));
    expect(o).toMatchObject({ kind: "unknown", relay: { actionsSet: 2 } });
  });
  it("credits a Configurator change to the operator that called it", async () => {
    const o = await resolveOrigin(ctx("ethereum", [{ contract: CFG, event: "SetRateLimit", args: {} }]), deps());
    expect(o).toMatchObject({ kind: "operator", from: "0xkeeper", to: "0xsafe" });
  });
  it("reads the rest from the transaction: a creation, or a direct call", async () => {
    expect((await resolveOrigin(ctx("base", []), deps({ tx: async () => ({ from: "0xdeployer", to: null }) }))).kind).toBe("deployment");
    expect(await resolveOrigin(ctx("base", []), deps())).toMatchObject({ kind: "direct", from: "0xkeeper", to: "0xsafe" });
    expect((await resolveOrigin(ctx("base", []), deps({ tx: async () => null }))).kind).toBe("unknown");
  });
  it("decides nothing before the chain's governance events are read past the transaction", async () => {
    expect((await resolveOrigin(ctx("base", []), deps({ evidenceRead: async () => false }))).kind).toBe("unknown");
  });
});
