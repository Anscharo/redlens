import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useDataSource } from "../../lib/dataSource";
import { usePreviewDiff } from "../../lib/previewDiff";
import { baseLine, baseSwitch, type PreviewMeta } from "../../lib/previewMetaCopy";
import { Link } from "../Link";

// Rendered by the App shell when a preview data source is active. Reads the
// bundle's meta.json for the PR/branch label + author + state + GitHub source.
const CANONICAL_REPO = "sky-ecosystem/next-gen-atlas";

// Link back to the original source on GitHub (PR / branch / commit).
function sourceUrl(m: PreviewMeta): string {
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

function sourceLabel(m: PreviewMeta): string {
  if (m.kind === "pr" && m.prNumber) return "view PR on GitHub ↗";
  if (m.prNumber || /^pull-\d+$/.test(m.ref ?? "")) return "view PR on GitHub ↗";
  if (m.kind === "branch") return "view branch ↗";
  return "view commit ↗";
}

export function PreviewBanner() {
  const { base, preview } = useDataSource();
  const { activeBase } = usePreviewDiff();
  const [location] = useLocation();
  const search = useSearch();
  const [meta, setMeta] = useState<PreviewMeta | null>(null);
  useEffect(() => {
    if (!preview) return;
    fetch(`${base}meta.json`)
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => {});
  }, [base, preview]);
  if (!preview) return null;

  // forkOwner is only set by the server for true fork previews — a PR whose
  // head lives on a fork is still a PR preview, not a fork preview. Private
  // previews never set forkOwner (the server doesn't compute fork lineage for
  // them), so isFork is already false there — private just takes precedence
  // in the chip/label.
  const isFork = !!meta?.forkOwner;
  const isPrivate = !!meta?.private;
  const label = meta?.prTitle ? `${meta.ref} — ${meta.prTitle}` : meta?.ref ?? preview.id;
  const src = meta ? sourceUrl(meta) : null;
  const srcLabel = meta ? sourceLabel(meta) : "view commit ↗";
  const line = meta ? baseLine(meta, activeBase ?? null) : "";
  // wouter's useSearch() strips the leading "?"; URLSearchParams doesn't care.
  const switchLink = meta ? baseSwitch(meta, activeBase ?? null, search) : null;
  return (
    <header
      className="flex items-center gap-3 px-4 py-2 text-sm"
      style={{
        background: "var(--hover)",
        borderBottom: `1px solid ${isFork ? "var(--red)" : "var(--accent)"}`,
        color: "var(--tan)",
      }}
    >
      <span style={{ color: isFork ? "var(--red)" : "var(--accent)", fontWeight: 600, letterSpacing: "0.05em" }}>
        {isPrivate ? "PRIVATE PREVIEW" : isFork ? "FORK PREVIEW" : "PREVIEW"}
      </span>
      <span>
        Viewing {isPrivate ? "a private preview of" : isFork ? "unreviewed fork" : "preview"}{" "}
        {src ? (
          <a href={src} target="_blank" rel="noreferrer" style={{ color: "var(--tan)", textDecoration: "underline" }}>
            <strong>{label}</strong>
          </a>
        ) : (
          <strong>{label}</strong>
        )}
        {isFork ? ` · by ${meta!.forkOwner ?? meta!.repo!.split("/")[0]}` : ""}
        {meta?.prAuthor ? ` · proposed by ${meta.prAuthor}` : ""}
        {meta?.prState && meta.prState !== "open" ? ` · ${meta.prState}` : ""}
        {line ? ` · ${line}` : ""}
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
        <a href={src} target="_blank" rel="noreferrer" className="ml-auto" style={{ color: "var(--accent)" }}>
          {srcLabel}
        </a>
      )}
      <a href={import.meta.env.BASE_URL} className={src ? "" : "ml-auto"} style={{ color: "var(--accent)" }}>
        exit preview
      </a>
    </header>
  );
}
