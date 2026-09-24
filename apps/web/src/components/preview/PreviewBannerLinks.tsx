import type { ComponentProps } from "react";
import { sourceLabel, sourceUrl, type PreviewMeta } from "../../lib/previewMetaCopy";
import { GitHubMark } from "../chat/glyphs";

// The two links that close the banner row: back to the PR/branch/commit on
// GitHub, and out of preview mode.

export type PreviewSourceLinkProps = Omit<ComponentProps<"a">, "href"> & {
  /** The bundle's meta.json. The link is absent until it arrives. */
  meta: PreviewMeta | null;
};

export function PreviewSourceLink({ meta, ...props }: PreviewSourceLinkProps) {
  if (!meta) return null;
  return (
    <a
      href={sourceUrl(meta)}
      target="_blank"
      rel="noreferrer"
      className="ml-auto inline-flex items-center gap-1"
      style={{ color: "var(--accent)" }}
      {...props}
    >
      {sourceLabel(meta)} <GitHubMark size={14} />
    </a>
  );
}

export type PreviewExitLinkProps = Omit<ComponentProps<"a">, "href"> & {
  /** The same meta the source link reads: while it is null that link is absent,
   *  so this one takes over the push to the right edge. */
  meta: PreviewMeta | null;
};

export function PreviewExitLink({ meta, ...props }: PreviewExitLinkProps) {
  return (
    <a href={import.meta.env.BASE_URL} className={meta ? "" : "ml-auto"} style={{ color: "var(--accent)" }} {...props}>
      exit
    </a>
  );
}
