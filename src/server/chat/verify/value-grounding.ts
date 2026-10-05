// Values in the answer body that must trace to the turn's evidence: on-chain
// addresses (hard) and figures (soft).
import { EVM_ADDRESS_SRC, SOL_ADDRESS_SRC, DOC_NO_CORE } from "../../../lib/patterns.ts";

const EVM_ADDRESSES = new RegExp(EVM_ADDRESS_SRC, "g");
const SOL_ADDRESSES = new RegExp(SOL_ADDRESS_SRC, "g");
const DOC_NOS = new RegExp(String.raw`\b${DOC_NO_CORE}\b`, "g");

// An on-chain address cannot be paraphrased, computed, or converted — it is
// either copied from a tool result or invented. The reader linkifies addresses
// straight to a block explorer, so a wrong one sends the user to the wrong
// contract: this is a HARD failure. EVM matching is case-insensitive (EIP-55
// checksum casing is cosmetic); base58 is case-SENSITIVE and compared exactly.
export function findUngroundedAddresses(answer: string, evidenceTexts: string[]): string[] {
  const hay = evidenceTexts.join("\n");
  const hayLower = hay.toLowerCase();
  const out: string[] = [];
  for (const m of answer.match(EVM_ADDRESSES) ?? []) {
    if (!hayLower.includes(m.toLowerCase())) out.push(m);
  }
  for (const m of answer.match(SOL_ADDRESSES) ?? []) {
    if (!hay.includes(m)) out.push(m);
  }
  return [...new Set(out)];
}

// Figures that appear nowhere in the evidence. Deliberately a SOFT signal, not
// a failure: models legitimately compute (counts, sums), convert units
// (0.5% = 50bps), and cite schema facts that arrive via the system prompt
// rather than a tool result. The verifier — which does see the schema as [E0]
// — adjudicates. Skips ordinals/small counts, doc numbers, and link hrefs.
export const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
export const SMALL_COUNT_MAX = 20;

export function findUntracedNumbers(answer: string, evidenceTexts: string[]): string[] {
  const stripCommas = (s: string) => s.replace(/,(?=\d{3}\b)/g, "");
  // Drop link hrefs (uuids), doc numbers, and code spans before scanning: their
  // digits are identifiers, not claims.
  const prose = stripCommas(
    answer
      .replace(/\]\([^)]*\)/g, "]")
      .replace(DOC_NOS, "")
      .replace(/`[^`]*`/g, ""),
  );
  const hay = stripCommas(evidenceTexts.join("\n"));
  const out: string[] = [];
  for (const m of prose.match(NUMBER_RE) ?? []) {
    const n = Number(m);
    if (!Number.isFinite(n)) continue;
    if (Number.isInteger(n) && Math.abs(n) <= SMALL_COUNT_MAX) continue;
    if (!hay.includes(m)) out.push(m);
  }
  return [...new Set(out)];
}
