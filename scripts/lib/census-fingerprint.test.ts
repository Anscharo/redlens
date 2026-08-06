import { describe, it, expect } from "vitest";
import {
  hasDataTable,
  docFeatures,
  fingerprint,
  isSignalFingerprint,
  SENTENCE_SHAPES,
  SIGNAL_FEATURES,
} from "./census-fingerprint.mjs";

describe("hasDataTable", () => {
  it("returns false for fewer than 3 table-shaped rows", () => {
    expect(hasDataTable("| a | b |\n| - | - |")).toBe(false);
  });

  it("returns false for a header + separator only (no data rows)", () => {
    const content = ["| Name | Value |", "| --- | --- |"].join("\n");
    expect(hasDataTable(content)).toBe(false);
  });

  it("returns true once at least 2 non-separator rows are present", () => {
    const content = ["| Name | Value |", "| --- | --- |", "| a | 1 |", "| b | 2 |"].join("\n");
    expect(hasDataTable(content)).toBe(true);
  });

  it("ignores non-table prose lines", () => {
    const content = ["Just some prose.", "More prose here.", "And more."].join("\n");
    expect(hasDataTable(content)).toBe(false);
  });
});

describe("docFeatures", () => {
  it("returns an empty array for plain prose with none of the signal features", () => {
    expect(docFeatures({ content: "Just a plain sentence with nothing special." })).toEqual([]);
  });

  it("detects a data table", () => {
    const content = ["| Name | Value |", "| --- | --- |", "| a | 1 |", "| b | 2 |"].join("\n");
    expect(docFeatures({ content })).toContain("table");
  });

  it("detects addresses via addressRefs length", () => {
    expect(docFeatures({ content: "text", addressRefs: ["0xabc"] })).toContain("addr");
    expect(docFeatures({ content: "text", addressRefs: [] })).not.toContain("addr");
    expect(docFeatures({ content: "text" })).not.toContain("addr");
  });

  it("detects a backtick key:value bullet", () => {
    expect(docFeatures({ content: "- `Budget`: 100 USDS" })).toContain("bullet-kv");
  });

  it("detects a uuid-link reference", () => {
    const content = "See [related](11111111-1111-1111-1111-111111111111) for detail.";
    expect(docFeatures({ content })).toContain("uuid-link");
  });

  it("detects every stereotyped sentence shape and prefixes it s:<id>", () => {
    for (const [id, re] of SENTENCE_SHAPES) {
      // Build a minimal string that satisfies the regex by reusing its own
      // source where possible only for the simplest (literal) shapes;
      // otherwise construct a representative sentence per id.
      const sample = sampleFor(id);
      expect(re.test(sample)).toBe(true);
      expect(docFeatures({ content: sample })).toContain(`s:${id}`);
    }
  });

  it("returns features sorted alphabetically", () => {
    const content = ["| Name | Value |", "| --- | --- |", "| a | 1 |", "| b | 2 |", "- `k`: v"].join("\n");
    const feats = docFeatures({ content, addressRefs: ["0xabc"] });
    expect(feats).toEqual([...feats].sort());
  });

  it("defaults content to empty string when missing", () => {
    expect(docFeatures({})).toEqual([]);
  });
});

function sampleFor(id: string): string {
  switch (id) {
    case "resp-party":
      return "The Responsible Party is the Facilitator.";
    case "role-for-is":
      return "The Custodian for the vault is Skybase Trust.";
    case "party-comprises":
      return "The party 'Core Council' comprises three members.";
    case "role-held-by":
      return "This role is held by the Facilitator.";
    case "signing-req":
      return "The signing requirement is 3 of 5.";
    case "addr-of-is":
      return "The address of the vault is 0x0000000000000000000000000000000000dEaD.";
    case "modify-signers":
      return "Only the Facilitator can change the signers of the multisig.";
    case "serves-as":
      return "Skybase serves as the Prime Agent.";
    case "transfer":
      return "The multisig has transferred the funds to the reserve.";
    default:
      throw new Error(`no sample defined for sentence shape ${id}`);
  }
}

describe("fingerprint", () => {
  it("returns '<type>|plain' when there are no features", () => {
    expect(fingerprint({ type: "Core", content: "Nothing special here." })).toBe("Core|plain");
  });

  it("joins detected features into the fingerprint", () => {
    const content = "- `Budget`: 100 USDS";
    expect(fingerprint({ type: "Active Data", content })).toBe("Active Data|bullet-kv");
  });
});

describe("isSignalFingerprint", () => {
  it("is true when the fingerprint carries a signal feature", () => {
    expect(isSignalFingerprint("Core|table")).toBe(true);
    expect(isSignalFingerprint("Core|addr,bullet-kv")).toBe(true);
  });

  it("is false for the plain fingerprint", () => {
    expect(isSignalFingerprint("Core|plain")).toBe(false);
  });

  it("is false for uuid-link-only, which is deliberately excluded from SIGNAL_FEATURES", () => {
    expect(SIGNAL_FEATURES.has("uuid-link")).toBe(false);
    expect(isSignalFingerprint("Core|uuid-link")).toBe(false);
  });
});
