// The pending clock for a Solana value: a spell sets the limit when its
// change touches the limit's account (the key); after the cast, a LayerZero
// governance message sent in the spell's window that no Solana receipt holds
// is the relay still due, until READ_DAYS after it was sent or the next spell
// executed; a limit set before the history's window is the chain moving
// before an atlas change inside the window, so that change's spell is
// followed, and gets no step against a change older than the window.
import { describe, expect, it } from "vitest";
import { ctx, edit, exec, lzMessage, svmCheck, svmSnap, SVM_ACCOUNT } from "./pauPending.fixture.ts";
import type { PauHistoryEntry } from "./pauHistory.ts";
import { onchainStep, withOnchain } from "./pauPending.ts";
import { keySetBy, messageInFlight } from "./pauPendingEvidence.ts";
import { pendingStepText } from "./pauStepText.ts";

const RL = "EeobZr57FSmNvw8Hs719iULJNqv3XLrTB5uPezvC2ND3";
/** A change the spell made on Solana to `account`, relayed over LayerZero. */
const svmEntry = (spell: string, landed: string, account: string): PauHistoryEntry => ({
  chain: "solana", tx: `sig${landed}`, block: 1, time: `${landed}T00:00:00Z`, primes: ["bc6aed17-2969-4d04-9af6-c7bf3e4497e6"], executive: null,
  origin: { kind: "spell", path: "layerzero", spell, starSpell: null, l1Tx: "0xsend", from: null, to: null, relay: { via: "layerzero", executor: "SKYGRik", actionsSet: 6, messageId: "0xguid" }, evidence: "e" },
  changes: [{ deployments: [], contract: account, role: "integration", event: "IntegrationUpdate", args: {}, subject: null, label: null, before: null }],
});
const svmCtx = (today: string, o = {}) => ctx(today, { snaps: [svmSnap()], ...o });
const step = (today: string, o = {}, c = svmCheck("mismatch")) => onchainStep(c, [edit("2026-10-29", ["2026-11-05"])], svmCtx(today, o));

describe("Solana evidence", () => {
  it("takes a spell's change to the limit's own account as setting it, not one to another account", () => {
    const pau = { entries: [svmEntry("0xspell", "2026-11-08", "Other1111"), svmEntry("0xspell", "2026-11-09", SVM_ACCOUNT)], queued: [] };
    expect(keySetBy(pau, "0xspell", svmCheck("mismatch"))?.tx).toBe("sig2026-11-09");
    expect(keySetBy({ ...pau, entries: pau.entries.slice(0, 1) }, "0xspell", svmCheck("mismatch"))).toBeNull();
    expect(keySetBy(pau, "0xspell", svmCheck("mismatch", { contract: RL.toLowerCase() }))).not.toBeNull();
  });
  it("finds a LayerZero message in flight within the spell's window only", () => {
    const queued = [lzMessage("2026-09-01"), lzMessage("2026-11-08")];
    expect(messageInFlight(queued, "2026-11-07", null)?.time).toBe("2026-11-08T00:00:00Z");
    expect(messageInFlight(queued, "2026-11-07", "2026-11-08")).toBeNull();
  });
});

describe("Solana pending clock", () => {
  const executives = [exec("2026-11-05", true, "2026-11-07")];
  it("gives no step while the Solana history is not read through, and still says who can change the limit", () => {
    const c = svmCheck("mismatch");
    const history = new Map([[c.docId, [edit("2026-10-29", ["2026-11-05"])]]]);
    const unread = { ...svmSnap(), contracts: svmSnap().contracts.map((x, i) => (i === 0 ? { ...x, historyComplete: false } : x)) };
    const [read] = withOnchain([c], history, svmCtx("2026-11-20", { executives }));
    const [held] = withOnchain([c], history, ctx("2026-11-20", { executives, snaps: [unread] }));
    expect(read.onchain?.kind).toBe("executed");
    expect(held.onchain).toBeUndefined();
    expect(held.routes?.relay?.via).toBe("layerzero");
  });
  it("waits on a LayerZero message the spell's window holds, until READ_DAYS after it was sent", () => {
    const pau = { entries: [], queued: [lzMessage("2026-11-08")] };
    const s = step("2026-11-10", { executives, pau });
    expect(s).toMatchObject({ kind: "pending", pending: { expectedBy: "2026-11-11", step: { kind: "queued", chain: "ethereum", tx: "0xsend", via: "layerzero" } } });
    expect(s?.kind === "pending" && pendingStepText(s.pending.step)).toContain("LayerZero governance message sent since has not been received on Solana yet");
    expect(step("2026-11-12", { executives, pau })?.kind).toBe("executed");
  });
  it("never takes an Executor's action set for a Solana relay", () => {
    const pau = { entries: [], queued: [{ ...lzMessage("2026-11-08"), kind: "action-set" as const, chain: "solana", contract: "x" }] };
    expect(step("2026-11-12", { executives, pau })?.kind).toBe("executed");
  });
  it("says the spell set the limit when its relayed change touched the account", () => {
    const pau = { entries: [svmEntry("0xspell", "2026-11-08", SVM_ACCOUNT)], queued: [] };
    expect(step("2026-11-20", { executives, pau })).toMatchObject({ kind: "set", chain: "solana", tx: "sig2026-11-08" });
  });
  it("follows the atlas's spell for a limit set before the history's window", () => {
    const before = svmCheck("mismatch", { limit: { ...svmCheck("mismatch").limit!, setAt: { block: 0, time: "", tx: "", before: "2026-01-03T00:00:00Z" } } });
    expect(step("2026-11-20", { executives }, before)?.kind).toBe("executed");
    const older = { ...before, limit: { ...before.limit!, setAt: { ...before.limit!.setAt, before: "2026-11-01T00:00:00Z" } } };
    expect(step("2026-11-20", { executives }, older)).toBeNull();
  });
});
