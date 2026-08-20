import { describe, it, expect } from "vitest";
import { isUuidPrefix, matchUuidPrefix } from "./uuidSearch";

describe("isUuidPrefix", () => {
  it("accepts the 8-hex first segment and longer dashed prefixes", () => {
    expect(isUuidPrefix("384d29b0")).toBe(true);
    expect(isUuidPrefix("384d29b0-8621")).toBe(true);
    expect(isUuidPrefix("384d29b0-8621-4dfa-a6c3-23b1397a9712")).toBe(true); // full uuid is also a prefix
    expect(isUuidPrefix("A491D7D0")).toBe(true); // case-insensitive
  });

  it("rejects fragments shorter than 8 hex (avoids hijacking hex-ish words)", () => {
    expect(isUuidPrefix("384d")).toBe(false);
    expect(isUuidPrefix("facade")).toBe(false); // 6 hex
    expect(isUuidPrefix("decade")).toBe(false);
  });

  it("rejects non-hex queries and decorated tokens", () => {
    expect(isUuidPrefix("governance")).toBe(false);
    expect(isUuidPrefix("0xbe8e3e")).toBe(false); // the 'x' isn't hex — 0x addresses aren't hijacked
    expect(isUuidPrefix("A.1.2")).toBe(false);
    expect(isUuidPrefix("MCD_VAT")).toBe(false);
    expect(isUuidPrefix("")).toBe(false);
  });

  it("matches an 8-hex word too — harmless because it resolves to no doc id", () => {
    expect(isUuidPrefix("deadbeef")).toBe(true); // matchUuidPrefix returns [] → caller falls through
  });
});

describe("matchUuidPrefix", () => {
  const ids = [
    "384d29b0-8621-4dfa-a6c3-23b1397a9712",
    "a491d7d0-3e0b-4b6f-a9a7-25b19b6f7117",
    "66845ee6-4405-4ed8-bb22-4a7558e63a52",
  ];

  it("finds the doc whose id starts with the fragment", () => {
    expect(matchUuidPrefix("384d29b0", ids)).toEqual(["384d29b0-8621-4dfa-a6c3-23b1397a9712"]);
  });

  it("is case-insensitive", () => {
    expect(matchUuidPrefix("A491D7D0", ids)).toEqual(["a491d7d0-3e0b-4b6f-a9a7-25b19b6f7117"]);
  });

  it("matches longer dashed prefixes", () => {
    expect(matchUuidPrefix("66845ee6-4405", ids)).toEqual(["66845ee6-4405-4ed8-bb22-4a7558e63a52"]);
  });

  it("returns empty for a fragment that matches no id (caller falls through)", () => {
    expect(matchUuidPrefix("deadbeef", ids)).toEqual([]);
  });
});
