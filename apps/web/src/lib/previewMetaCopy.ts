// Pure copy helpers for the preview banner + history panel's diff-base
// descriptions. No React here — see previewMetaCopy.test.ts. The types live in
// previewMetaTypes.ts, the install-owner notices in previewNoticeCopy.ts and the
// dismissed-repo storage in previewAccessDismissed.ts; this module re-exports
// all three so importers keep one path.
import type { ActiveBase, CompareParts, PreviewBaseKey, PreviewMeta } from "./previewMetaTypes";

export type {
  ActiveBase,
  BaseCandidateMeta,
  BaseDrift,
  CompareParts,
  PreviewBaseKey,
  PreviewBases,
  PreviewMeta,
} from "./previewMetaTypes";
export { broadGrantCopy, pullsPermissionCopy, type BannerNotice } from "./previewNoticeCopy";
export { dismissAccessRepo, readDismissedAccessRepos } from "./previewAccessDismissed";

/** The PR number digits in a `pull-N` ref (a Contents-only private PR), else null. */
function pullRefDigits(ref: string | undefined): string | null {
  return ref?.match(/^pull-(\d+)$/)?.[1] ?? null;
}

function compareBase(meta: PreviewMeta, active: ActiveBase | null): string {
  // Fall back to meta.bases.auto before the diff provider's activeBase lands,
  // so the named base doesn't flicker in a beat later.
  const key = active?.key ?? meta.bases?.auto ?? null;
  if (key === "live-main") return "live main";
  if (key !== "repo" && key !== "sky") return "";
  const cand =
    active?.key === key && active.repo && active.ref
      ? { repo: active.repo, ref: active.ref }
      : meta.bases?.[key];
  if (!cand?.repo || !cand.ref) return "";
  return `${cand.repo}:${cand.ref}`;
}

export function compareParts(meta: PreviewMeta, active: ActiveBase | null): CompareParts {
  const head = meta.ref?.trim() || "";
  const title = meta.prTitle?.trim() || "";
  const subject = head && title ? `${head} — ${title}` : head || title;
  return { head, title, subject, base: compareBase(meta, active) };
}

/** Which treatment the banner wears. `forkOwner` is only set by the server for
 *  true fork previews — a PR whose head lives on a fork is still a PR preview,
 *  not a fork preview. Private previews never set `forkOwner` (the server
 *  doesn't compute fork lineage for them), so "private" simply wins here. */
export type PreviewKind = "preview" | "fork" | "private";

export function previewKind(meta: PreviewMeta | null): PreviewKind {
  if (meta?.private) return "private";
  if (meta?.forkOwner) return "fork";
  return "preview";
}

/** Browser tab while a preview is open.
 *  A pull request: "PR 88 preview on Redline Portal -- feat/x — Title".
 *  Anything else: "Preview feat/x on Redline Portal".
 *  Null only before meta arrives, so the open document keeps the tab until then. */
export function previewTabTitle(meta: PreviewMeta | null): string | null {
  if (!meta) return null;
  const pull = pullRefDigits(meta.ref);
  const n = meta.prNumber ?? (pull !== null ? Number(pull) : undefined);
  if (n != null) {
    const branch = meta.ref && pull === null ? meta.ref : "";
    const info = [branch, meta.prTitle?.trim() || ""].filter(Boolean).join(" — ");
    return info ? `PR ${n} preview on Redline Portal -- ${info}` : `PR ${n} preview on Redline Portal`;
  }
  const branch = meta.ref?.trim() || (meta.sha ? meta.sha.slice(0, 7) : "");
  return branch ? `Preview ${branch} on Redline Portal` : null;
}

/** "Comparing HEAD — TITLE to BASE", dropping any piece that is missing. */
export function compareLine(meta: PreviewMeta, active: ActiveBase | null): string {
  const { subject, base } = compareParts(meta, active);
  if (!subject && !base) return "";
  let line = subject ? `Comparing ${subject}` : "Comparing";
  if (base) line += ` to ${base}`;
  return line;
}

export const CANONICAL_REPO = "sky-ecosystem/next-gen-atlas";

/** Link back to the original source on GitHub (PR / branch / commit). */
export function sourceUrl(m: PreviewMeta): string {
  // Public canonical PRs live on sky-ecosystem/next-gen-atlas even when the
  // head repo is a fork. Private `owner:repo:pull-N` previews keep kind
  // "branch" (so the pr-state worker doesn't confuse them with canonical
  // PR numbers) but still link back to the private repo's PR.
  if (m.kind === "pr" && m.prNumber) return `https://github.com/${CANONICAL_REPO}/pull/${m.prNumber}`;
  if (m.prNumber) return `https://github.com/${m.repo}/pull/${m.prNumber}`;
  const pull = pullRefDigits(m.ref);
  if (pull !== null) return `https://github.com/${m.repo}/pull/${pull}`;
  if (m.kind === "branch") return `https://github.com/${m.repo}/tree/${m.ref}`;
  return `https://github.com/${m.repo}/commit/${m.sha}`;
}

export function sourceLabel(m: PreviewMeta): string {
  const pull = pullRefDigits(m.ref);
  const n = m.prNumber ?? (pull !== null ? Number(pull) : undefined);
  if (n != null && (m.kind === "pr" || m.prNumber != null || pull !== null)) return `view PR ${n}`;
  if (m.kind === "branch") return "view branch";
  return "view commit";
}

/** Link target + label for the switch, or null when there is only one candidate. */
export function baseSwitch(
  meta: PreviewMeta,
  active: ActiveBase | null,
  currentSearch: string,
): { href: string; label: string } | null {
  const sky = meta.bases?.sky;
  const repo = meta.bases?.repo;
  if (!sky || !repo) return null;

  const params = new URLSearchParams(currentSearch);
  const autoKey = meta.bases!.auto;
  const auto = active?.auto ?? true;

  if (auto) {
    const other: PreviewBaseKey = autoKey === "sky" ? "repo" : "sky";
    const otherMeta = other === "sky" ? sky : repo;
    params.set("base", other);
    const qs = params.toString();
    return { href: qs ? `?${qs}` : "?", label: `compare against ${otherMeta.repo}:${otherMeta.ref} instead` };
  }

  // Forced override: link back to the automatic pick.
  params.delete("base");
  const autoMeta = autoKey === "sky" ? sky : autoKey === "repo" ? repo : null;
  const qs = params.toString();
  const label = autoMeta ? `back to ${autoMeta.repo}:${autoMeta.ref}` : "back to auto";
  return { href: qs ? `?${qs}` : "?", label };
}

/** Heading label for the history panel's "compared against" side. */
export function diffBaseLabel(meta: PreviewMeta, active: ActiveBase | null): string {
  if (active?.key === "repo" && meta.bases?.repo) {
    const { repo, ref } = meta.bases.repo;
    return `${repo}:${ref}`;
  }
  return "the live atlas";
}
