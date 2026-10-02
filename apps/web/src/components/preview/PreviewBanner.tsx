import { useEffect, useState } from "react";
import { useDataSource } from "../../lib/dataSource";
import { previewKind, previewTabTitle, type PreviewMeta } from "../../lib/previewMetaCopy";
import { PreviewExitLink, PreviewSourceLink } from "./PreviewBannerLinks";
import { PreviewBaseSwitchLink, PreviewCompareStatement } from "./PreviewCompare";
import { PreviewKindChip } from "./PreviewKindChip";
import { PreviewNotices, usePreviewNotices } from "./PreviewNotices";
import {
  PreviewAddressCheckWarning,
  PreviewNewAddressesWarning,
  PreviewTrustWarning,
} from "./PreviewRiskWarnings";

// Rendered by the App shell when a preview data source is active. Reads the
// bundle's meta.json once; every statement below derives its own copy from it.

export function PreviewBanner({ onTabTitle }: { onTabTitle?: (title: string | null) => void }) {
  const { base, preview } = useDataSource();
  const [meta, setMeta] = useState<PreviewMeta | null>(null);
  const { notices, dismiss } = usePreviewNotices(meta);
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

  // A notice outranks the fork tint for the header's edge: both are red, and a
  // dismissed notice hands the edge back to the kind it came from.
  const edge = notices.length > 0 || previewKind(meta) === "fork" ? "var(--red)" : "var(--accent)";
  return (
    <div>
      <header
        className="flex items-center gap-3 px-4 py-2 text-sm"
        style={{ background: "var(--hover)", borderBottom: `1px solid ${edge}`, color: "var(--tan)" }}
      >
        <PreviewKindChip meta={meta} />
        <PreviewCompareStatement meta={meta} />
        <PreviewBaseSwitchLink meta={meta} />
        <PreviewTrustWarning meta={meta} />
        <PreviewNewAddressesWarning meta={meta} />
        <PreviewAddressCheckWarning meta={meta} />
        <PreviewSourceLink meta={meta} />
        <PreviewExitLink meta={meta} />
      </header>
      <PreviewNotices notices={notices} repo={meta?.repo} onDismiss={dismiss} />
    </div>
  );
}
