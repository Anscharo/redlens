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

/** Pieces of the banner sentence "Comparing HEAD — TITLE to BASE by USER".
 *  Empty strings are omitted by `compareLine`. Drift ("N docs differ", commits
 *  behind main) is intentionally absent: `docsDiffer` counts the base tip
 *  against the live atlas, not the redlines this preview renders. */
export interface CompareParts {
  subject: string;
  base: string;
  user: string;
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
  const user = meta.prAuthor?.trim() || meta.forkOwner?.trim() || "";
  return { subject, base: compareBase(meta, active), user };
}

/** "Comparing HEAD — TITLE to BASE by USER", dropping any piece that is missing. */
export function compareLine(meta: PreviewMeta, active: ActiveBase | null): string {
  const { subject, base, user } = compareParts(meta, active);
  if (!subject && !base && !user) return "";
  let line = subject ? `Comparing ${subject}` : "Comparing";
  if (base) line += ` to ${base}`;
  if (user) line += ` by ${user}`;
  return line;
}

const CANONICAL_REPO = "sky-ecosystem/next-gen-atlas";

/** Link back to the original source on GitHub (PR / branch / commit). */
export function sourceUrl(m: PreviewMeta): string {
  // Public canonical PRs live on sky-ecosystem/next-gen-atlas even when the
  // head repo is a fork. Private `owner:repo:pull-N` previews keep kind
  // "branch" (so the pr-state worker doesn't confuse them with canonical
  // PR numbers) but still link back to the private repo's PR.
  if (m.kind === "pr" && m.prNumber) return `https://github.com/${CANONICAL_REPO}/pull/${m.prNumber}`;
  if (m.prNumber) return `https://github.com/${m.repo}/pull/${m.prNumber}`;
  const pull = m.ref?.match(/^pull-(\d+)$/);
  if (pull) return `https://github.com/${m.repo}/pull/${pull[1]}`;
  if (m.kind === "branch") return `https://github.com/${m.repo}/tree/${m.ref}`;
  return `https://github.com/${m.repo}/commit/${m.sha}`;
}

export function sourceLabel(m: PreviewMeta): string {
  const pull = m.ref?.match(/^pull-(\d+)$/);
  const n = m.prNumber ?? (pull ? Number(pull[1]) : undefined);
  if (n != null && (m.kind === "pr" || m.prNumber != null || pull)) return `view PR #${n} on GitHub ↗`;
  if (m.kind === "branch") return "view branch ↗";
  return "view commit ↗";
}

const ACCESS_DISMISS_KEY = "sabr-preview-access-dismissed";

/** Repos whose ACCESS notice this browser has dismissed. localStorage, so it
 *  survives reloads on this machine. */
export function readDismissedAccessRepos(): Set<string> {
  try {
    const raw = localStorage.getItem(ACCESS_DISMISS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { repos?: unknown };
    if (!Array.isArray(parsed?.repos)) return new Set();
    return new Set(parsed.repos.filter((r): r is string => typeof r === "string"));
  } catch {
    return new Set();
  }
}

export function dismissAccessRepo(repo: string): void {
  try {
    const repos = readDismissedAccessRepos();
    repos.add(repo);
    localStorage.setItem(ACCESS_DISMISS_KEY, JSON.stringify({ v: 1, repos: [...repos] }));
  } catch {
    // private mode / quota — the in-memory hide still lasts this view
  }
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
export interface BannerNotice {
  /** Short uppercase tag rendered before the body (e.g. "PERMISSION"). */
  label: string;
  body: string;
  href: string | null;
  linkLabel: string;
}

export function pullsPermissionCopy(
  meta: Pick<PreviewMeta, "needsPullsPermission" | "permissionsUrl">,
): BannerNotice | null {
  if (!meta.needsPullsPermission) return null;
  return {
    label: "PERMISSION",
    body: meta.permissionsUrl
      ? "Needs Pull requests: Read to redline this PR against its own base. If you own or administer the install, review the new permission on GitHub, then reload this page. Otherwise ask the person who installed the App."
      : "Needs Pull requests: Read to redline this PR against its own base. Ask the person who installed the App to review the new permission on GitHub, then reload this page.",
    href: meta.permissionsUrl ?? null,
    linkLabel: "Review permissions on GitHub ↗",
  };
}

/** Banner copy + optional GitHub install-settings link when the install this
 *  private preview rode was granted "All repositories" instead of just this
 *  repo. The App can't pre-select a private repo on the install screen, so an
 *  over-broad grant is caught here and handed to the person who can narrow it.
 *  Null when the flag is off. */
export function broadGrantCopy(
  meta: Pick<PreviewMeta, "repo" | "grantTooBroad" | "installSettingsUrl">,
): BannerNotice | null {
  if (!meta.grantTooBroad) return null;
  const lead = `The Sky Atlas by Redline GitHub App was granted every repository on this account; it only needs ${meta.repo}.`;
  return {
    label: "ACCESS",
    body: meta.installSettingsUrl
      ? `${lead} If you own or administer the install, change its repository access to that one repo on GitHub. Otherwise ask the person who installed the App.`
      : `${lead} Ask the person who installed the App to change its repository access to that one repo on GitHub.`,
    href: meta.installSettingsUrl ?? null,
    linkLabel: "Narrow repository access on GitHub ↗",
  };
}
