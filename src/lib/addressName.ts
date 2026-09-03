// Canonical, app-wide resolution of an address's display NAME and OWNER.
// Pure and dependency-free so both the frontend (apps/web) and the server
// (retrieval/doc-rows) share one rule instead of the three that had drifted.
//
// Two distinct fields, never conflated:
//   - NAME  — an authoritative identifier: the chainlog id, else the verified
//             on-chain contract name. `entityLabel` is NEVER a name. The
//             address-aware wrapper (apps/web/src/lib/addressName) falls back to
//             a shortened address when neither exists.
//   - OWNER — secondary context: the atlas-derived `entityLabel`, but only when
//             it passes the quality filter (isCleanLabel).

export interface NameFields {
  chainlogId?: string | null;
  etherscanName?: string | null;
  entityLabel?: string | null;
}

// Function words that, at the very end of a phrase, mark it as a dangling prose
// fragment rather than a name ("…into WETH. It", "…Pause Proxy. The").
const TRAILING_PROSE =
  /\b(it|its|the|this|that|these|those|a|an|and|or|of|to|for|from|into|via|with|through|is|are|be|as|at|by|on|in)$/i;

/**
 * True when `label` looks like a real name rather than a scraped prose fragment.
 *
 * `entityLabel` is produced by a build-time heuristic
 * (scripts/lib/address-annotate.mjs) that grabs text near the address; a sizeable
 * share of the time it returns a sentence fragment ("ALM Proxy's entire native
 * ETH balance into WETH. It") instead of a name. Until the pipeline defect is
 * fixed (docs/plans/entitylabel-fragment-defect.md), this guard keeps fragments
 * off every user-facing surface AND out of the DB label written for chat.
 *
 * Deliberately conservative and cheap: a *false reject* only downgrades the name
 * to the address itself, which is honest; a *false accept* puts a garbage phrase
 * on screen. So the signals favour rejecting anything prose-shaped.
 */
export function isCleanLabel(label: string | null | undefined): label is string {
  if (!label) return false;
  const s = label.trim();
  if (s.length < 3 || s.length > 48) return false; // too short to mean anything / too long to be a name
  if (/[.?!]["')\]]?\s/.test(s)) return false; // an internal sentence break — the strongest fragment tell
  if (/^[a-z]/.test(s)) return false; // names are Title-Cased or all-caps; prose fragments start lowercase
  if (TRAILING_PROSE.test(s)) return false; // ends on a dangling function word
  return true;
}

/** The authoritative name, or null when there is no chainlog id / verified name. */
export function resolveName(info: NameFields | null | undefined): string | null {
  return info?.chainlogId ?? info?.etherscanName ?? null;
}

/** True when a real identifier exists (vs. having to fall back to the address). */
export function hasResolvedName(info: NameFields | null | undefined): boolean {
  return resolveName(info) !== null;
}

/** The secondary "owner" context (quality-filtered entityLabel), or null. */
export function resolveOwner(info: NameFields | null | undefined): string | null {
  return isCleanLabel(info?.entityLabel) ? info!.entityLabel!.trim() : null;
}
