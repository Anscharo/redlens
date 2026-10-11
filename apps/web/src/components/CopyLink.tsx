import type { CSSProperties } from "react";
import { useCopyState } from "../hooks/useCopyState";

/**
 * A small "#" in the left gutter beside a linkable part of a page. It holds the
 * part's full link (`data-link`) and is a button, not a link: clicking it copies
 * the link and leaves the page and its URL where they are, the "#" turning to
 * "✓" while copied. It sits beside its heading, never inside, so the heading
 * keeps its own accessible name; its positioned parent must start where the
 * heading does (`.copy-link` in index.css). `top` lines it up with the
 * heading's first line.
 */
export function CopyLink({ id, label, top = 0 }: { id: string; label: string; top?: CSSProperties["top"] }) {
  const { copied, copy } = useCopyState();
  const name = copied ? `Link to ${label} copied` : `Copy link to ${label}`;
  const link = () => `${window.location.origin}${window.location.pathname}${window.location.search}#${id}`;
  return (
    <button type="button" onClick={() => void copy(link())} className="copy-link mono" style={{ top }} aria-label={name} title={name} data-link={`#${id}`} data-copied={copied || undefined}>
      {copied ? "✓" : "#"}
    </button>
  );
}
