// A rate-limit leaf with one line per asset or aggregate,
//   "- AUSD: `maxAmount`: 25,000,000 AUSD, `slope`: 25,000,000 AUSD per day",
// files each line's values with the line's label in brackets after the field:
// "Deposit Rate Limits / maxAmount (AUSD)". The bracket is the asset
// src/lib/pauParams.ts pairs with the RateLimitID naming the same asset
// ("Deposit RateLimitID (AUSD)") or the aggregate ("Aggregate Deposit
// RateLimitID"). The param walk in graph-instances.mjs runs it on every
// bulleted leaf; it reads rate-limit titles only.
import { RATE_LIMITS_TITLE_RE } from "../../src/lib/pauParams.ts";

const LINE_RE = /^\s*[-*]\s+([^`:\n]+?):\s*(`[^`\n]+`\s*:.*?)\s*$/gm;
const PAIR_RE = /^`([^`\n]+)`\s*:\s*(.+)$/;

/** Each "`field`: value" pair of each labelled line, as [`<title> / <field> (<label>)`, value]; commas inside amounts are kept. None under a title that is not a rate limit's. */
export function expandPerToken(content: string, outerTitle: string): [string, string][] {
  const out: [string, string][] = [];
  if (!RATE_LIMITS_TITLE_RE.test(outerTitle)) return out;
  for (const line of content.matchAll(LINE_RE)) {
    for (const pair of line[2].split(/,\s*(?=`)/)) {
      const m = PAIR_RE.exec(pair.trim());
      if (m) out.push([`${outerTitle} / ${m[1].trim()} (${line[1].trim()})`, m[2].trim()]);
    }
  }
  return out;
}
