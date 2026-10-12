// A rate-limit leaf with one line per token or aggregate,
//   "- AUSD: `maxAmount`: 25,000,000 AUSD, `slope`: 25,000,000 AUSD per day",
// files each line's values under the line's label: "AUSD Deposit Rate Limits /
// maxAmount". The label is the qualifier src/lib/pauParams.ts pairs with the
// RateLimitID naming the same token ("Deposit RateLimitID (AUSD)") or the
// aggregate ("Aggregate Deposit RateLimitID"). The param walk in
// graph-instances.mjs applies it under rate-limit titles only.

export const RATE_LIMITS_TITLE_RE = /Rate\s*Limits?$/i;
const LINE_RE = /^\s*[-*]\s+([^`:\n]+?):\s*(`[^`\n]+`\s*:.*?)\s*$/gm;
const PAIR_RE = /^`([^`\n]+)`\s*:\s*(.+)$/;

/** Each "`field`: value" pair of each labelled line, as [`<label> <title> / <field>`, value]; commas inside amounts are kept. */
export function expandPerToken(content: string, outerTitle: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of content.matchAll(LINE_RE)) {
    for (const pair of line[2].split(/,\s*(?=`)/)) {
      const m = PAIR_RE.exec(pair.trim());
      if (m) out.push([`${line[1].trim()} ${outerTitle} / ${m[1].trim()}`, m[2].trim()]);
    }
  }
  return out;
}
