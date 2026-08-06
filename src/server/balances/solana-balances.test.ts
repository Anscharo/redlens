import { describe, it, expect, mock } from "bun:test";
import {
  parseTokenAccount,
  planTokenAccounts,
  assembleSolanaBalances,
  fetchSolanaBalances,
} from "./solana-balances.ts";
import { decodeBase58, encodeBase58, associatedTokenAddress } from "../../../scripts/lib/solana-pda.mjs";
import { SPL_TOKEN_PROGRAM } from "../../lib/tokens.ts";

const USDS = "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OWNER = "99J5Vcf3tav2dorWmB1qxdXtD4MKk6pyayQwS8RCXZKc";
const OTHER = "8JmDPG5BFQ6gpUPJV9xBixYJLqTKCSNotkXksTmNsQfj";

// A 72-byte SPL token account prefix: mint ‖ owner ‖ amount (u64 LE).
function tokenAccount(mint: string, owner: string, amount: bigint) {
  const b = Buffer.alloc(72);
  Buffer.from(decodeBase58(mint)).copy(b, 0);
  Buffer.from(decodeBase58(owner)).copy(b, 32);
  b.writeBigUInt64LE(amount, 64);
  return { data: [b.toString("base64"), "base64"] };
}

describe("parseTokenAccount", () => {
  it("reads mint, owner and amount out of the layout", () => {
    expect(parseTokenAccount(tokenAccount(USDS, OWNER, 1064340n))).toEqual({
      mint: USDS,
      owner: OWNER,
      amount: "1064340",
    });
  });

  it("returns null for anything too short to be a token account", () => {
    expect(parseTokenAccount({ data: [Buffer.alloc(40).toString("base64"), "base64"] })).toBeNull();
    expect(parseTokenAccount({ data: ["", "base64"] })).toBeNull();
    expect(parseTokenAccount(null)).toBeNull();
    expect(parseTokenAccount({})).toBeNull();
  });

  it("reads a u64 amount past Number.MAX_SAFE_INTEGER exactly", () => {
    const big = 18_446_744_073_709_551_615n; // u64 max
    expect(parseTokenAccount(tokenAccount(USDS, OWNER, big))?.amount).toBe(big.toString());
  });
});

describe("planTokenAccounts", () => {
  it("derives one account per address × known mint", () => {
    const plan = planTokenAccounts([OWNER]);
    expect(plan).toHaveLength(3); // USDS, USDT, USDC
    const usds = plan.find((p) => p.mint === USDS)!;
    expect(usds.owner).toBe(OWNER);
    expect(usds.address).toBe(associatedTokenAddress(OWNER, USDS, SPL_TOKEN_PROGRAM));
  });

  it("skips an address that isn't a decodable pubkey instead of throwing", () => {
    // One malformed atlas entry must not lose the whole sweep.
    expect(planTokenAccounts(["not-base58-0OIl", OWNER])).toHaveLength(3);
  });
});

describe("assembleSolanaBalances", () => {
  it("reports SOL from lamports", () => {
    const out = assembleSolanaBalances(new Map([[OWNER, { lamports: 3467354318 }]]), [], new Map());
    expect(out.get(OWNER)).toEqual({ SOL: { raw: "3467354318", decimals: 9 } });
  });

  it("credits a derived token account to the address that owns it", () => {
    const derived = planTokenAccounts([OWNER]).filter((d) => d.mint === USDS);
    const accounts = new Map([[derived[0].address, tokenAccount(USDS, OWNER, 1064340n)]]);
    const out = assembleSolanaBalances(new Map(), derived, accounts);
    expect(out.get(OWNER)).toEqual({ USDS: { raw: "1064340", decimals: 6 } });
  });

  it("refuses a derived account whose own data names a different owner or mint", () => {
    // The derivation is deterministic, so a mismatch means the assumption is
    // wrong — and crediting the balance to the wrong address would be invisible
    // in the report.
    const derived = planTokenAccounts([OWNER]).filter((d) => d.mint === USDS);
    const wrongOwner = new Map([[derived[0].address, tokenAccount(USDS, OTHER, 999n)]]);
    expect(assembleSolanaBalances(new Map(), derived, wrongOwner).size).toBe(0);
    const wrongMint = new Map([[derived[0].address, tokenAccount(USDC, OWNER, 999n)]]);
    expect(assembleSolanaBalances(new Map(), derived, wrongMint).size).toBe(0);
  });

  it("skips a token account that was never created", () => {
    const derived = planTokenAccounts([OWNER]);
    expect(assembleSolanaBalances(new Map(), derived, new Map()).size).toBe(0);
  });

  it("reports the token an address holds when the address IS a token account", () => {
    // The ALM Controller's USDC account: its balance is on the account itself,
    // not on an account derived from it.
    const self = "4UA2CC9fQDTbX1SnJcanYn2QU5PtyB1MGfezDvGFPVwd";
    const acc = { ...tokenAccount(USDC, OTHER, 1000239n), lamports: 2039280 };
    const out = assembleSolanaBalances(new Map([[self, acc]]), [], new Map());
    expect(out.get(self)).toEqual({
      SOL: { raw: "2039280", decimals: 9 },
      USDC: { raw: "1000239", decimals: 6 },
    });
  });

  it("does not double-count when a token account names itself as owner", () => {
    // Guards the self-account path against crediting a balance twice on the
    // same row via two different routes.
    const self = "4UA2CC9fQDTbX1SnJcanYn2QU5PtyB1MGfezDvGFPVwd";
    const out = assembleSolanaBalances(new Map([[self, tokenAccount(USDC, self, 500n)]]), [], new Map());
    expect(out.get(self)?.USDC).toBeUndefined();
  });

  it("ignores an account the chain has never seen", () => {
    expect(assembleSolanaBalances(new Map([[OWNER, null]]), [], new Map()).size).toBe(0);
  });
});

describe("fetchSolanaBalances", () => {
  const input = (address: string, chain: string) => ({ address, chain, expectedTokens: [] });

  it("ignores non-Solana inputs and does no work when there are none", async () => {
    const fetchAccounts = mock(async () => ({ accounts: new Map(), failed: 0 }));
    expect(await fetchSolanaBalances([input("0xabc", "ethereum")], { fetchAccounts })).toEqual([]);
    expect(fetchAccounts).not.toHaveBeenCalled();
  });

  it("returns one row per address that had a balance", async () => {
    const usdsAta = associatedTokenAddress(OWNER, USDS, SPL_TOKEN_PROGRAM);
    const fetchAccounts = mock(async (keys: string[]) => ({
      accounts: new Map(
        keys.map((k) => [
          k,
          k === OWNER ? { lamports: 100 } : k === usdsAta ? tokenAccount(USDS, OWNER, 42n) : null,
        ]),
      ),
      failed: 0,
    }));
    const rows = await fetchSolanaBalances([input(OWNER, "solana"), input("0xabc", "ethereum")], { fetchAccounts });
    expect(rows).toEqual([
      { address: OWNER, chain: "solana", balances: { SOL: { raw: "100", decimals: 9 }, USDS: { raw: "42", decimals: 6 } } },
    ]);
  });

  it("reports failed batches rather than passing an empty sweep off as a real one", async () => {
    const lines: string[] = [];
    const fetchAccounts = mock(async () => ({ accounts: new Map(), failed: 2, error: "HTTP 403" }));
    const rows = await fetchSolanaBalances([input(OWNER, "solana")], { fetchAccounts, log: (m: string) => lines.push(m) });
    expect(rows).toEqual([]);
    expect(lines.join(" ")).toContain("failed batch");
    expect(lines.join(" ")).toContain("HTTP 403");
  });

  it("drops an address that isn't a valid pubkey", async () => {
    const fetchAccounts = mock(async () => ({ accounts: new Map(), failed: 0 }));
    await fetchSolanaBalances([input("not-base58-0OIl", "solana")], { fetchAccounts });
    expect(fetchAccounts).not.toHaveBeenCalled();
  });
});

describe("base58 helpers used here", () => {
  it("round-trips the mints this module keys on", () => {
    for (const m of [USDS, USDC]) expect(encodeBase58(decodeBase58(m))).toBe(m);
  });
});
