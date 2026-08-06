import { describe, it, expect, vi } from "vitest";
import { encodeBase58 } from "./solana-pda.mjs";
import {
  programDataAddress,
  classifySolanaAccount,
  fetchSolanaAccounts,
  applySolanaAccounts,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  BPF_UPGRADEABLE_LOADER,
} from "./solana-accounts.mjs";

// Real mainnet addresses: the first is a keypair (on-curve), the second is the
// atlas's "Pioneer Incentive Pool wallet", which is System-owned yet off-curve.
const KEYPAIR = "99J5Vcf3tav2dorWmB1qxdXtD4MKk6pyayQwS8RCXZKc";
const OFF_CURVE = "8JmDPG5BFQ6gpUPJV9xBixYJLqTKCSNotkXksTmNsQfj";

const hex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

// An account as getMultipleAccounts returns it, with base64 + encoding tuple data.
function account(over: Record<string, unknown> = {}) {
  return { owner: SYSTEM_PROGRAM, executable: false, space: 0, data: ["", "base64"], ...over };
}

// A 36-byte UpgradeableLoaderState::Program: 4-byte LE discriminant 2, then the
// programdata pubkey.
function programAccountData(programDataBytes: Uint8Array) {
  const b = new Uint8Array(36);
  b[0] = 2;
  b.set(programDataBytes, 4);
  return b64(b);
}

describe("programDataAddress", () => {
  it("reads the programdata pubkey out of an upgradeable program account", () => {
    const pubkey = new Uint8Array(32).fill(7);
    const acc = account({ data: [programAccountData(pubkey), "base64"] });
    expect(programDataAddress(acc)).toBe(encodeBase58(pubkey));
  });

  it("returns null when the discriminant is not Program(2)", () => {
    const b = new Uint8Array(36);
    b[0] = 3; // ProgramData, not Program
    expect(programDataAddress(account({ data: [b64(b), "base64"] }))).toBeNull();
  });

  it("returns null on short or absent data", () => {
    expect(programDataAddress(account({ data: [b64(new Uint8Array(8)), "base64"] }))).toBeNull();
    expect(programDataAddress(account({ data: ["", "base64"] }))).toBeNull();
    expect(programDataAddress(account({ data: null }))).toBeNull();
  });
});

describe("classifySolanaAccount", () => {
  it("reads an upgradeable program as a program with its programdata as implementation", () => {
    const pubkey = new Uint8Array(32).fill(3);
    const c = classifySolanaAccount(
      account({ owner: BPF_UPGRADEABLE_LOADER, executable: true, space: 36, data: [programAccountData(pubkey), "base64"] }),
    );
    expect(c.accountType).toBe("program");
    expect(c.isContract).toBe(true);
    // Upgradeable is Solana's proxy: the code behind this address can change.
    expect(c.isProxy).toBe(true);
    expect(c.implementation).toBe(encodeBase58(pubkey));
  });

  it("reads a non-upgradeable program as a program that is not a proxy", () => {
    const c = classifySolanaAccount(
      account({ owner: "BPFLoader2111111111111111111111111111111111", executable: true, space: 1024 }),
    );
    expect(c).toMatchObject({ accountType: "program", isContract: true, isProxy: false });
    expect(c.implementation).toBeUndefined();
  });

  it("does not claim isProxy when the loader says upgradeable but the pointer is unreadable", () => {
    // dataSlice came back empty (or the layout changed) — "upgradeable" with no
    // target is a claim the report would render as a dead link.
    const c = classifySolanaAccount(
      account({ owner: BPF_UPGRADEABLE_LOADER, executable: true, space: 36, data: ["", "base64"] }),
    );
    expect(c).toMatchObject({ accountType: "program", isProxy: false });
  });

  it("reads a System-Program-owned keypair as a wallet", () => {
    // On-curve, so a private key for it exists — a real EOA.
    expect(
      classifySolanaAccount(account({ owner: SYSTEM_PROGRAM, space: 0 }), KEYPAIR),
    ).toMatchObject({ accountType: "wallet", isContract: false });
  });

  it("reads a System-Program-owned off-curve address as a PDA, not a wallet", () => {
    // A Squads vault is System-owned too. Off-curve means no private key can
    // exist, so "EOA" would be flatly wrong — 30 of the atlas's 40 Solana
    // addresses are in this bucket.
    expect(
      classifySolanaAccount(account({ owner: SYSTEM_PROGRAM, space: 0 }), OFF_CURVE),
    ).toMatchObject({ accountType: "pda", isContract: false });
  });

  it("does not downgrade to PDA when the address is absent or unparseable", () => {
    expect(classifySolanaAccount(account({ owner: SYSTEM_PROGRAM })).accountType).toBe("wallet");
    expect(classifySolanaAccount(account({ owner: SYSTEM_PROGRAM }), "not-base58-0OIl").accountType).toBe("wallet");
  });

  it("distinguishes classic SPL Token layouts by size", () => {
    const kind = (space: number, owner = TOKEN_PROGRAM) =>
      classifySolanaAccount(account({ owner, space })).accountType;
    expect(kind(82)).toBe("mint");
    expect(kind(165)).toBe("token-account");
    expect(kind(355)).toBe("token-multisig");
  });

  it("uses the Token-2022 discriminator byte when extensions push past 165", () => {
    const withTag = (tag: number) => {
      const b = new Uint8Array(166);
      b[165] = tag;
      return classifySolanaAccount(
        account({ owner: TOKEN_2022_PROGRAM, space: 400, data: [b64(b), "base64"] }),
      ).accountType;
    };
    expect(withTag(1)).toBe("mint");
    expect(withTag(2)).toBe("token-account");
    expect(withTag(9)).toBe("program-account");
  });

  it("reads any other owner as a program-owned data account", () => {
    // A PDA — the ALM Controller's state, a relayer's permission config.
    expect(
      classifySolanaAccount(account({ owner: "ALM1JSnEhc5PkNecbSZotgprBuJujL5objTbwGtpTgTd", space: 300 })),
    ).toMatchObject({ accountType: "program-account", isContract: false, isProxy: false });
  });

  it("reports an account the chain has never seen as missing, not as a wallet", () => {
    expect(classifySolanaAccount(null)).toMatchObject({
      accountType: "missing",
      programOwner: null,
      isContract: false,
    });
  });

  it("tolerates a node that omits space by classifying on owner alone", () => {
    expect(classifySolanaAccount(account({ owner: TOKEN_PROGRAM, space: undefined })).accountType).toBe(
      "program-account",
    );
  });
});

describe("fetchSolanaAccounts", () => {
  const ok = (value: unknown[]) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ result: { value } }) });

  it("maps each returned account back onto its pubkey, positionally", async () => {
    const fetchImpl = vi.fn(() => ok([account({ space: 82 }), null]));
    const { accounts, failed } = await fetchSolanaAccounts(["A", "B"], {
      rpcUrl: "https://rpc.test",
      fetchImpl: fetchImpl as never,
    });
    expect(failed).toBe(0);
    expect(accounts.get("A")).toMatchObject({ space: 82 });
    // A null entry is a real answer ("no such account"), not a missing one.
    expect(accounts.has("B")).toBe(true);
    expect(accounts.get("B")).toBeNull();
  });

  it("requests a bounded dataSlice so an ELF-sized account can't be pulled down", async () => {
    const fetchImpl = vi.fn(() => ok([null]));
    await fetchSolanaAccounts(["A"], { rpcUrl: "https://rpc.test", fetchImpl: fetchImpl as never });
    const body = JSON.parse((fetchImpl.mock.calls[0] as never[])[1]!["body" as never]);
    expect(body.method).toBe("getMultipleAccounts");
    expect(body.params[1].dataSlice).toEqual({ offset: 0, length: 166 });
  });

  it("defaults to batches of 10, the measured PublicNode cap", async () => {
    // Measured against solana-rpc.publicnode.com: 10 keys answers 200, 11 is
    // refused with an HTTP 403 carrying JSON-RPC -32602 "blocked parameter:
    // params.0.#". Solana's own protocol cap is 100, so nothing but this test
    // records why the batch is small.
    const fetchImpl = vi.fn(() => ok([]));
    await fetchSolanaAccounts(Array.from({ length: 11 }, (_, i) => `K${i}`), {
      rpcUrl: "https://rpc.test",
      fetchImpl: fetchImpl as never,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = JSON.parse((fetchImpl.mock.calls[0] as never[])[1]!["body" as never]);
    expect(first.params[0]).toHaveLength(10);
  });

  it("splits into batches", async () => {
    const fetchImpl = vi.fn(() => ok([null, null]));
    const { accounts } = await fetchSolanaAccounts(["A", "B", "C"], {
      rpcUrl: "https://rpc.test",
      fetchImpl: fetchImpl as never,
      batch: 2,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(accounts.size).toBe(3);
  });

  it("omits a failed batch's pubkeys rather than reporting them as missing accounts", async () => {
    // Conflating "the RPC is down" with "this account does not exist" would
    // silently rewrite every Solana row on a network blip.
    // A gateway 502 answers with an HTML error page, so json() rejects — the
    // status is then the only thing left to report.
    const fetchImpl = vi.fn(() =>
      Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError("Unexpected token <")) }),
    );
    const { accounts, failed, error } = await fetchSolanaAccounts(["A"], {
      rpcUrl: "https://rpc.test",
      fetchImpl: fetchImpl as never,
    });
    expect(accounts.size).toBe(0);
    expect(failed).toBe(1);
    expect(error).toContain("502");
  });

  it("treats a JSON-RPC error body as a failure", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ error: { message: "rate limited" } }) }),
    );
    const { accounts, failed, error } = await fetchSolanaAccounts(["A"], {
      rpcUrl: "https://rpc.test",
      fetchImpl: fetchImpl as never,
    });
    expect(accounts.size).toBe(0);
    expect(failed).toBe(1);
    expect(error).toContain("rate limited");
  });

  it("reports the JSON-RPC reason carried by a 4xx, not just the status", async () => {
    // How PublicNode refuses an oversized batch. Reporting only "HTTP 403"
    // makes it indistinguishable from an egress-policy denial, which is a
    // completely different thing to go fix.
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: { code: -32602, message: "blocked parameter: params.0.#" } }),
      }),
    );
    const { failed, error } = await fetchSolanaAccounts(["A"], {
      rpcUrl: "https://rpc.test",
      fetchImpl: fetchImpl as never,
    });
    expect(failed).toBe(1);
    expect(error).toContain("blocked parameter");
    expect(error).toContain("403");
  });

  it("fails cleanly when the registry has no Solana RPC", async () => {
    // Explicit "" rather than undefined: undefined takes the default parameter,
    // which is the real registry URL — and this test would then hit the network.
    const fetchImpl = vi.fn();
    const { failed, error } = await fetchSolanaAccounts(["A"], { rpcUrl: "", fetchImpl: fetchImpl as never });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(failed).toBe(1);
    expect(error).toMatch(/no Solana RPC/);
  });
});

describe("applySolanaAccounts", () => {
  const PROGRAM = "ALM1JSnEhc5PkNecbSZotgprBuJujL5objTbwGtpTgTd";
  // Real pubkeys throughout: curve membership is part of the classification, so
  // a placeholder like "WALLET" decodes to the wrong length and reads as a PDA.
  const STATE = "EeobZr57FSmNvw8Hs719iULJNqv3XLrTB5uPezvC2ND3";

  function addresses() {
    return {
      "0xabc": { chain: "ethereum", isContract: true, isProxy: false },
      [PROGRAM]: { chain: "solana", isContract: false, isProxy: false },
      [STATE]: { chain: "solana", isContract: false, isProxy: false },
      [KEYPAIR]: { chain: "solana", isContract: false, isProxy: false },
    } as Record<string, Record<string, unknown>>;
  }

  const fetchAccounts = (accounts: Record<string, unknown>, failed = 0) => async () => ({
    accounts: new Map(Object.entries(accounts)),
    failed,
  });

  it("classifies each Solana address and leaves EVM addresses alone", async () => {
    const addrs = addresses();
    const stats = await applySolanaAccounts(addrs, {
      log: () => {},
      fetchAccounts: fetchAccounts({
        [PROGRAM]: account({ owner: BPF_UPGRADEABLE_LOADER, executable: true, space: 36 }),
        [STATE]: account({ owner: PROGRAM, space: 300 }),
        [KEYPAIR]: account({ owner: SYSTEM_PROGRAM, space: 0 }),
      }) as never,
    });

    expect(addrs[PROGRAM]).toMatchObject({ accountType: "program", isContract: true });
    expect(addrs[STATE]).toMatchObject({ accountType: "program-account", isContract: false });
    expect(addrs[KEYPAIR]).toMatchObject({ accountType: "wallet", isContract: false });
    expect(addrs["0xabc"]).toEqual({ chain: "ethereum", isContract: true, isProxy: false });
    expect(stats).toMatchObject({ checked: 3, failed: 0 });
    expect(stats.byType).toEqual({ program: 1, "program-account": 1, wallet: 1 });
  });

  it("names the owning program from the runtime registry, then from the atlas's own labels", async () => {
    const addrs = addresses();
    await applySolanaAccounts(addrs, {
      log: () => {},
      names: { [PROGRAM]: "Solana ALM Controller Program" },
      fetchAccounts: fetchAccounts({
        [STATE]: account({ owner: PROGRAM, space: 300 }),
        [KEYPAIR]: account({ owner: SYSTEM_PROGRAM, space: 0 }),
      }) as never,
    });
    // The atlas documents this program, so its own label beats a raw pubkey.
    expect(addrs[STATE]).toMatchObject({
      programOwner: PROGRAM,
      programOwnerName: "Solana ALM Controller Program",
    });
    expect(addrs[KEYPAIR].programOwnerName).toBe("System Program");
  });

  it("leaves an address the RPC never answered for untouched", async () => {
    const addrs = addresses();
    const stats = await applySolanaAccounts(addrs, {
      log: () => {},
      fetchAccounts: fetchAccounts({ [KEYPAIR]: account() }, 1) as never,
    });
    expect(addrs[STATE].accountType).toBeUndefined();
    expect(stats).toMatchObject({ checked: 1, failed: 1 });
  });

  it("does no work and reports nothing when there are no Solana addresses", async () => {
    const fetchAccounts = vi.fn();
    const stats = await applySolanaAccounts(
      { "0xabc": { chain: "ethereum" } },
      { log: () => {}, fetchAccounts: fetchAccounts as never },
    );
    expect(fetchAccounts).not.toHaveBeenCalled();
    expect(stats).toEqual({ checked: 0, failed: 0, byType: {} });
  });
});
