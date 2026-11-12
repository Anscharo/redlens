// The Solana origin rule over fake evidence. Pinned: a change in a
// transaction holding a governance receipt is the spell behind the Ethereum
// transaction whose GovernanceCallSent names the receipt's guid (path
// "layerzero", the message as the relay); relayed without a spell while that
// send is unstored or proves none; unknown while Ethereum is unread past it;
// a change with no receipt is a direct call signed by its authority; nothing is
// decided while the receipts are unread past the slot.
import { describe, expect, it } from "bun:test";
import { resolveOrigin } from "./origin.ts";
import type { OriginDeps, TxContext, TxEvent } from "./origin-rules.ts";

const GOV = "SKYGRikJcGSa3jC5HDyzDrVsmkCk3e5SqAurycny8PW";
const SG = "0x6605aa120fe8b656482903e7757babf56947e45e";
const STAR = "0x63fa202a7020e8ee0837196783f0fb768cbfe2f1";
const SPELL = "0xed3de16bdf69f697fecf1b4103b9f48d71bddf20";
const GUID = "0x410dd975b765e87168ac2a1837452aff2a39e08afb4f95f4909d6c0e8325be5f";
const SUBPROXY = "0x355cd90ecb1b409fdf8b64c4473c3b858da2c310";
const ALM = "ALM1JSnEhc5PkNecbSZotgprBuJujL5objTbwGtpTgTd";
const ROLES: Record<string, string> = { [`solana:${GOV}`]: "lzGovernance", [`solana:${ALM}`]: "program", [`ethereum:${SG}`]: "starGuard" };

function deps(over: Partial<OriginDeps> = {}): OriginDeps {
  return {
    roleOf: (chain, contract) => ROLES[`${chain}:${contract}`],
    cast: async (tx) => (tx === "0xplot" ? SPELL : null),
    plot: async () => ({ tx: "0xplot", block: 10 }),
    queued: async () => null,
    link: async () => null,
    ethereumEvents: async () => [{ contract: SG, event: "Exec", args: { addr: STAR } }],
    tx: async () => null,
    evidenceRead: async () => true,
    lzSent: async (guid) => (guid === GUID ? { tx: "0xsend", block: 25_072_324 } : null),
    ...over,
  };
}

const change: TxEvent = { contract: "H5Vix4RGchYq1cemoe61y7J4j4v3XgWPGLBeqvPEgvzr", event: "IntegrationUpdate", args: { authority: "FDFsoboECfazAq1eLvwBLZXhoxjPvTy4wCzPdbqnk7Zk" } };
const receipt: TxEvent = { contract: GOV, event: "LzReceive", args: { guid: GUID, nonce: "6", origin: SUBPROXY, target: ALM } };
const ctx = (events: TxEvent[]): TxContext => ({ chain: "solana", tx: "sig", block: 420_000_000, events });

describe("SVM_RULE", () => {
  it("takes a receipt whose message calls another program for no evidence about the change", async () => {
    const other = { ...receipt, args: { ...receipt.args, target: "SKYTAiJRkgexqQqFoqhXdCANyfziwrVrzjhBaCzdbKW" } };
    expect(await resolveOrigin(ctx([other, change]), deps())).toMatchObject({ kind: "direct", from: "FDFsoboECfazAq1eLvwBLZXhoxjPvTy4wCzPdbqnk7Zk" });
  });
  it("names the spell that sent the message the receipt carries", async () => {
    const o = await resolveOrigin(ctx([receipt, change]), deps());
    expect(o).toMatchObject({ kind: "spell", path: "layerzero", spell: SPELL, starSpell: STAR, l1Tx: "0xsend" });
    expect(o.relay).toEqual({ via: "layerzero", executor: GOV, actionsSet: 6, messageId: GUID, sender: SUBPROXY, queueTx: "0xsend" });
    expect(o.evidence).toContain(`message ${GUID} (nonce 6) from ${SUBPROXY}`);
  });
  it("says relayed while the send is unstored or proves no spell, and unknown while Ethereum is unread", async () => {
    expect(await resolveOrigin(ctx([receipt, change]), deps({ lzSent: async () => null }))).toMatchObject({ kind: "relayed", path: "layerzero", spell: null, l1Tx: null });
    expect(await resolveOrigin(ctx([receipt, change]), deps({ ethereumEvents: async () => [], cast: async () => null }))).toMatchObject({ kind: "relayed", l1Tx: "0xsend" });
    expect(await resolveOrigin(ctx([receipt, change]), deps({ evidenceRead: async (chain) => chain !== "ethereum" }))).toMatchObject({ kind: "unknown", l1Tx: "0xsend" });
  });
  it("calls a change with no receipt a direct call by its authority, once receipts are read past it", async () => {
    expect(await resolveOrigin(ctx([change]), deps())).toMatchObject({ kind: "direct", from: "FDFsoboECfazAq1eLvwBLZXhoxjPvTy4wCzPdbqnk7Zk" });
    expect(await resolveOrigin(ctx([change]), deps({ evidenceRead: async () => false }))).toMatchObject({ kind: "unknown" });
  });
});
