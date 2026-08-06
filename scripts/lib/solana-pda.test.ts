import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  encodeBase58,
  decodeBase58,
  isOnCurve,
  findProgramAddress,
  associatedTokenAddress,
} from "./solana-pda.mjs";

const hex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const USDS_MINT = "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA";

describe("encodeBase58", () => {
  // The standard Bitcoin base58 vectors — the same alphabet Solana pubkeys use.
  it.each([
    ["", ""],
    ["61", "2g"],
    ["626262", "a3gV"],
    ["636363", "aPEr"],
    ["73696d706c792061206c6f6e6720737472696e67", "2cFupjhnEsSn59qHXstmK2ffpLv2"],
    ["00eb15231dfceb60925886b67d065299925915aeb172c06647", "1NS17iag9jJgTHD1VXjvLCEnZuQ3rJDE9L"],
    ["516b6fcd0f", "ABnLTmg"],
  ])("encodes %s", (input, expected) => {
    expect(encodeBase58(hex(input))).toBe(expected);
  });

  it("emits leading zero bytes as '1' without an extra digit", () => {
    // The all-zero pubkey is the System Program id — exactly 32 characters. A
    // naive implementation seeded with digits=[0] emits 33.
    expect(encodeBase58(new Uint8Array(32))).toBe(SYSTEM_PROGRAM);
    expect(encodeBase58(new Uint8Array(32))).toHaveLength(32);
  });
});

describe("decodeBase58", () => {
  it("round-trips every real pubkey shape", () => {
    for (const key of [TOKEN_PROGRAM, USDS_MINT, SYSTEM_PROGRAM, "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"]) {
      expect(decodeBase58(key)).toHaveLength(32);
      expect(encodeBase58(decodeBase58(key))).toBe(key);
    }
  });

  it("rejects a string outside the alphabet", () => {
    // '0', 'O', 'I' and 'l' are excluded precisely because they misread.
    expect(() => decodeBase58("not0valid")).toThrow(/base58/);
  });
});

describe("isOnCurve", () => {
  it("accepts a real keypair pubkey", () => {
    // The atlas's Prime Primary Relayer — a keypair address, so by definition a
    // valid ed25519 point, or nobody could sign for it.
    expect(isOnCurve(decodeBase58("99J5Vcf3tav2dorWmB1qxdXtD4MKk6pyayQwS8RCXZKc"))).toBe(true);
    expect(isOnCurve(decodeBase58(TOKEN_PROGRAM))).toBe(true);
  });

  it("rejects a System-Program-owned address that is nonetheless a PDA", () => {
    // "Pioneer Incentive Pool wallet" is System-owned but off-curve, so no
    // private key exists for it — it is program-derived, not a keypair. Owner
    // alone cannot tell these apart, which is why classifySolanaAccount takes
    // the address too.
    expect(isOnCurve(decodeBase58("8JmDPG5BFQ6gpUPJV9xBixYJLqTKCSNotkXksTmNsQfj"))).toBe(false);
  });

  it("rejects a PDA", () => {
    // The USDS associated token account derived below. A PDA is *defined* as
    // off-curve; if this returned true, findProgramAddress could hand back an
    // address someone holds the private key for.
    expect(isOnCurve(decodeBase58("2NZ3vCje53JkvVJCwn8zFpGnmNdoRjfV1VigcdfGsh9a"))).toBe(false);
  });

  it("rejects a value that is not 32 bytes", () => {
    expect(isOnCurve(new Uint8Array(16))).toBe(false);
  });

  it("rejects a y coordinate at or beyond the field prime", () => {
    // 2²⁵⁵-19 encoded little-endian: a valid 32-byte string, not a valid point.
    const p = new Uint8Array(32).fill(0xff);
    p[0] = 0xed;
    p[31] = 0x7f;
    expect(isOnCurve(p)).toBe(false);
  });
});

describe("associatedTokenAddress", () => {
  it("derives the account mainnet actually holds the tokens in", () => {
    // Verified against mainnet: this address exists and getAccountInfo reports
    // mint = USDS and owner = the wallet below. That round-trip is what makes
    // this vector trustworthy — it was read off the chain, not off a spec.
    expect(
      associatedTokenAddress("8JmDPG5BFQ6gpUPJV9xBixYJLqTKCSNotkXksTmNsQfj", USDS_MINT, TOKEN_PROGRAM),
    ).toBe("2NZ3vCje53JkvVJCwn8zFpGnmNdoRjfV1VigcdfGsh9a");
  });

  it("derives a different account under the Token-2022 program", () => {
    // The token program is a seed, so a Token-2022 mint's ATA is elsewhere —
    // passing the wrong one yields a plausible address that never exists.
    const classic = associatedTokenAddress("8JmDPG5BFQ6gpUPJV9xBixYJLqTKCSNotkXksTmNsQfj", USDS_MINT, TOKEN_PROGRAM);
    const t2022 = associatedTokenAddress(
      "8JmDPG5BFQ6gpUPJV9xBixYJLqTKCSNotkXksTmNsQfj",
      USDS_MINT,
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    );
    expect(t2022).not.toBe(classic);
  });

  it("is deterministic", () => {
    const a = associatedTokenAddress("8JmDPG5BFQ6gpUPJV9xBixYJLqTKCSNotkXksTmNsQfj", USDS_MINT, TOKEN_PROGRAM);
    const b = associatedTokenAddress("8JmDPG5BFQ6gpUPJV9xBixYJLqTKCSNotkXksTmNsQfj", USDS_MINT, TOKEN_PROGRAM);
    expect(a).toBe(b);
  });
});

describe("findProgramAddress", () => {
  it("returns an off-curve address with its bump", () => {
    const { address, bump } = findProgramAddress([Buffer.from("seed")], TOKEN_PROGRAM);
    expect(isOnCurve(decodeBase58(address))).toBe(false);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it("finds the canonical bump — every higher one is on-curve", () => {
    // On-chain programs derive with the highest valid bump, so a different
    // search order would silently yield a different account for the same seeds.
    // Recomputed here independently of the implementation.
    const seed = Buffer.from("seed");
    const { bump } = findProgramAddress([seed], TOKEN_PROGRAM);
    const candidate = (b: number) =>
      Uint8Array.from(
        createHash("sha256")
          .update(seed)
          .update(Buffer.from([b]))
          .update(Buffer.from(decodeBase58(TOKEN_PROGRAM)))
          .update(Buffer.from("ProgramDerivedAddress", "utf8"))
          .digest(),
      );
    for (let b = 255; b > bump; b--) expect(isOnCurve(candidate(b))).toBe(true);
    expect(isOnCurve(candidate(bump))).toBe(false);
  });
});
