import type { ComponentProps } from "react";
import { previewKind, type PreviewMeta } from "../../lib/previewMetaCopy";

// The tag the preview banner opens with. Reads the treatment off the bundle's
// meta itself, so no caller has to re-derive fork-vs-private.

const LABEL = { preview: "PREVIEW", fork: "FORK PREVIEW", private: "PRIVATE PREVIEW" } as const;

export type PreviewKindChipProps = ComponentProps<"span"> & {
  /** The bundle's meta.json, or null until it arrives. */
  meta: PreviewMeta | null;
};

export function PreviewKindChip({ meta, ...props }: PreviewKindChipProps) {
  const kind = previewKind(meta);
  return (
    <span
      data-state={kind}
      style={{ color: kind === "fork" ? "var(--red)" : "var(--accent)", fontWeight: 600, letterSpacing: "0.05em" }}
      {...props}
    >
      {LABEL[kind]}
    </span>
  );
}
