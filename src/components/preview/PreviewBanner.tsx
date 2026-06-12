import { useEffect, useState } from "react";
import { useDataSource } from "../../lib/dataSource";

// Rendered by the App shell when a preview data source is active. Reads the
// bundle's meta.json for the PR/branch label + author + state + GitHub source.
interface PreviewMeta {
  sha: string;
  repo: string;
  ref: string;
  kind: string;
  prNumber?: number;
  prTitle?: string;
  prAuthor?: string;
  prState?: string;
  forkOwner?: string;
  trustTier?: string;
  behindBy?: number;
  newAddresses?: number;
  diffTruncated?: boolean;
}

const CANONICAL_REPO = "sky-ecosystem/next-gen-atlas";

// Link back to the original source on GitHub (PR / branch / commit).
function sourceUrl(m: PreviewMeta): string {
  if (m.kind === "pr" && m.prNumber) return `https://github.com/${CANONICAL_REPO}/pull/${m.prNumber}`;
  if (m.kind === "branch") return `https://github.com/${m.repo}/tree/${m.ref}`;
  return `https://github.com/${m.repo}/commit/${m.sha}`;
}

export function PreviewBanner() {
  const { base, preview } = useDataSource();
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
  // head lives on a fork is still a PR preview, not a fork preview.
  const isFork = !!meta?.forkOwner;
  const label = meta?.prTitle ? `${meta.ref} — ${meta.prTitle}` : meta?.ref ?? preview.id;
  const src = meta ? sourceUrl(meta) : null;
  const srcLabel = meta?.kind === "pr" ? "view PR on GitHub ↗" : meta?.kind === "branch" ? "view branch ↗" : "view commit ↗";
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
        {isFork ? "FORK PREVIEW" : "PREVIEW"}
      </span>
      <span>
        Viewing {isFork ? "unreviewed fork" : "preview"}{" "}
        {src ? (
          <a href={src} target="_blank" rel="noreferrer" style={{ color: "var(--tan)", textDecoration: "underline" }}>
            <strong>{label}</strong>
          </a>
        ) : (
          <strong>{label}</strong>
        )}
        {isFork ? ` · by ${meta!.forkOwner ?? meta!.repo.split("/")[0]}` : ""}
        {meta?.prAuthor ? ` · proposed by ${meta.prAuthor}` : ""}
        {meta?.prState && meta.prState !== "open" ? ` · ${meta.prState}` : ""}
        {isFork && meta!.behindBy === 0 && meta!.aheadBy === 0
          ? " · up to date with sky-ecosystem/next-gen-atlas:main"
          : ""}
        {isFork && (meta!.behindBy ?? 0) > 0 ? ` · ${meta!.behindBy} commits behind main` : ""}
      </span>
      {meta?.trustTier === "unknown" && (
        <span className="mono text-xs" style={{ color: "var(--red)" }}>
          author has no PRs accepted into the atlas
        </span>
      )}
      {isFork && (meta!.newAddresses ?? 0) > 0 && (
        <span className="mono text-xs" style={{ color: "var(--red)" }}>
          ⚠ {meta!.newAddresses} new on-chain address{meta!.newAddresses === 1 ? "" : "es"}
        </span>
      )}
      {isFork && meta!.diffTruncated && (
        <span className="mono text-xs" style={{ color: "var(--tan-3)" }}>
          change markers may be incomplete
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
