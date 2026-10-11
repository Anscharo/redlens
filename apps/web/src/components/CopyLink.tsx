import type { CSSProperties } from "react";
import { useCopyState } from "../hooks/useCopyState";

/**
 * A small "#" in the left gutter beside a linkable part of a page. Following it
 * moves the URL to that part's fragment and copies the full link, the "#"
 * turning to "✓" while copied. It sits beside its heading, never inside, so the
 * heading keeps its own accessible name; its positioned parent must start where
 * the heading does (`.copy-link` in index.css). `top` lines it up with the
 * heading's first line.
 */
export function CopyLink({ id, label, top = 0 }: { id: string; label: string; top?: CSSProperties["top"] }) {
  const { copied, copy } = useCopyState();
  const name = copied ? `Link to ${label} copied` : `Copy link to ${label}`;
  const onClick = () => void copy(`${window.location.origin}${window.location.pathname}${window.location.search}#${id}`);
  return (
    <a href={`#${id}`} onClick={onClick} className="copy-link mono" style={{ top }} aria-label={name} title={name} data-copied={copied || undefined}>
      {copied ? "✓" : "#"}
    </a>
  );
}
