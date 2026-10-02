import { previewKind, type PreviewMeta } from "../../lib/previewMetaCopy";
import { PreviewWarning } from "./PreviewWarning";

// The banner's three risk statements. Each one decides for itself whether it
// has anything to say and renders nothing when it does not.

export interface PreviewRiskProps {
  /** The bundle's meta.json, or null until it arrives. */
  meta: PreviewMeta | null;
}

export function PreviewTrustWarning({ meta }: PreviewRiskProps) {
  if (meta?.trustTier !== "unknown") return null;
  return <PreviewWarning>author has no PRs accepted into the atlas</PreviewWarning>;
}

export function PreviewNewAddressesWarning({ meta }: PreviewRiskProps) {
  const n = meta?.newAddresses ?? 0;
  if (previewKind(meta) === "preview" || n < 1) return null;
  return (
    <PreviewWarning>
      ⚠ {n} new on-chain address{n === 1 ? "" : "es"}
    </PreviewWarning>
  );
}

export function PreviewAddressCheckWarning({ meta }: PreviewRiskProps) {
  // Fails closed: an unreadable map of main must not read as "0 new addresses".
  if (previewKind(meta) === "preview" || !meta?.addressCheckFailed) return null;
  return <PreviewWarning>⚠ couldn't verify new on-chain addresses</PreviewWarning>;
}
