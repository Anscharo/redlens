/**
 * `getAccountInfo` ground truth for Solana addresses — the counterpart to
 * address-code.mjs's `eth_getCode` pass.
 *
 * Solana has no contract/EOA dichotomy to probe for. Every address is an
 * account, and what it *is* comes from two fields the RPC returns: `executable`
 * (this account holds program bytecode) and `owner` (the program that may write
 * to it). A keypair wallet is owned by the System Program; a token account or a
 * mint by SPL Token; a PDA by whichever program derived it. Reading all of them
 * as "no bytecode → EOA", which is what the pipeline did before this pass
 * existed, mislabelled all 40 of the atlas's Solana addresses — including the
 * ALM Controller *program* itself.
 *
 * One `getMultipleAccounts` call per batch, with a 166-byte `dataSlice`: enough
 * for the upgradeable-loader program pointer (bytes 4..36) and the Token-2022
 * account discriminator (byte 165), and never enough to drag down an ELF.
 */

import { SOLANA_RPC } from "./chains.mjs";

// Accounts per getMultipleAccounts call. Solana's own cap is 100, but
// PublicNode rejects anything over 10 with an HTTP 403 carrying a JSON-RPC
// -32602 "blocked parameter: params.0.#" — measured, not documented, so treat
// this as the endpoint's limit rather than the protocol's.
const BATCH = 10;
// Covers byte 165 (Token-2022 AccountType) inclusive.
const DATA_SLICE = 166;

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const BPF_UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

// Only programs whose ids are fixed parts of the runtime. A wrong friendly name
// is worse than none, so anything else is reported by its raw pubkey — or by
// the atlas's own label for it, when the owner is itself an atlas address (see
// `names` in applySolanaAccounts).
export const PROGRAM_NAMES = {
  [SYSTEM_PROGRAM]: "System Program",
  [TOKEN_PROGRAM]: "SPL Token",
  [TOKEN_2022_PROGRAM]: "SPL Token-2022",
  [BPF_UPGRADEABLE_LOADER]: "BPF Upgradeable Loader",
  BPFLoader2111111111111111111111111111111111: "BPF Loader",
  BPFLoader1111111111111111111111111111111111: "BPF Loader (deprecated)",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token Account Program",
  Stake11111111111111111111111111111111111111: "Stake Program",
  Vote111111111111111111111111111111111111111: "Vote Program",
  Config1111111111111111111111111111111111111: "Config Program",
};

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Base58 (Bitcoin alphabet) for a byte array — the encoding Solana pubkeys use.
 * Hand-rolled rather than pulled in as a dependency: it is one big-endian base
 * conversion, and the pipeline needs it in exactly one place (turning the
 * upgradeable loader's raw 32-byte program-data pointer into an address).
 *
 * Leading zero bytes are not part of the number, so they are emitted separately
 * as '1's — that is what makes the all-zero System Program id 32 characters and
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

/** The account's sliced data as bytes, or null when the RPC returned none. */
function dataBytes(acc) {
  const raw = Array.isArray(acc?.data) ? acc.data[0] : null;
  if (typeof raw !== "string" || raw === "") return null;
  try {
    return Uint8Array.from(Buffer.from(raw, "base64"));
  } catch {
    return null;
  }
}

/**
 * The ProgramData account an upgradeable program points at — Solana's exact
 * analogue of a proxy's implementation address, and the reason a program can be
 * changed after deployment.
 *
 * Layout: a 4-byte little-endian UpgradeableLoaderState discriminant (2 =
 * Program) followed by the 32-byte programdata pubkey.
 */
export function programDataAddress(acc) {
  const b = dataBytes(acc);
  if (!b || b.length < 36) return null;
  if (b[0] !== 2 || b[1] !== 0 || b[2] !== 0 || b[3] !== 0) return null;
  return encodeBase58(b.slice(4, 36));
}

/**
 * Which kind of SPL Token account this is.
 *
 * Classic SPL Token fixes the sizes: a mint is 82 bytes, a token account 165, a
 * multisig 355. Token-2022 keeps those base layouts but appends extensions, so
 * anything longer than a classic token account carries an AccountType byte at
 * offset 165 (1 = Mint, 2 = Account) to say which it grew out of.
 */
function tokenAccountKind(acc, space) {
  if (space === 165) return "token-account";
  if (space === 82) return "mint";
  if (space === 355) return "token-multisig";
  if (space != null && space > 165) {
    const b = dataBytes(acc);
    const tag = b && b.length > 165 ? b[165] : null;
    if (tag === 1) return "mint";
    if (tag === 2) return "token-account";
  }
  return "program-account";
}

/**
 * What an account is, from its owner and executable flag.
 *
 * `isContract` stays the narrow claim it is on EVM chains — this account holds
 * executable code — so a mint or a token account is honestly `false`. The
 * report keys off `accountType` instead of collapsing everything non-executable
 * into "EOA"; only a System-Program-owned keypair is really that.
 *
 * A null account (never created, or closed) is reported as "missing" rather
 * than guessed at: the atlas naming an address Solana has never seen is a
 * data-quality signal in its own right.
 */
export function classifySolanaAccount(acc) {
  if (!acc) {
    return { accountType: "missing", programOwner: null, executable: false, space: null, isContract: false, isProxy: false };
  }
  const programOwner = typeof acc.owner === "string" ? acc.owner : null;
  const space = typeof acc.space === "number" ? acc.space : null;
  const base = { programOwner, executable: !!acc.executable, space };

  if (acc.executable) {
    const upgradeable = programOwner === BPF_UPGRADEABLE_LOADER;
    const implementation = upgradeable ? programDataAddress(acc) : null;
    return {
      ...base,
      accountType: "program",
      isContract: true,
      isProxy: upgradeable && !!implementation,
      ...(implementation ? { implementation } : {}),
    };
  }
  if (programOwner === SYSTEM_PROGRAM) {
    return { ...base, accountType: "wallet", isContract: false, isProxy: false };
  }
  if (programOwner === TOKEN_PROGRAM || programOwner === TOKEN_2022_PROGRAM) {
    return { ...base, accountType: tokenAccountKind(acc, space), isContract: false, isProxy: false };
  }
  return { ...base, accountType: "program-account", isContract: false, isProxy: false };
}

/**
 * Fetch account info for every pubkey, batched.
 *
 * Returns only the pubkeys the RPC actually answered for, plus how many batches
 * failed. A batch that errors leaves its addresses out of the map entirely —
 * the same discipline as address-code.mjs's `{ ok }` results, because "the RPC
 * is down" and "this account does not exist" both look like a missing account
 * and must not be conflated. `fetchImpl` is injectable for tests.
 */
export async function fetchSolanaAccounts(
  pubkeys,
  { rpcUrl = SOLANA_RPC, fetchImpl = fetch, batch = BATCH } = {},
) {
  const accounts = new Map();
  let failed = 0;
  if (!rpcUrl) return { accounts, failed: pubkeys.length ? 1 : 0, error: "no Solana RPC in the chain registry" };

  let error = null;
  for (let i = 0; i < pubkeys.length; i += batch) {
    const slice = pubkeys.slice(i, i + batch);
    try {
      const res = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getMultipleAccounts",
          params: [slice, { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: DATA_SLICE } }],
        }),
      });
      // Parse before checking status: a rejected request carries its reason in
      // a JSON-RPC error body even when the HTTP status is 4xx, and "HTTP 403"
      // alone is indistinguishable from an egress-policy denial.
      const body = await res.json().catch(() => null);
      if (body?.error) throw new Error(`${body.error.message ?? "RPC error"} (HTTP ${res.status})`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = body?.result?.value;
      if (!Array.isArray(value)) throw new Error("malformed result");
      slice.forEach((key, j) => accounts.set(key, value[j] ?? null));
    } catch (err) {
      failed++;
      error ??= err.message;
    }
  }
  return { accounts, failed, ...(error ? { error } : {}) };
}

/**
 * Probe every Solana address and fold the answers into the address map.
 *
 * `names` maps a pubkey to a human label (the atlas's own entityLabels), so an
 * account owned by a program the atlas already documents reads as "owned by
 * Solana ALM Controller Program" rather than a bare pubkey.
 *
 * Mutates `addresses` in place and returns aggregate stats. `fetchAccounts` is
 * injectable so tests need no network.
 */
export async function applySolanaAccounts(
  addresses,
  { names = {}, log = console.log, fetchAccounts = fetchSolanaAccounts } = {},
) {
  const pubkeys = Object.entries(addresses)
    .filter(([, info]) => info.chain === "solana")
    .map(([addr]) => addr);
  const stats = { checked: 0, failed: 0, byType: {} };
  if (pubkeys.length === 0) return stats;

  const { accounts, failed, error } = await fetchAccounts(pubkeys);
  if (failed) {
    stats.failed = failed;
    log(`  ! ${failed} Solana batch(es) failed${error ? ` (${error})` : ""} — those accounts keep their existing values`);
  }

  for (const [key, acc] of accounts) {
    const info = addresses[key];
    if (!info) continue;
    const c = classifySolanaAccount(acc);
    info.accountType = c.accountType;
    info.isContract = c.isContract;
    info.isProxy = c.isProxy;
    if (c.programOwner) {
      info.programOwner = c.programOwner;
      const name = PROGRAM_NAMES[c.programOwner] ?? names[c.programOwner];
      if (name) info.programOwnerName = name;
    }
    if (c.implementation) info.implementation = c.implementation;
    stats.checked++;
    stats.byType[c.accountType] = (stats.byType[c.accountType] ?? 0) + 1;
  }
  return stats;
}
