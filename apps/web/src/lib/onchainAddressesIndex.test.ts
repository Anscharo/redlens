import { describe, it, expect } from "vitest";
import {
  classifyAddress,
  buildOnchainAddressRows,
  onchainAddressRowsToCSV,
  onchainCsvRowCount,
  docsSummary,
  addrSearchFields,
  isContractKey,
  balanceExact,
  otherBalances,
  ADDRESS_TYPES,
} from "./onchainAddressesIndex";
import type { AtlasNode, AddressInfo } from "@/types";

const node = (over: Partial<AtlasNode> & { id: string; doc_no: string }): AtlasNode => ({
  title: "T",
  type: "Core",
  depth: 3,
  parentId: null,
  content: "",
  order: 0,
  addressRefs: [],
  ...over,
});

const info = (over: Partial<AddressInfo> = {}): AddressInfo => ({
  chain: "ethereum",
  chains: [over.chain ?? "ethereum"],
  explorerUrl: "https://etherscan.io/address/0x",
  label: null,
  isContract: false,
  isProxy: false,
  roles: [],
  aliases: [],
  expectedTokens: [],
  ...over,
});

describe("classifyAddress", () => {
  it("tags multisig by role or Safe proxy", () => {
    expect(classifyAddress(info({ roles: ["multisig"] }))).toBe("Multisig");
    expect(classifyAddress(info({ etherscanName: "SafeProxy", isContract: true }))).toBe("Multisig");
  });
  it("multisig wins over other roles", () => {
    expect(classifyAddress(info({ roles: ["foundation", "multisig"] }))).toBe("Multisig");
  });
  it("tags token by token or underlying-asset role", () => {
    expect(classifyAddress(info({ roles: ["token"], isContract: true }))).toBe("Token");
    expect(classifyAddress(info({ roles: ["underlying-asset"], isContract: true }))).toBe("Token");
  });
  it("tags Sky internal by chainlog id or system role", () => {
    expect(classifyAddress(info({ chainlogId: "MCD_PAUSE_PROXY", isContract: true }))).toBe(
      "Sky Internal Contract",
    );
    expect(classifyAddress(info({ roles: ["buffer"], isContract: true }))).toBe("Sky Internal Contract");
  });
  it("tags a non-contract as EOA", () => {
    expect(classifyAddress(info({ roles: ["delegate"], isContract: false }))).toBe("EOA");
  });
  it("falls back to Other Contract for an unplaced contract", () => {
    expect(classifyAddress(info({ roles: ["delegate"], etherscanName: "VoteDelegate", isContract: true }))).toBe(
      "Other Contract",
    );
  });
  it("hasCode overrides isContract=false to Other Contract for an unverified contract", () => {
    expect(classifyAddress(info({ roles: ["delegate"], isContract: false }), true)).toBe("Other Contract");
  });
  it("hasCode=false confirms EOA even without a checked isContract flag", () => {
    expect(classifyAddress(info({ roles: ["delegate"], isContract: false }), false)).toBe("EOA");
  });
  it("hasCode=null (not yet checked) falls back to isContract", () => {
    expect(classifyAddress(info({ roles: ["delegate"], isContract: false }), null)).toBe("EOA");
  });

  // Solana. Every one of these used to read "EOA", because the pipeline only
  // ever asked the EVM question ("does it have bytecode?") of them.
  const sol = (accountType: string, over: Partial<AddressInfo> = {}) =>
    classifyAddress(info({ chain: "solana", accountType, ...over }));

  it("reads a Solana program as a Program, not an EOA", () => {
    expect(sol("program", { isContract: true })).toBe("Program");
  });

  it("reads program-owned data accounts as Program Accounts", () => {
    expect(sol("program-account")).toBe("Program Account");
    expect(sol("token-account")).toBe("Program Account");
    expect(sol("token-multisig")).toBe("Program Account");
  });

  it("reads a mint as a Token even when the atlas tagged no role", () => {
    expect(sol("mint")).toBe("Token");
  });

  it("keeps EOA for the one Solana account that really is a keypair wallet", () => {
    expect(sol("wallet")).toBe("EOA");
  });

  it("files an account the chain has never seen as EOA", () => {
    expect(sol("missing")).toBe("EOA");
  });

  it("lets an atlas multisig/token tag outrank the account type", () => {
    // The Squads multisigs are PDAs; the atlas's own tag is the better answer.
    expect(sol("program-account", { roles: ["multisig"] })).toBe("Multisig");
    expect(sol("program-account", { roles: ["token"] })).toBe("Token");
  });

  it("falls back to Program Account for an account kind it doesn't know", () => {
    expect(sol("something-new")).toBe("Program Account");
  });
});

describe("buildOnchainAddressRows", () => {
  const docs: Record<string, AtlasNode> = {
    d1: node({ id: "d1", doc_no: "A.2.1", title: "Alpha", addressRefs: ["0xAAA"] }),
    d2: node({ id: "d2", doc_no: "A.1.1", title: "Beta", addressRefs: ["0xaaa", "0xBBB"] }),
  };
  const addrMap: Record<string, AddressInfo> = {
    "0xaaa": info({ chain: "ethereum", roles: ["token"], entityLabel: "USDS", isContract: true, chainlogId: "USDS" }),
    "0xbbb": info({ chain: "base", roles: ["multisig"], entityLabel: "Base Safe", isContract: true }),
  };

  it("collects mentioning docs (case-insensitive), sorted by doc_no", () => {
    const rows = buildOnchainAddressRows(docs, addrMap);
    const a = rows.find((r) => r.address === "0xaaa")!;
    // Both d1 (A.2.1) and d2 (A.1.1) mention 0xAAA/0xaaa; sorted numerically.
    expect(a.docs.map((d) => d.docNo)).toEqual(["A.1.1", "A.2.1"]);
    expect(a.owner).toBe("USDS");
    expect(a.chainlogId).toBe("USDS");
    expect(a.type).toBe("Multisig" === a.type ? a.type : "Token"); // token role → Token
    expect(a.type).toBe("Token");
  });

  it("keys rows by address|chain and sorts by chain then type", () => {
    const rows = buildOnchainAddressRows(docs, addrMap);
    expect(rows.map((r) => r.rowKey)).toContain("0xbbb|base");
    // base sorts before ethereum
    expect(rows[0].chain).toBe("base");
  });

  it("dedupes a doc that refs the same address twice", () => {
    const dd = { x: node({ id: "x", doc_no: "A.9", title: "Dup", addressRefs: ["0xCCC", "0xccc"] }) };
    const rows = buildOnchainAddressRows(dd, { "0xccc": info() });
    expect(rows[0].docs).toHaveLength(1);
  });
});

describe("chainlog-name mentions", () => {
  it("isContractKey accepts SCREAMING_SNAKE keys, rejects bare symbols", () => {
    expect(isContractKey("MCD_PAUSE_PROXY")).toBe(true);
    expect(isContractKey("USDS")).toBe(false);
  });

  it("adds docs that name the chainlog key without the address, tagged via name", () => {
    const docs: Record<string, AtlasNode> = {
      // Direct-address mention.
      d1: node({ id: "d1", doc_no: "A.1", title: "Def", addressRefs: ["0xAAA"] }),
      // Names MCD_PAUSE_PROXY in prose, no address.
      d2: node({ id: "d2", doc_no: "A.2", title: "Uses key", content: "delegated to MCD_PAUSE_PROXY here" }),
      // Both the address and the key.
      d3: node({ id: "d3", doc_no: "A.3", title: "Both", addressRefs: ["0xAAA"], content: "the MCD_PAUSE_PROXY at" }),
    };
    const addrMap = { "0xaaa": info({ chainlogId: "MCD_PAUSE_PROXY", isContract: true }) };
    const row = buildOnchainAddressRows(docs, addrMap)[0];
    const byId = Object.fromEntries(row.docs.map((d) => [d.id, d.via]));
    expect(byId).toEqual({ d1: "address", d2: "name", d3: "both" });
    // Whole-word only: a longer key isn't matched by a shorter one's scan.
    expect(row.docs).toHaveLength(3);
  });

  it("does not scan bare token symbols (no underscore) as chainlog names", () => {
    const docs = {
      d1: node({ id: "d1", doc_no: "A.1", title: "Prose", content: "lots of USDS flowing to USDS holders" }),
    };
    // USDS address itself is mentioned nowhere by address; the prose USDS must
    // NOT pull d1 in as a name mention.
    const row = buildOnchainAddressRows(docs, { "0xusds": info({ chainlogId: "USDS", isContract: true }) })[0];
    expect(row.docs).toHaveLength(0);
  });

  it("CSV carries a Mention Via column", () => {
    const docs = {
      d2: node({ id: "d2", doc_no: "A.2", title: "K", content: "MCD_VAT lives here" }),
    };
    const rows = buildOnchainAddressRows(docs, { "0xv": info({ chainlogId: "MCD_VAT", isContract: true }) });
    const csv = onchainAddressRowsToCSV(rows);
    expect(csv.split("\r\n")[0]).toContain("Mention Via");
    expect(csv).toContain('"chainlog name"');
  });
});

describe("registry name + implementation", () => {
  const docs = { d1: node({ id: "d1", doc_no: "A.1", title: "T", addressRefs: ["0xAAA"] }) };

  it("uses chainlog id as registry name when present", () => {
    const r = buildOnchainAddressRows(docs, {
      "0xaaa": info({ chainlogId: "MCD_VAT", etherscanName: "Vat", isContract: true }),
    })[0];
    expect(r.registryName).toBe("MCD_VAT");
    expect(r.registrySource).toBe("chainlog");
  });

  it("falls back to the on-chain etherscan name when no chainlog id", () => {
    const r = buildOnchainAddressRows(docs, {
      "0xaaa": info({ etherscanName: "VoteDelegate", isContract: true }),
    })[0];
    expect(r.registryName).toBe("VoteDelegate");
    expect(r.registrySource).toBe("onchain");
  });

  it("registryName is null and source null when neither is present", () => {
    const r = buildOnchainAddressRows(docs, { "0xaaa": info() })[0];
    expect(r.registryName).toBeNull();
    expect(r.registrySource).toBeNull();
  });

  it("carries the proxy implementation address", () => {
    const r = buildOnchainAddressRows(docs, {
      "0xaaa": info({ isContract: true, isProxy: true, implementation: "0ximpl" }),
    })[0];
    expect(r.implementation).toBe("0ximpl");
  });

  it("CSV has an Implementation column carrying the impl address", () => {
    const rows = buildOnchainAddressRows(docs, {
      "0xaaa": info({ isContract: true, isProxy: true, implementation: "0xdeadbeef" }),
    });
    const csv = onchainAddressRowsToCSV(rows);
    expect(csv.split("\r\n")[0]).toContain("Implementation");
    expect(csv).toContain("0xdeadbeef");
  });
});

describe("CSV export (long format)", () => {
  const docs: Record<string, AtlasNode> = {
    d1: node({ id: "d1", doc_no: "A.2.1", title: "Al, pha", addressRefs: ["0xAAA"] }),
    d2: node({ id: "d2", doc_no: "A.1.1", title: "Beta", addressRefs: ["0xAAA"] }),
  };
  const addrMap: Record<string, AddressInfo> = {
    "0xaaa": info({ roles: ["delegate"], entityLabel: "Del", isContract: true, etherscanName: "VoteDelegate" }),
  };

  it("emits one row per address × doc, each with its own UUID + link", () => {
    const rows = buildOnchainAddressRows(docs, addrMap);
    expect(onchainCsvRowCount(rows)).toBe(2);
    const csv = onchainAddressRowsToCSV(rows);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 doc rows
    // Each data row carries exactly one doc UUID.
    expect(lines[1]).toContain("d2"); // A.1.1 sorts first
    expect(lines[2]).toContain("d1");
    // RFC-4180 escaping of the comma in the title.
    expect(csv).toContain('"Al, pha"');
  });

  it("carries the Solana account type and owning program", () => {
    const rows = buildOnchainAddressRows(
      {},
      {
        SoLPDA: info({
          chain: "solana",
          accountType: "token-account",
          programOwner: "Tokenkeg",
          programOwnerName: "SPL Token",
        }),
      },
    );
    expect(rows[0]).toMatchObject({ type: "Program Account", accountType: "token-account" });
    const csv = onchainAddressRowsToCSV(rows);
    expect(csv).toContain("Account Type");
    expect(csv).toContain("token-account");
    expect(csv).toContain("SPL Token (Tokenkeg)");
  });

  it("emits one row with empty doc columns for a zero-mention address", () => {
    const rows = buildOnchainAddressRows({}, { "0xzzz": info() });
    expect(onchainCsvRowCount(rows)).toBe(1);
    expect(onchainAddressRowsToCSV(rows).split("\r\n")).toHaveLength(2);
  });
});

describe("balances", () => {
  const docs = { d1: node({ id: "d1", doc_no: "A.1", title: "T", addressRefs: ["0xAAA"] }) };
  const addrMap = { "0xaaa": info({ chain: "ethereum", entityLabel: "X" }) };
  const balances = {
    "0xaaa|ethereum": {
      chain: "ethereum",
      checkedAt: "2026-08-05T09:00:00.000Z",
      hasCode: null,
      balances: {
        ETH: { raw: "1000000000000000000", decimals: 18 },
        USDS: { raw: "2500000000000000000000", decimals: 18 },
        USDC: { raw: "5000000", decimals: 6 },
      },
    },
  };

  it("attaches balances + checkedAt to the row", () => {
    const r = buildOnchainAddressRows(docs, addrMap, balances)[0];
    expect(r.balancesCheckedAt).toBe("2026-08-05T09:00:00.000Z");
    expect(balanceExact(r, "ETH")).toBe("1");
    expect(balanceExact(r, "USDS")).toBe("2500");
    expect(balanceExact(r, "SKY")).toBe(""); // not held
  });

  it("otherBalances excludes ETH/USDS/SKY, keeps USDC", () => {
    const r = buildOnchainAddressRows(docs, addrMap, balances)[0];
    expect(otherBalances(r)).toEqual([{ symbol: "USDC", amount: "5" }]);
  });

  it("defaults to empty balances when none provided", () => {
    const r = buildOnchainAddressRows(docs, addrMap)[0];
    expect(r.balances).toEqual({});
    expect(r.balancesCheckedAt).toBeNull();
  });

  it("CSV includes the balance columns and values", () => {
    const csv = onchainAddressRowsToCSV(buildOnchainAddressRows(docs, addrMap, balances));
    const header = csv.split("\r\n")[0];
    expect(header).toContain("ETH Balance");
    expect(header).toContain("Other Token Balances");
    expect(header).toContain("Balances Updated");
    expect(csv).toContain('"USDC=5"');
    expect(csv).toContain('"2026-08-05"');
  });

  it("sums balances across every chain a multi-chain address is on", () => {
    const multiAddrMap = {
      "0xaaa": info({ chain: "ethereum", chains: ["ethereum", "base"], entityLabel: "X" }),
    };
    const multiChainBalances = {
      "0xaaa|ethereum": {
        chain: "ethereum",
        checkedAt: "2026-08-05T09:00:00.000Z",
        hasCode: true,
        balances: { ETH: { raw: "1000000000000000000", decimals: 18 } },
      },
      "0xaaa|base": {
        chain: "base",
        checkedAt: "2026-08-06T09:00:00.000Z",
        hasCode: null,
        balances: { ETH: { raw: "2000000000000000000", decimals: 18 }, USDC: { raw: "3000000", decimals: 6 } },
      },
    };
    const r = buildOnchainAddressRows(docs, multiAddrMap, multiChainBalances)[0];
    // ETH sums across both chains; USDC (base-only) is kept as-is.
    expect(balanceExact(r, "ETH")).toBe("3");
    expect(otherBalances(r)).toEqual([{ symbol: "USDC", amount: "3" }]);
    // hasCode/checkedAt come from the primary chain (ethereum) specifically,
    // not the base row — they're per-chain facts, unlike the summed balance.
    expect(r.balancesCheckedAt).toBe("2026-08-05T09:00:00.000Z");
    expect(r.type).not.toBe("EOA"); // hasCode: true on the primary chain
  });
});

describe("helpers", () => {
  it("docsSummary joins docNo : title with a pipe", () => {
    const rows = buildOnchainAddressRows(
      { d1: node({ id: "d1", doc_no: "A.1", title: "One", addressRefs: ["0xAAA"] }) },
      { "0xaaa": info() },
    );
    expect(docsSummary(rows[0])).toBe("A.1 : One");
  });
  it("search fields expose address, owner, chain, type, doc nos", () => {
    const r = buildOnchainAddressRows(
      { d1: node({ id: "d1", doc_no: "A.1", title: "One", addressRefs: ["0xAAA"] }) },
      { "0xaaa": info({ entityLabel: "Owner X", roles: ["token"] }) },
    )[0];
    const labels = addrSearchFields(r).map((f) => f.label);
    expect(labels).toEqual(
      expect.arrayContaining(["address", "owner", "chain", "type", "doc nos"]),
    );
  });
  // The pill row and the table's secondary sort both read this list, and
  // TYPE_STYLE (OnchainAddressCells) must have an entry for every member.
  it("ADDRESS_TYPES lists every bucket, in pill order", () => {
    expect(ADDRESS_TYPES).toEqual([
      "EOA",
      "Multisig",
      "Token",
      "Sky Internal Contract",
      "Other Contract",
      "Program",
      "Program Account",
    ]);
  });
});
