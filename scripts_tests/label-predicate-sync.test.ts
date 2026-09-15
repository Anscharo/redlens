/**
 * The two copies of the entityLabel quality predicate must never disagree.
 *
 * `isPlausibleName` (scripts/lib/address-annotate.mjs) decides what the build
 * pipeline is allowed to WRITE into addresses.atlas.json; `isCleanLabel`
 * (src/lib/addressName.ts) decides what the app and chat are allowed to SHOW.
 * They are deliberately two copies — the pipeline is Node ESM under scripts/
 * and apps/web must not take a packaging dependency on it — so this file is the
 * sync gate: one fixture list, both functions, same verdict on every string.
 *
 * A drift here is not cosmetic. If the display filter is stricter, the pipeline
 * writes names nothing will ever render; if it is looser, a fragment reaches the
 * Owner column. See docs/plans/entitylabel-fragment-defect.md.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs import from TypeScript test
import { isPlausibleName } from "../scripts/lib/address-annotate.mjs";
import { isCleanLabel } from "../src/lib/addressName";

// Names that must survive both. Several of these are an address's ONLY human
// string (no chainlog id, no verified Etherscan name), so a false reject here
// costs the reader the only label there is.
const NAMES = [
  "Bonapublica",
  "BLUE",
  "Cloaky",
  "AegisD",
  "The Beacon",
  "ALM Proxy",
  "Spark Operations Multisig",
  "The Aligned Delegates Buffer Multisig",
  "Sky Frontier Foundation",
  "The Sky Frontier Foundation's multisig",
  "Wrap Proxy ETH Facet",
  "Basin Facet",
  "PSM Facet",
  "Grove Foundation",
  "Steakhouse Financial",
  "MCD_VAT",
];

// Strings both must refuse. The first block is the observed defect: clauses the
// extractor scraped out of A.2 prose and shipped as labels.
const NOT_NAMES = [
  "ALM Proxy's entire native ETH balance into WETH. It",
  "Basin in exchange for Basin shares. It",
  "DAI and the Lite PSM's no-fee path. It",
  "Sky Governance through the Pause Proxy. The Beacon",
  "Synthetix-style reward farm and claims accrued rewards. It",
  "The current whitelisted SparkLend Security Access Multisig", // 58 chars
  "Its",
  "It's",
  "It’s",
  "The",
  "This",
  "Rewards paid to the",
  "Transfers made by",
  "routing through DAI", // leading lowercase
  "ab", // too short
  "",
  "   ",
];

describe("isPlausibleName / isCleanLabel agree", () => {
  for (const good of NAMES) {
    it(`both accept ${JSON.stringify(good)}`, () => {
      expect(isPlausibleName(good)).toBe(true);
      expect(isCleanLabel(good)).toBe(true);
    });
  }

  for (const bad of NOT_NAMES) {
    it(`both reject ${JSON.stringify(bad)}`, () => {
      expect(isPlausibleName(bad)).toBe(false);
      expect(isCleanLabel(bad)).toBe(false);
    });
  }

  it("agree on the length bounds, to the character", () => {
    for (const len of [2, 3, 47, 48, 49]) {
      const s = "A" + "x".repeat(len - 1);
      expect(isPlausibleName(s), `${len} chars`).toBe(isCleanLabel(s));
    }
  });

  it("agree on null and undefined", () => {
    expect(isPlausibleName(null)).toBe(isCleanLabel(null));
    expect(isPlausibleName(undefined)).toBe(isCleanLabel(undefined));
  });
});
