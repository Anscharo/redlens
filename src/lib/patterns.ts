export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A partial UUID — a prefix of a full UUID: the 8-hex first segment, optionally
// continuing into later dash-separated groups (e.g. "384d29b0" or
// "384d29b0-8621"). The 8-hex minimum keeps it from hijacking real hex-ish
// words ("facade", "decade" are only 6); even an 8-hex word like "deadbeef"
// matches no doc id and so falls through to full-text search. Drives the search
// "find a doc by partial UUID" fast-path.
export const UUID_PREFIX_RE = /^[0-9a-f]{8,}(?:-[0-9a-f]{1,12}){0,4}$/i;

// On-chain address forms. The hex-boundary lookarounds are load-bearing: they
// stop a 40-hex match from being carved out of a longer hex run (a tx hash, a
// bytes32). Mirrors scripts/lib/address-chains.mjs + src/lib/rehypeEthAddresses.ts
// — keep the three in sync; see .claude/skills/address-extraction/SKILL.md.
// Source strings, not RegExp: a shared /g regex carries lastIndex between scans.
export const EVM_ADDRESS_SRC = String.raw`(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])`;
export const SOL_ADDRESS_SRC = String.raw`\b[1-9A-HJ-NP-Za-km-z]{43,44}\b`;
