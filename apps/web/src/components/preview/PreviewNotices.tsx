import { useState, type ComponentProps } from "react";
import {
  broadGrantCopy,
  dismissAccessRepo,
  pullsPermissionCopy,
  readDismissedAccessRepos,
  type BannerNotice,
  type PreviewMeta,
} from "../../lib/previewMetaCopy";

// Install-owner nudges under the banner, one row each: a missing permission, an
// over-broad grant. A dismissed ACCESS row stays hidden on this machine
// (localStorage).

/** The notices this browser should see, plus the ACCESS dismissal. The banner
 *  shell calls it as well — its header turns red while any notice is up — so
 *  the hidden set has one owner and a dismissal moves both at once. */
export function usePreviewNotices(meta: PreviewMeta | null) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(readDismissedAccessRepos);
  const notices = (meta ? [pullsPermissionCopy(meta), broadGrantCopy(meta)] : []).filter(
    (n): n is BannerNotice => n !== null && !(n.label === "ACCESS" && !!meta?.repo && hidden.has(meta.repo)),
  );
  const dismiss = (repo: string) => {
    dismissAccessRepo(repo);
    setHidden((prev) => new Set(prev).add(repo));
  };
  return { notices, dismiss };
}

export type PreviewNoticesProps = ComponentProps<"div"> & {
  /** Rows to show, from `usePreviewNotices`. */
  notices: readonly BannerNotice[];
  /** Repo the ACCESS row is dismissed for; omit to drop the Dismiss button. */
  repo?: string;
  /** Called with that repo when the reader dismisses the ACCESS row. */
  onDismiss?: (repo: string) => void;
};

export function PreviewNotices({ notices, repo, onDismiss, ...props }: PreviewNoticesProps) {
  if (notices.length === 0) return null;
  return (
    <div {...props}>
      {notices.map((n) => (
        <PreviewNotice key={n.label} notice={n} repo={repo} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

export type PreviewNoticeProps = ComponentProps<"p"> & {
  /** Copy for this row, from `pullsPermissionCopy` / `broadGrantCopy`. */
  notice: BannerNotice;
  /** Repo the ACCESS row is dismissed for; omit to drop the Dismiss button. */
  repo?: string;
  /** Called with that repo when the reader dismisses the ACCESS row. */
  onDismiss?: (repo: string) => void;
};

export function PreviewNotice({ notice, repo, onDismiss, ...props }: PreviewNoticeProps) {
  return (
    <p
      className="flex items-center gap-3 px-4 py-2 text-sm"
      style={{ background: "var(--hover)", borderBottom: "1px solid var(--red)", color: "var(--tan)" }}
      {...props}
    >
      <span style={{ color: "var(--red)", fontWeight: 600, letterSpacing: "0.05em" }}>{notice.label}</span>
      <span>{notice.body}</span>
      <span className="ml-auto flex items-center gap-3">
        {notice.href ? (
          <a href={notice.href} target="_blank" rel="noreferrer" style={{ color: "var(--red)" }}>
            {notice.linkLabel}
          </a>
        ) : null}
        {notice.label === "ACCESS" && repo && onDismiss ? (
          <button
            type="button"
            onClick={() => onDismiss(repo)}
            style={{ color: "var(--red)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            Dismiss
          </button>
        ) : null}
      </span>
    </p>
  );
}
