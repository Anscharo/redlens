/**
 * Base58 and program-derived-address maths for Solana.
 *
 * This exists because the balances pass has to *derive* the token accounts it
 * reads rather than look them up: the RPC methods that enumerate an owner's
 * token accounts — `getTokenAccountsByOwner`, `getTokenLargestAccounts` — are
 * indexed scans, and the public endpoint the registry uses does not serve them
 * (measured: they hang, while `getMultipleAccounts` answers in milliseconds).
 *
 * Deriving is how a wallet finds the account anyway. An Associated Token
 * Account is a PDA over (owner, token program, mint), so the address is a pure
 * function of those three — no lookup required.
 */
import { createHash } from "node:crypto";

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/**
 * Base58 (Bitcoin alphabet) for a byte array — the encoding Solana pubkeys use.
 *
 * Leading zero bytes are not part of the number, so they are emitted separately
 * as '1's; that is what makes the all-zero System Program id 32 characters and
 * not 33.
 */
export function encodeBase58(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => B58_ALPHABET[d]).join("");
}

/** Inverse of encodeBase58. Throws on a character outside the alphabet. */
export function decodeBase58(str) {
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;
  const bytes = [];
  for (let i = zeros; i < str.length; i++) {
    let carry = B58_ALPHABET.indexOf(str[i]);
    if (carry < 0) throw new Error(`not base58: ${JSON.stringify(str)}`);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
}

// ---------------------------------------------------------------------------
// ed25519 point decompression
//
// A PDA is *defined* as an address that is NOT a valid ed25519 public key —
// that is what guarantees no private key can sign for it. Finding one therefore
// means testing candidate hashes for curve membership.
//
// Curve: -x² + y² = 1 + d·x²·y² over GF(2²⁵⁵-19). A compressed point stores y
// in the low 255 bits, so membership is decided by whether the implied x² has a
// square root.
// ---------------------------------------------------------------------------
const P = (1n << 255n) - 19n;
// d = -121665/121666 mod p
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

function powMod(base, exp, mod) {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/** Whether a 32-byte value is a point on ed25519 — i.e. a real public key. */
export function isOnCurve(bytes) {
  if (bytes.length !== 32) return false;
  let y = 0n;
  for (let i = 31; i >= 0; i--) {
    y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  }
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = (D * y2 + 1n) % P;
  // Candidate root of u/v via the p ≡ 5 (mod 8) shortcut:
  // x = u·v³·(u·v⁷)^((p-5)/8)
  const v3 = (((v * v) % P) * v) % P;
  const v7 = (((v3 * v3) % P) * v) % P;
  const x = (((u * v3) % P) * powMod((u * v7) % P, (P - 5n) / 8n, P)) % P;
  const vxx = (((v * x) % P) * x) % P;
  // vxx === u: x is the root. vxx === -u: the root is x·√-1, which also exists.
  return vxx === u % P || (vxx + u) % P === 0n;
}

const PDA_MARKER = Buffer.from("ProgramDerivedAddress", "utf8");

/**
 * The first off-curve address for these seeds under this program, with its bump
 * — Solana's `findProgramAddress`. Counts the bump down from 255, so the result
 * is the canonical ("bump seed") address every on-chain program derives too.
 */
export function findProgramAddress(seeds, programId) {
  const pid = decodeBase58(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash("sha256");
    for (const s of seeds) h.update(Buffer.from(s));
    h.update(Buffer.from([bump]));
    h.update(Buffer.from(pid));
    h.update(PDA_MARKER);
    const candidate = Uint8Array.from(h.digest());
    if (!isOnCurve(candidate)) return { address: encodeBase58(candidate), bump };
  }
  // 256 consecutive on-curve hashes; cryptographically impossible in practice.
  throw new Error("no off-curve address for these seeds");
}

/**
 * Where `owner` holds `mint` — the Associated Token Account.
 *
 * `tokenProgram` must match the mint's owning program: a Token-2022 mint's ATA
 * is derived under a different seed than a classic SPL Token mint's, so passing
 * the wrong one yields a real-looking address that simply never exists.
 */
export function associatedTokenAddress(owner, mint, tokenProgram) {
  return findProgramAddress(
    [decodeBase58(owner), decodeBase58(tokenProgram), decodeBase58(mint)],
    ASSOCIATED_TOKEN_PROGRAM,
  ).address;
}
