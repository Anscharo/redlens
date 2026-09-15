// Pure copy helpers for the preview banner + history panel's diff-base
// descriptions. No React here — see previewMetaCopy.test.ts. `PreviewMeta`
// mirrors the fields the preview UI needs from the server's meta.json shape
// (src/server/preview/cache.ts's PreviewMeta) — the single local type every
// preview component should import instead of hand-rolling its own subset.

export type PreviewBaseKey = "sky" | "repo";

export interface BaseCandidateMeta {
  repo: string;
  ref: string;
  mergeBase: string;
  aheadBy?: number;
  behindBy?: number;
}

export interface BaseDrift {
  sha: string;
  forkPoint?: string;
  commitsAhead?: number;
  commitsBehind?: number;
  docsDiffer?: number;
  vsAtlasCommit: string;
}

export interface PreviewBases {
  auto: PreviewBaseKey | "live-main";
  reason?: string;
  sky?: BaseCandidateMeta;
  repo?: BaseCandidateMeta & { drift?: BaseDrift };
}

export interface PreviewMeta {
  sha?: string;
  repo?: string;
  ref?: string;
  kind?: string;
  prNumber?: number;
  prTitle?: string;
  prAuthor?: string;
  prState?: string;
  headCommitAt?: string;
  forkOwner?: string;
  private?: boolean;
  trustTier?: string;
  // Legacy top-level fork drift (old bundles, sky-only).
  aheadBy?: number;
  behindBy?: number;
  newAddresses?: number;
  addressCheckFailed?: boolean;
  bases?: PreviewBases;
  needsPullsPermission?: boolean;
  permissionsUrl?: string;
}

/** The diff-base actually resolved for this render — see previewDiff.tsx's
 *  `PreviewDiff.activeBase`. `auto` = no `?base=` override, or the override
 *  happens to equal the server's automatic pick. */
export interface ActiveBase {
  key: PreviewBaseKey | "live-main" | null;
  repo?: string;
  ref?: string;
  auto: boolean;
}

export const CANONICAL_MAIN = "sky-ecosystem/next-gen-atlas:main";

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The "· redlined against X · …" segments for the banner, joined by " · ". */
export function baseLine(meta: PreviewMeta, active: ActiveBase | null): string {
  // Fall back to the server's own auto pick (from meta.json, which resolves
  // before the diff does) rather than defaulting straight to the sky/old-
  // bundle branch — otherwise a live-main or repo auto pick renders as sky
  // (or nothing) for the moment before the diff provider's activeBase lands.
  const key = active?.key ?? meta.bases?.auto ?? null;

  if (key === "live-main") {
    const reason = meta.bases?.reason;
    return `redlined against live main${reason ? ` (${reason})` : ""}`;
  }

  if (key === "repo") {
    const repo = meta.bases?.repo;
    if (!repo) return "";
    const segments = [`redlined against ${repo.repo}:${repo.ref}`];
    const drift = repo.drift;
    // A PR against sky main directly makes the repo base identical to sky
    // main — the drift segments would just repeat what the first segment
    // already said, so they're dropped.
    const isCanonical = `${repo.repo}:${repo.ref}` === CANONICAL_MAIN;
    if (drift && !isCanonical) {
      const { commitsAhead: ahead, commitsBehind: behind, docsDiffer } = drift;
      if (ahead === 0 && behind === 0) {
        segments.push(`base is up to date with ${CANONICAL_MAIN}`);
      } else {
        // A stale fork main with no unique commits (ahead === 0, the common
        // case) is just "behind" — "forked 0 commits ago" would be noise.
        if (ahead) segments.push(`base forked from ${CANONICAL_MAIN} ${plural(ahead, "commit")} ago`);
        if (behind !== undefined) segments.push(`${plural(behind, "commit")} behind main`);
      }
      if (docsDiffer !== undefined) segments.push(`${plural(docsDiffer, "doc")} differ${docsDiffer === 1 ? "s" : ""}`);
    }
    return segments.join(" · ");
  }

  // key === "sky", or no resolved base at all (old bundle).
  if (!meta.bases) {
    // Old bundle: exactly today's copy, gated on forkOwner as before.
    if (!meta.forkOwner) return "";
    if (meta.behindBy === 0 && meta.aheadBy === 0) return `up to date with ${CANONICAL_MAIN}`;
    if ((meta.behindBy ?? 0) > 0) return `${meta.behindBy} commits behind main`;
    return "";
  }
  const sky = meta.bases.sky;
  if (!sky) return "";
  if (sky.behindBy === 0 && sky.aheadBy === 0) return `up to date with ${CANONICAL_MAIN}`;
  if ((sky.behindBy ?? 0) > 0) return `${sky.behindBy} commits behind main`;
  return "";
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

/** Banner copy + optional GitHub review-permissions link when a private PR
 *  preview was built without Pull requests: Read. Null when the flag is off. */
export function pullsPermissionCopy(
  meta: Pick<PreviewMeta, "needsPullsPermission" | "permissionsUrl">,
): { body: string; href: string | null; linkLabel: string } | null {
  if (!meta.needsPullsPermission) return null;
  return {
    body: meta.permissionsUrl
      ? "Needs Pull requests: Read to redline this PR against its own base. If you own or administer the install, review the new permission on GitHub, then reload this page. Otherwise ask the person who installed the App."
      : "Needs Pull requests: Read to redline this PR against its own base. Ask the person who installed the App to review the new permission on GitHub, then reload this page.",
    href: meta.permissionsUrl ?? null,
    linkLabel: "Review permissions on GitHub ↗",
  };
}
