// Types for the preview banner and history panel copy. `PreviewMeta` mirrors
// the fields the preview UI needs from the server's meta.json shape
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
  grantTooBroad?: boolean;
  installSettingsUrl?: string;
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

/** Pieces of the banner sentence "Comparing HEAD — TITLE to BASE".
 *  Empty strings are omitted by `compareLine`. The author is not part of the
 *  sentence. Drift ("N docs differ", commits behind main) is intentionally
 *  absent: `docsDiffer` counts the base tip against the live atlas, not the
 *  redlines this preview renders. */
export interface CompareParts {
  /** The head ref — a branch name, or `pull-N` for a Contents-only private PR. */
  head: string;
  /** The PR title, when the bundle carries one. */
  title: string;
  /** "HEAD — TITLE", for the consumers that need one plain string. */
  subject: string;
  base: string;
}
