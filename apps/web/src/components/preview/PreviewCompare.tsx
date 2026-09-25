import type { ComponentProps } from "react";
import { useLocation, useSearch } from "wouter";
import { useDataSource } from "../../lib/dataSource";
import { usePreviewDiff } from "../../lib/previewDiff";
import { baseSwitch, compareParts, type PreviewMeta } from "../../lib/previewMetaCopy";
import { Link } from "../Link";

// "Comparing <ref> — <PR title> to <base> · <state>", and the link that swaps
// the base it is compared against. Both read the resolved base themselves, so
// the banner hands them nothing but the bundle's meta.

export type PreviewCompareStatementProps = ComponentProps<"span"> & {
  /** The bundle's meta.json, or null until it arrives. */
  meta: PreviewMeta | null;
};

export function PreviewCompareStatement({ meta, ...props }: PreviewCompareStatementProps) {
  const { preview } = useDataSource();
  const { activeBase } = usePreviewDiff();
  const parts = meta ? compareParts(meta, activeBase ?? null) : null;
  const head = parts?.head ?? "";
  const title = parts?.title ?? "";
  const base = parts?.base ?? "";
  // Neither a ref nor a title (a bare commit bundle, or meta still in flight):
  // name the preview by its id instead.
  const id = head || title ? "" : preview?.id ?? "";
  const state = meta?.prState && meta.prState !== "open" ? meta.prState : "";
  return (
    <span {...props}>
      {"Comparing "}
      {id ? <em className="italic">{id}</em> : null}
      {head ? <em className="italic">{head}</em> : null}
      {head && title ? " — " : null}
      {title ? <strong className="font-semibold">{title}</strong> : null}
      {base ? (
        <>
          {" to "}
          <em className="italic">{base}</em>
        </>
      ) : null}
      {state ? ` · ${state}` : null}
    </span>
  );
}

export type PreviewBaseSwitchLinkProps = Omit<ComponentProps<typeof Link>, "to"> & {
  /** The bundle's meta.json, or null until it arrives. */
  meta: PreviewMeta | null;
};

export function PreviewBaseSwitchLink({ meta, ...props }: PreviewBaseSwitchLinkProps) {
  const [location] = useLocation();
  // wouter's useSearch() strips the leading "?"; URLSearchParams doesn't care.
  const search = useSearch();
  const { activeBase } = usePreviewDiff();
  const link = meta ? baseSwitch(meta, activeBase ?? null, search) : null;
  if (!link) return null;
  // Compose with the current path (relative to the router base) so the switch
  // never navigates away from wherever the user is — a Link's href is
  // router.base + `to`, which would otherwise drop the /atlas (or /reports/…)
  // segment and land back on the bare preview root.
  return (
    <Link to={`${location}${link.href}`} className="mono text-xs" style={{ color: "var(--accent)" }} {...props}>
      {link.label}
    </Link>
  );
}
