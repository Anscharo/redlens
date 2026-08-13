export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A partial UUID — a prefix of a full UUID: the 8-hex first segment, optionally
// continuing into later dash-separated groups (e.g. "384d29b0" or
// "384d29b0-8621"). The 8-hex minimum keeps it from hijacking real hex-ish
// words ("facade", "decade" are only 6); even an 8-hex word like "deadbeef"
// matches no doc id and so falls through to full-text search. Drives the search
// "find a doc by partial UUID" fast-path.
export const UUID_PREFIX_RE = /^[0-9a-f]{8,}(?:-[0-9a-f]{1,12}){0,4}$/i;

// On-chain address forms — this is the src-side (frontend + server TS) home.
// scripts/lib/address-chains.mjs is the pipeline-side home (the .mjs build
// scripts can't import TS); patterns.sync.test.ts is the bridge — it imports
// both and asserts the shared source strings are byte-identical, so it IS the
// sync mechanism, not a comment promising one. See
// .claude/skills/address-extraction/SKILL.md for why the boundaries matter.
//
// Bare "body" forms: just the digit/char-class run, no boundary assertion.
// Every other form below composes from these instead of retyping the body —
// retyping is exactly how an unanchored copy that matched the leading 40 hex
// of a transaction hash got into the pipeline. NOTE the naming asymmetry with
// address-chains.mjs: its `*_ADDR_SRC` constants ARE this bare body, while
// here the boundary-wrapped form already holds the plain `_ADDRESS_SRC` name
// (kept for existing importers), so the bare form gets the more explicit
// `_BODY_SRC` suffix. patterns.sync.test.ts documents the exact cross-file
// pairing so this doesn't read as drift.
export const EVM_ADDRESS_BODY_SRC = String.raw`0x[0-9a-fA-F]{40}`;
export const SOL_ADDRESS_BODY_SRC = String.raw`[1-9A-HJ-NP-Za-km-z]{43,44}`;

// Free-text scanning forms. The hex-boundary lookarounds are load-bearing:
// they stop a 40-hex match from being carved out of a longer hex run (a tx
// hash, a bytes32). `\b` similarly scopes the Solana body to a whole base58
// token rather than a substring of a longer run. Source strings, not RegExp:
// a shared /g regex carries lastIndex between scans — each call site compiles
// its own via `new RegExp(EVM_ADDRESS_SRC, "g")`.
export const EVM_ADDRESS_SRC = String.raw`(?<![0-9a-fA-F])${EVM_ADDRESS_BODY_SRC}(?![0-9a-fA-F])`;
export const SOL_ADDRESS_SRC = String.raw`\b${SOL_ADDRESS_BODY_SRC}\b`;

// Whole-string test forms — "is this already-isolated value, in its entirety,
// an address?" (a table cell, an ICD param value, a rendered param string). No
// lookaround needed: the ^...$ anchors already require the ENTIRE input to be
// the address body.
export const EVM_ADDRESS_EXACT_RE = new RegExp(String.raw`^${EVM_ADDRESS_BODY_SRC}$`);
export const SOL_ADDRESS_EXACT_RE = new RegExp(String.raw`^${SOL_ADDRESS_BODY_SRC}$`);

// Atlas document-number core ("A.2.2.8.1", "A.1.6.1.var2", "NR-7"). A source
// string for the same lastIndex reason as the address patterns above. Shared by
// the verify/ checks (which strip doc-no digit noise before scanning an answer
// for numbers, and validate cited doc numbers) — it lives here rather than in
// one of them so the two can't import each other in a cycle. Structural, not
// editorial: per CLAUDE.md the SHAPE of a doc number is stable even though any
// particular number is not.
export const DOC_NO_CORE = String.raw`(?:[A-Z]{1,3}(?:\.\d+)+(?:\.var\d+)?|NR-\d+)`;
// Two DELIBERATE dialects of this shape exist and are not drift: docRefResolver.ts
// accepts only an "A" prefix, and dutyCollapse.ts permits ".var" at any segment.
// Both are narrower/looser on purpose for their own matching job — don't fold
// them in without checking those call sites.
