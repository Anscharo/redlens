// A parameter's subject is named by its own symbol() and decimals(), and an
// exchange-rate vault also by its asset(); a subject that answers neither (an
// OTC desk) or is not an address (a CCTP domain) gets nothing.
import { describe, expect, it } from "bun:test";
import type { PauParam, PauSnapshot } from "../../lib/pau.ts";
import type { ChainCall } from "./snapshot.ts";
import { withParamSubjects } from "./param-subjects.ts";

const [ATOKEN, VAULT, USDC, OTC] = ["1", "2", "3", "4"].map((c) => "0x" + c.repeat(40));
const DECIMALS: Record<string, number> = { [ATOKEN]: 6, [VAULT]: 18, [USDC]: 6 };
const SYMBOL: Record<string, string> = { [ATOKEN]: "spUSDC", [VAULT]: "sUSDC", [USDC]: "USDC" };

const seen: ChainCall[] = [];
const read = async (_chain: string, calls: ChainCall[]) => {
  seen.push(...calls);
  return calls.map((c) => {
    if (c.functionName === "asset") return c.address === VAULT ? USDC.toUpperCase().replace("0X", "0x") : null;
    if (c.functionName === "decimals") return DECIMALS[c.address] ?? null;
    return SYMBOL[c.address] ?? null;
  });
};

const at = { block: 1, time: "t", tx: "0xt" };
const param = (event: string, subject: string): PauParam => ({ event, subject, args: {}, setAt: at });
const snap = (params: PauParam[]): PauSnapshot => ({
  deployment: "p:ethereum:monolithic", prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic",
  contracts: [{ role: "controller", address: "0xc", events: 0, historyComplete: true, params }],
});

describe("withParamSubjects", () => {
  it("names each address subject, and an exchange-rate vault's asset", async () => {
    const out = await withParamSubjects(snap([param("MaxSlippageSet", ATOKEN), param("MaxExchangeRateSet", VAULT), param("MaxSlippageSet", OTC), param("MintRecipientSet", "3")]), read);
    const [aave, vault, otc, cctp] = out.contracts[0].params!;
    expect(aave.subjectToken).toEqual({ decimals: 6, symbol: "spUSDC", token: ATOKEN, source: "token" });
    expect(aave.asset).toBeUndefined();
    expect(vault.subjectToken?.symbol).toBe("sUSDC");
    expect(vault.asset).toEqual({ decimals: 6, symbol: "USDC", token: USDC, source: "token" });
    expect(otc.subjectToken).toBeUndefined();
    expect(cctp.subjectToken).toBeUndefined();
  });

  it("reads nothing when no parameter is keyed by an address", async () => {
    seen.length = 0;
    const s = snap([param("MintRecipientSet", "3")]);
    expect(await withParamSubjects(s, read)).toBe(s);
    expect(seen).toHaveLength(0);
  });
});
