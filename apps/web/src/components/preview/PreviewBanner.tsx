import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useDataSource } from "../../lib/dataSource";
import { usePreviewDiff } from "../../lib/previewDiff";
import {
  baseSwitch,
  broadGrantCopy,
  compareParts,
  dismissAccessRepo,
  pullsPermissionCopy,
  previewTabTitle,
  readDismissedAccessRepos,
  sourceLabel,
  sourceUrl,
  type BannerNotice,
  type PreviewMeta,
} from "../../lib/previewMetaCopy";
import { GitHubMark } from "../chat/glyphs";
import { Link } from "../Link";

// Rendered by the App shell when a preview data source is active. Reads the
// bundle's meta.json for the PR/branch label + author + state + GitHub source.

export function PreviewBanner({ onTabTitle }: { onTabTitle?: (title: string | null) => void }) {
  const { base, preview } = useDataSource();
  const { activeBase } = usePreviewDiff();
  const [location] = useLocation();
  const search = useSearch();
  const [meta, setMeta] = useState<PreviewMeta | null>(null);
  const [hiddenAccess, setHiddenAccess] = useState<ReadonlySet<string>>(() => readDismissedAccessRepos());
  useEffect(() => {
    if (!preview) return;
    fetch(`${base}meta.json`)
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => {});
  }, [base, preview]);
  useEffect(() => {
    onTabTitle?.(preview ? previewTabTitle(meta) : null);
    return () => onTabTitle?.(null);
  }, [preview, meta, onTabTitle]);
  if (!preview) return null;

  // forkOwner is only set by the server for true fork previews — a PR whose
  // head lives on a fork is still a PR preview, not a fork preview. Private
  // previews never set forkOwner (the server doesn't compute fork lineage for
  // them), so isFork is already false there — private just takes precedence
  // in the chip/label.
  const isFork = !!meta?.forkOwner;
  const isPrivate = !!meta?.private;
  const parts = meta ? compareParts(meta, activeBase ?? null) : null;
  const subject = parts?.subject || preview.id;
  const src = meta ? sourceUrl(meta) : null;
  const srcLabel = meta ? sourceLabel(meta) : "view commit";
  // wouter's useSearch() strips the leading "?"; URLSearchParams doesn't care.
  const switchLink = meta ? baseSwitch(meta, activeBase ?? null, search) : null;
  // Install-owner nudges, one row each: a missing permission, an over-broad grant.
  // A dismissed ACCESS row stays hidden on this machine (localStorage).
  const notices = (meta ? [pullsPermissionCopy(meta), broadGrantCopy(meta)] : []).filter(
    (n): n is BannerNotice => n !== null && !(n.label === "ACCESS" && !!meta?.repo && hiddenAccess.has(meta.repo)),
  );
  const perm = notices.length > 0;
  return (
    <div>
    <header
      className="flex items-center gap-3 px-4 py-2 text-sm"
      style={{
        background: "var(--hover)",
        borderBottom: `1px solid ${perm ? "var(--red)" : isFork ? "var(--red)" : "var(--accent)"}`,
        color: "var(--tan)",
      }}
    >
      <span style={{ color: isFork ? "var(--red)" : "var(--accent)", fontWeight: 600, letterSpacing: "0.05em" }}>
        {isPrivate ? "PRIVATE PREVIEW" : isFork ? "FORK PREVIEW" : "PREVIEW"}
      </span>
      <span>
        {`Comparing ${subject}${parts?.base ? ` to ${<strong>{parts.base}</strong>}` : ""}${
          meta?.prState && meta.prState !== "open" ? ` · ${meta.prState}` : ""
        }`}
      </span>
      {switchLink && (
        // Compose with the current path (relative to the router base) so the
        // switch never navigates away from wherever the user is — a Link's
        // href is router.base + `to`, which would otherwise drop the /atlas
        // (or /reports/…) segment and land back on the bare preview root.
        <Link to={`${location}${switchLink.href}`} className="mono text-xs" style={{ color: "var(--accent)" }}>
          {switchLink.label}
        </Link>
      )}
      {meta?.trustTier === "unknown" && (
        <span className="mono text-xs" style={{ color: "var(--red)" }}>
          author has no PRs accepted into the atlas
        </span>
      )}
      {(isFork || isPrivate) && (meta!.newAddresses ?? 0) > 0 && (
        <span className="mono text-xs" style={{ color: "var(--red)" }}>
          ⚠ {meta!.newAddresses} new on-chain address{meta!.newAddresses === 1 ? "" : "es"}
        </span>
      )}
      {(isFork || isPrivate) && meta!.addressCheckFailed && (
        <span className="mono text-xs" style={{ color: "var(--red)" }}>
          ⚠ couldn't verify new on-chain addresses
        </span>
      )}
      {src && (
        <a href={src} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
          {srcLabel} <GitHubMark size={14} />
        </a>
      )}
      <a href={import.meta.env.BASE_URL} className={src ? "" : "ml-auto"} style={{ color: "var(--accent)" }}>
        exit
      </a>
    </header>
    {notices.map((n) => (
      <p
        key={n.label}
        className="flex items-center gap-3 px-4 py-2 text-sm"
        style={{ background: "var(--hover)", borderBottom: "1px solid var(--red)", color: "var(--tan)" }}
      >
        <span style={{ color: "var(--red)", fontWeight: 600, letterSpacing: "0.05em" }}>{n.label}</span>
        <span>{n.body}</span>
        <span className="ml-auto flex items-center gap-3">
          {n.href ? (
            <a href={n.href} target="_blank" rel="noreferrer" style={{ color: "var(--red)" }}>
              {n.linkLabel}
            </a>
          ) : null}
          {n.label === "ACCESS" && meta?.repo ? (
            <button
              type="button"
              onClick={() => {
                const repo = meta.repo!;
                dismissAccessRepo(repo);
                setHiddenAccess((prev) => new Set(prev).add(repo));
              }}
              style={{ color: "var(--red)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              Dismiss
            </button>
          ) : null}
        </span>
      </p>
    ))}
    </div>
  );
}
