// Banner notice copy for install owners: a missing permission and an
// over-broad grant. Pure helpers, no React.
import type { PreviewMeta } from "./previewMetaTypes";

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
