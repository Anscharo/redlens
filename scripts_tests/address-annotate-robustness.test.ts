/**
 * Robustness tests for address-annotate.mjs.
 *
 * The Atlas is human-edited markdown. These tests verify that minor formatting
 * variations a human author might introduce — capitalisation, hyphenation,
 * extra whitespace, punctuation, typographic characters — do not silently
 * break extraction. If a test here fails after an atlas update it signals a
 * real divergence, not a noise change.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs import from TypeScript test
import { extractRoles, extractEntityLabel, extractExpectedTokens } from "../scripts/lib/address-annotate.mjs";

const ADDR = "0x1234567890123456789012345678901234567890";

function ctx(before: string, after = ""): [string, number, number] {
  const content = before + ADDR + after;
  return [content, before.length, ADDR.length];
}

// ---------------------------------------------------------------------------
// extractRoles — formatting variants
// ---------------------------------------------------------------------------

describe("extractRoles — capitalisation (all patterns use /i flag)", () => {
  const cases: [string, string, string][] = [
    ["multisig",        "MULTISIG contract at ",          "multisig"],
    ["oracle",          "ORACLE address ",                "oracle"],
    ["treasury",        "TREASURY address ",              "treasury"],
    ["buffer",          "BUFFER contract at ",            "buffer"],
    ["vault",           "VAULT address ",                 "vault"],
    ["delegate",        "DELEGATE at ",                   "delegate"],
    ["executor",        "EXECUTOR address ",              "executor"],
    ["staking-rewards", "Staking Rewards contract at ",   "staking-rewards"],
    ["incentive-pool",  "Incentive Pool address ",        "incentive-pool"],
  ];

  for (const [tag, before, expected] of cases) {
    it(`${tag} fires on uppercase variant`, () => {
      const [c, i, l] = ctx(before);
      expect(extractRoles(c, i, l, null)).toContain(expected);
    });
  }
});

describe("extractRoles — hyphenation and spacing variants", () => {
  it("multisig: 'multi-sig'", () => {
    const [c, i, l] = ctx("The multi-sig address is ");
    expect(extractRoles(c, i, l, null)).toContain("multisig");
  });

  it("multisig: 'multisig' (no hyphen)", () => {
    const [c, i, l] = ctx("The multisig address is ");
    expect(extractRoles(c, i, l, null)).toContain("multisig");
  });

  it("subproxy: 'sub-proxy'", () => {
    const [c, i, l] = ctx("sub-proxy contract ");
    expect(extractRoles(c, i, l, null)).toContain("subproxy");
  });

  it("subproxy: 'subproxy'", () => {
    const [c, i, l] = ctx("subproxy contract ");
    expect(extractRoles(c, i, l, null)).toContain("subproxy");
  });

  it("hot-wallet: 'hot wallet' (space)", () => {
    const [c, i, l] = ctx("hot wallet address ");
    expect(extractRoles(c, i, l, null)).toContain("hot-wallet");
  });

  it("hot-wallet: 'hot-wallet' (hyphen)", () => {
    const [c, i, l] = ctx("hot-wallet address ");
    expect(extractRoles(c, i, l, null)).toContain("hot-wallet");
  });

  it("oracle: 'price-feed' (hyphen)", () => {
    const [c, i, l] = ctx("The price-feed at ");
    expect(extractRoles(c, i, l, null)).toContain("oracle");
  });

  it("oracle: 'price feed' (space)", () => {
    const [c, i, l] = ctx("The price feed at ");
    expect(extractRoles(c, i, l, null)).toContain("oracle");
  });

  it("incentive-pool: 'incentive pool' (space)", () => {
    const [c, i, l] = ctx("The incentive pool at ");
    expect(extractRoles(c, i, l, null)).toContain("incentive-pool");
  });

  it("incentive-pool: 'incentive-pool' (hyphen)", () => {
    const [c, i, l] = ctx("The incentive-pool at ");
    expect(extractRoles(c, i, l, null)).toContain("incentive-pool");
  });

  it("staking-rewards: 'staking rewards' (space)", () => {
    const [c, i, l] = ctx("The staking rewards contract at ");
    expect(extractRoles(c, i, l, null)).toContain("staking-rewards");
  });

  it("staking-rewards: 'staking-rewards' (hyphen)", () => {
    const [c, i, l] = ctx("The staking-rewards contract at ");
    expect(extractRoles(c, i, l, null)).toContain("staking-rewards");
  });

  it("staking-rewards: 'staking reward' (singular)", () => {
    const [c, i, l] = ctx("The staking reward contract at ");
    expect(extractRoles(c, i, l, null)).toContain("staking-rewards");
  });

  it("reserve: 'reserves' (plural)", () => {
    const [c, i, l] = ctx("The reserves contract at ");
    expect(extractRoles(c, i, l, null)).toContain("reserve");
  });

  it("reserve: 'reserve' (singular)", () => {
    const [c, i, l] = ctx("The reserve contract at ");
    expect(extractRoles(c, i, l, null)).toContain("reserve");
  });
});

describe("extractRoles — extra whitespace tolerance", () => {
  it("double space between words does not break role detection", () => {
    const [c, i, l] = ctx("The  multisig  address  is ");
    expect(extractRoles(c, i, l, null)).toContain("multisig");
  });

  it("incentive pool with two spaces", () => {
    const [c, i, l] = ctx("The incentive  pool at ");
    expect(extractRoles(c, i, l, null)).toContain("incentive-pool");
  });
});

describe("extractRoles — word boundary: compound words do not fire", () => {
  it("'controller' does not fire on 'MainnetController' (no word boundary mid-compound)", () => {
    const [c, i, l] = ctx("The MainnetController at ");
    expect(extractRoles(c, i, l, null)).not.toContain("controller");
  });

  it("'proxy' does not fire when word is 'subproxy'", () => {
    const [c, i, l] = ctx("The subproxy contract ");
    expect(extractRoles(c, i, l, null)).not.toContain("proxy");
  });
});

// ---------------------------------------------------------------------------
// extractEntityLabel — formatting variants
// ---------------------------------------------------------------------------

describe("extractEntityLabel — typographic apostrophes", () => {
  // Both forms must be *consumed* as the possessive, not captured as part of
  // the name — the possessive group is ['’]s, so the label comes out bare.
  it("ASCII apostrophe in possessive ('X's address')", () => {
    const [c, i] = ctx("Sky Frontier Foundation's address is ");
    expect(extractEntityLabel(c, i, null)).toBe("Sky Frontier Foundation");
  });

  it("typographic right-single-quote in possessive ('X’s address')", () => {
    const [c, i] = ctx("Sky Frontier Foundation’s address is ");
    expect(extractEntityLabel(c, i, null)).toBe("Sky Frontier Foundation");
  });

  it("a bare trailing 's' is not a possessive (‘Its address’ is not entity ‘It’)", () => {
    const [c, i] = ctx("Its address on Ethereum Mainnet is ");
    expect(extractEntityLabel(c, i, null)).toBeNull();
  });
});

describe("extractEntityLabel — sentence boundaries", () => {
  // The capture class has no ".", so a non-greedy walk backwards stops at the
  // end of the previous sentence instead of swallowing it.
  it("does not reach back across a period into the preceding sentence", () => {
    const [c, i] = ctx("Rewards accrue to the vault buffer. The Beacon's address is ");
    expect(extractEntityLabel(c, i, null)).toBe("The Beacon");
  });

  it("returns null rather than a clause when the only capital is mid-sentence", () => {
    const [c, i] = ctx("converts between DAI and USDS at 1:1 through the converter. Its address is ");
    expect(extractEntityLabel(c, i, null)).toBeNull();
  });
});

describe("extractEntityLabel — extra whitespace", () => {
  it("double space before 'address is' still matches", () => {
    const [c, i] = ctx("The address of Spark Operations Multisig  is ");
    expect(extractEntityLabel(c, i, null)).toBe("Spark Operations Multisig");
  });
});

describe("extractEntityLabel — structured label keyword case", () => {
  it("'Recipient: X' fires (capital R)", () => {
    const [c, i] = ctx("Recipient: Sky Frontier Foundation ");
    expect(extractEntityLabel(c, i, null)).toBe("Sky Frontier Foundation");
  });

  it("'recipient: X' fires (lowercase r — pattern has /i flag)", () => {
    const [c, i] = ctx("recipient: Sky Frontier Foundation ");
    expect(extractEntityLabel(c, i, null)).toBe("Sky Frontier Foundation");
  });

  it("'Operator: X' fires", () => {
    const [c, i] = ctx("Operator: Steakhouse Financial ");
    expect(extractEntityLabel(c, i, null)).toBe("Steakhouse Financial");
  });

  it("'owner: X' fires (lowercase)", () => {
    const [c, i] = ctx("owner: Maker Foundation ");
    expect(extractEntityLabel(c, i, null)).toBe("Maker Foundation");
  });
});

describe("extractEntityLabel — known case-sensitivity in prose patterns", () => {
  // The 'address of' prose patterns are case-sensitive on the keyword 'address'.
  // In practice the Atlas always writes 'address' in lowercase in these phrases.
  it("'address of X is' works (lowercase 'address')", () => {
    const [c, i] = ctx("The address of Spark Operations Multisig is ");
    expect(extractEntityLabel(c, i, null)).toBe("Spark Operations Multisig");
  });

  it("leading 'The' is captured when article strip doesn't fire (known behaviour)", () => {
    // The optional (?:the\s+)? in the 'X address is' pattern is case-sensitive.
    // Capital 'The' is not stripped, so the entity label includes it.
    // This is a known limitation: 'the X address is' (lowercase) strips 'the',
    // 'The X address is' (capital) does not.
    const [c, i] = ctx("The Sky Frontier Foundation address is ");
    const label = extractEntityLabel(c, i, null);
    expect(label).toMatch(/Sky Frontier Foundation/);
  });
});

// ---------------------------------------------------------------------------
// extractExpectedTokens — formatting variants
// ---------------------------------------------------------------------------

describe("extractExpectedTokens — case sensitivity (symbols are case-sensitive by design)", () => {
  it("USDS fires (exact case)", () => {
    const [c, i, l] = ctx("holds USDS and ");
    expect(extractExpectedTokens(c, i, l, null)).toContain("USDS");
  });

  it("sUSDS fires (mixed case)", () => {
    const [c, i, l] = ctx("earns sUSDS from ");
    expect(extractExpectedTokens(c, i, l, null)).toContain("sUSDS");
  });

  it("'usds' (all lowercase) does NOT fire — tokens are case-sensitive by design", () => {
    // Token symbols are canonical identifiers (sUSDS ≠ USDS ≠ usds).
    // A human changing casing in the atlas would be a meaningful edit.
    const [c, i, l] = ctx("receives usds at ");
    expect(extractExpectedTokens(c, i, l, null)).not.toContain("USDS");
  });

  it("multiple tokens in same window all collected", () => {
    const [c, i, l] = ctx("USDS, DAI, and SKY balances at ");
    const tokens = extractExpectedTokens(c, i, l, null);
    expect(tokens).toContain("USDS");
    expect(tokens).toContain("DAI");
    expect(tokens).toContain("SKY");
  });
});
