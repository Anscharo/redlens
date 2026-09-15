import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs import from TypeScript test
import { extractRoles, extractEntityLabel, extractExpectedTokens, isPlausibleName } from "../scripts/lib/address-annotate.mjs";

// Helpers: build a content string with the address at a known index.
const ADDR = "0x1234567890123456789012345678901234567890";

function ctx(before: string, after = ""): [string, number, number] {
  const content = before + ADDR + after;
  return [content, before.length, ADDR.length];
}

// --------------------------------------------------------------------------
// extractRoles
// --------------------------------------------------------------------------

describe("extractRoles — wallet type", () => {
  it("multisig", () => {
    const [c, i, l] = ctx("The multisig address is ");
    expect(extractRoles(c, i, l, null)).toContain("multisig");
  });

  it("multi-sig variant", () => {
    const [c, i, l] = ctx("This multi-sig controls ");
    expect(extractRoles(c, i, l, null)).toContain("multisig");
  });

  it("subproxy", () => {
    const [c, i, l] = ctx("The subproxy address is ");
    expect(extractRoles(c, i, l, null)).toContain("subproxy");
  });

  it("hot-wallet", () => {
    const [c, i, l] = ctx("The hot wallet at ");
    expect(extractRoles(c, i, l, null)).toContain("hot-wallet");
  });
});

describe("extractRoles — contract type", () => {
  it("proxy (not sub-proxy)", () => {
    const [c, i, l] = ctx("This is a proxy contract at ");
    const roles = extractRoles(c, i, l, null);
    expect(roles).toContain("proxy");
    expect(roles).not.toContain("subproxy");
  });

  it("subproxy does not also tag proxy", () => {
    const [c, i, l] = ctx("The subproxy at ");
    const roles = extractRoles(c, i, l, null);
    expect(roles).toContain("subproxy");
    expect(roles).not.toContain("proxy");
  });

  it("oracle", () => {
    const [c, i, l] = ctx("The oracle contract is at ");
    expect(extractRoles(c, i, l, null)).toContain("oracle");
  });

  it("price feed", () => {
    const [c, i, l] = ctx("The price feed at ");
    expect(extractRoles(c, i, l, null)).toContain("oracle");
  });

  it("registry", () => {
    const [c, i, l] = ctx("The registry address is ");
    expect(extractRoles(c, i, l, null)).toContain("registry");
  });
});

describe("extractRoles — purpose", () => {
  it("treasury", () => {
    const [c, i, l] = ctx("The treasury address is ");
    expect(extractRoles(c, i, l, null)).toContain("treasury");
  });

  it("buffer", () => {
    const [c, i, l] = ctx("Buffer contract at ");
    expect(extractRoles(c, i, l, null)).toContain("buffer");
  });

  it("reserve", () => {
    const [c, i, l] = ctx("The reserves contract is ");
    expect(extractRoles(c, i, l, null)).toContain("reserve");
  });

  it("vesting", () => {
    const [c, i, l] = ctx("Vesting contract address ");
    expect(extractRoles(c, i, l, null)).toContain("vesting");
  });

  it("vault", () => {
    const [c, i, l] = ctx("The vault address is ");
    expect(extractRoles(c, i, l, null)).toContain("vault");
  });

  it("foundation", () => {
    const [c, i, l] = ctx("Foundation address: ");
    expect(extractRoles(c, i, l, null)).toContain("foundation");
  });

  it("staking rewards", () => {
    const [c, i, l] = ctx("The staking rewards contract is at ");
    expect(extractRoles(c, i, l, null)).toContain("staking-rewards");
  });

  it("incentive pool", () => {
    const [c, i, l] = ctx("The incentive pool is at ");
    expect(extractRoles(c, i, l, null)).toContain("incentive-pool");
  });
});

describe("extractRoles — governance", () => {
  it("delegate", () => {
    const [c, i, l] = ctx("Delegate address ");
    expect(extractRoles(c, i, l, null)).toContain("delegate");
  });

  it("executor", () => {
    const [c, i, l] = ctx("The executor contract is at ");
    expect(extractRoles(c, i, l, null)).toContain("executor");
  });

  it("controller", () => {
    const [c, i, l] = ctx("The controller contract at ");
    expect(extractRoles(c, i, l, null)).toContain("controller");
  });

  it("signer", () => {
    const [c, i, l] = ctx("One signer is ");
    expect(extractRoles(c, i, l, null)).toContain("signer");
  });
});

describe("extractRoles — no false positives", () => {
  it("unrelated content returns empty", () => {
    const [c, i, l] = ctx("The address of the instance is ");
    expect(extractRoles(c, i, l, null)).toEqual([]);
  });

  it("multiple tags accumulate", () => {
    const [c, i, l] = ctx("The treasury multisig address is ");
    const roles = extractRoles(c, i, l, null);
    expect(roles).toContain("treasury");
    expect(roles).toContain("multisig");
  });

  it("table header words visible even when outside window", () => {
    const [c, i, l] = ctx("The address is ");
    const table = {
      headers: ["Name", "Multisig", "Chain"],
      cells: [ADDR, "yes", "ethereum"],
      columnIndex: 0,
    };
    expect(extractRoles(c, i, l, table)).toContain("multisig");
  });
});

// --------------------------------------------------------------------------
// extractEntityLabel
// --------------------------------------------------------------------------

describe("extractEntityLabel — prose patterns", () => {
  it('"address of X is"', () => {
    const [c, i] = ctx("The address of Spark Operations Multisig is ");
    expect(extractEntityLabel(c, i, null)).toBe("Spark Operations Multisig");
  });

  it('"X address is" — leading "The" is captured as-is (case-sensitive optional strip)', () => {
    const [c, i] = ctx("The Aligned Delegates Buffer Multisig address is ");
    expect(extractEntityLabel(c, i, null)).toBe("The Aligned Delegates Buffer Multisig");
  });

  it('"X\'s address is"', () => {
    const [c, i] = ctx("Sky Frontier Foundation's address is ");
    expect(extractEntityLabel(c, i, null)).toBe("Sky Frontier Foundation");
  });

  it('"reward address for X is"', () => {
    const [c, i] = ctx("The reward address for the Aave Integration Boost is ");
    expect(extractEntityLabel(c, i, null)).toBe("Aave Integration Boost");
  });

  it('"X at address"', () => {
    const [c, i] = ctx("Spark Subproxy at address ");
    expect(extractEntityLabel(c, i, null)).toBe("Spark Subproxy");
  });

  it('"Multisig: X"', () => {
    const [c, i] = ctx("Multisig: Core Council ");
    expect(extractEntityLabel(c, i, null)).toBe("Core Council");
  });

  it('"**X**:" bold label — colon must follow closing **', () => {
    const [c, i] = ctx("**Grove Foundation**: ");
    expect(extractEntityLabel(c, i, null)).toBe("Grove Foundation");
  });

  it("rejects generic stop words", () => {
    const [c, i] = ctx("The address of The is ");
    expect(extractEntityLabel(c, i, null)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    const [c, i] = ctx("Some value at index 5 is ");
    expect(extractEntityLabel(c, i, null)).toBeNull();
  });
});

describe("extractEntityLabel — table fallback", () => {
  it("prefers cell under a label-ish header", () => {
    const [c, i] = ctx("is ");
    const table = {
      headers: ["Entity", "Address", "Chain"],
      cells: ["Spark Ops Multisig", ADDR, "ethereum"],
      columnIndex: 1,
    };
    expect(extractEntityLabel(c, i, table)).toBe("Spark Ops Multisig");
  });

  it("falls back to first non-address sibling cell", () => {
    const [c, i] = ctx("is ");
    const table = {
      headers: ["Amount", "Address", "Role"],
      cells: ["100", ADDR, "Buffer"],
      columnIndex: 1,
    };
    expect(extractEntityLabel(c, i, table)).toBe("Buffer");
  });

  it("takes a delegate name from a 'Delegate Name' column (real A.1 table shape)", () => {
    const [c, i] = ctx("is ");
    const table = {
      headers: ["Delegate Name", "EA Address", "Forum Post"],
      cells: ["Bonapublica", ADDR, "https://forum.skyeco.com/t/…"],
      columnIndex: 1,
    };
    expect(extractEntityLabel(c, i, table)).toBe("Bonapublica");
  });

  it("skips cell that looks like an address", () => {
    const other = "0xabcdef1234567890abcdef1234567890abcdef12";
    const [c, i] = ctx("is ");
    const table = {
      headers: ["Address", "Address2"],
      cells: [ADDR, other],
      columnIndex: 0,
    };
    // other is also an address, so no valid sibling label
    expect(extractEntityLabel(c, i, table)).toBeNull();
  });
});

// --------------------------------------------------------------------------
// extractEntityLabel — the sentence-fragment defect
// --------------------------------------------------------------------------

// Real A.2 / A.6 prose with a dummy address appended, so these assert the
// EXTRACTOR, not an atlas SHA. Every one of them shipped the quoted clause as
// an entityLabel before the capture class dropped "." and the possessive
// stopped treating a bare "s" as one.
// See docs/plans/entitylabel-fragment-defect.md.
describe("extractEntityLabel — sentence fragments are never labels", () => {
  const FRAGMENT_PROSE: [string, string][] = [
    [
      "…into WETH. It",
      "The Wrap Proxy ETH Facet (`WrapProxyETHFacet`) wraps the ALM Proxy’s entire native ETH balance into WETH. Its address on Ethereum Mainnet is ",
    ],
    [
      "…Basin shares. It",
      "The Basin Facet (`BasinFacet`) deposits assets into and withdraws them from a Basin in exchange for Basin shares. Its address on Ethereum Mainnet is ",
    ],
    [
      "…no-fee path. It",
      "The PSM Facet (`PSMFacet`) swaps between USDS and USDC by routing through DAI and the Lite PSM’s no-fee path. Its address on Ethereum Mainnet is ",
    ],
  ];

  for (const [was, prose] of FRAGMENT_PROSE) {
    it(`returns null instead of "${was}"`, () => {
      const [c, i] = ctx(prose);
      expect(extractEntityLabel(c, i, null)).toBeNull();
    });
  }

  it("keeps the real name when the sentence before it also ends in a period", () => {
    // Same shape as the fragments above, but this one has a name of its own:
    // the clause "Sky Governance through the Pause Proxy. The Beacon" must not
    // beat it.
    const [c, i] = ctx(
      "It is controlled by Sky Governance through the Pause Proxy. The Beacon’s address on Ethereum Mainnet is ",
    );
    expect(extractEntityLabel(c, i, null)).toBe("The Beacon");
  });

  it('"Its address on … is" yields null, not "Its"', () => {
    // The tightened possessive ((?:['’]s)? rather than ['’]?s?) stops "It" + "s"
    // parsing as a possessive; EXACT_PRONOUN then rejects the bare "Its".
    const [c, i] = ctx("Its address on Ethereum is ");
    expect(extractEntityLabel(c, i, null)).toBeNull();
  });

  it("refuses a Purpose/Description cell that is a sentence", () => {
    const [c, i] = ctx("is ");
    const table = {
      headers: ["Address", "Purpose"],
      cells: [
        ADDR,
        "Holds the ALM Proxy’s entire native ETH balance. It is drained on each rebalance.",
      ],
      columnIndex: 0,
    };
    // Neither the header loop (no longer keyed on "purpose") nor the generic
    // sibling fallback (now gated on isPlausibleName) may return it.
    expect(extractEntityLabel(c, i, table)).toBeNull();
  });
});

// --------------------------------------------------------------------------
// isPlausibleName
// --------------------------------------------------------------------------

describe("isPlausibleName", () => {
  it("accepts the delegate-style names that are an address's only human string", () => {
    for (const good of ["Bonapublica", "BLUE", "Cloaky", "AegisD", "The Sky Frontier Foundation's multisig"]) {
      expect(isPlausibleName(good), good).toBe(true);
    }
  });

  it("rejects clauses, bare pronouns, and over-long phrases", () => {
    for (const bad of [
      "",
      "ab",
      "ALM Proxy's entire native ETH balance into WETH. It",
      "Basin in exchange for Basin shares. It",
      "Its",
      "It’s",
      "The",
      "rewards paid out monthly",
      "Rewards paid to the",
      "The current whitelisted SparkLend Security Access Multisig",
    ]) {
      expect(isPlausibleName(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("is null- and whitespace-safe", () => {
    expect(isPlausibleName(null)).toBe(false);
    expect(isPlausibleName(undefined)).toBe(false);
    expect(isPlausibleName("   ")).toBe(false);
    expect(isPlausibleName("  The Beacon  ")).toBe(true);
  });
});

// --------------------------------------------------------------------------
// extractExpectedTokens
// --------------------------------------------------------------------------

describe("extractExpectedTokens", () => {
  it("detects USDS near an address", () => {
    const [c, i, l] = ctx("The USDS buffer at ");
    expect(extractExpectedTokens(c, i, l, null)).toContain("USDS");
  });

  it("detects SKY near an address", () => {
    const [c, i, l] = ctx("SKY staking rewards contract ");
    expect(extractExpectedTokens(c, i, l, null)).toContain("SKY");
  });

  it("detects sUSDS (case-sensitive)", () => {
    const [c, i, l] = ctx("The sUSDS savings contract is ");
    const tokens = extractExpectedTokens(c, i, l, null);
    expect(tokens).toContain("sUSDS");
    expect(tokens).not.toContain("usds");
  });

  it("detects multiple token symbols", () => {
    const [c, i, l] = ctx("The USDS and DAI vault address is ");
    const tokens = extractExpectedTokens(c, i, l, null);
    expect(tokens).toContain("USDS");
    expect(tokens).toContain("DAI");
  });

  it("includes current agent tokens (KEEL, GROVE, SPK)", () => {
    const [c, i, l] = ctx("The KEEL token address is ");
    expect(extractExpectedTokens(c, i, l, null)).toContain("KEEL");
  });

  it("returns empty when no known tokens nearby", () => {
    const [c, i, l] = ctx("The address is ");
    expect(extractExpectedTokens(c, i, l, null)).toEqual([]);
  });

  it("sees table header tokens when outside the window", () => {
    const [c, i, l] = ctx("is ");
    const table = {
      headers: ["USDS Amount", "Address", "Chain"],
      cells: ["1000", ADDR, "ethereum"],
      columnIndex: 1,
    };
    expect(extractExpectedTokens(c, i, l, table)).toContain("USDS");
  });
});
