import type { UrlCodec } from "../../hooks/useUrlState";

// Single-select category filter for the responsibility reports. Lives in its
// own URL param (`cat`) so it composes with the entity filter (`filter`) —
// e.g. only Operational Facilitator duties held by Endgame Edge.
export const categoryCodec = <T extends string>(labels: Record<T, string>): UrlCodec<T | null> => ({
  encode: (v) => v,
  decode: (raw) => (raw !== null && raw in labels ? (raw as T) : null),
});

export function CategoryPills<T extends string>({
  categories,
  active,
  onToggle,
  label = "Category",
  labelTitle,
  display,
  counts,
  hint,
  showSingle = false,
}: {
  categories: readonly T[];
  /** Single-select (T | null) or multi-select (readonly T[]) active state. */
  active: T | readonly T[] | null;
  onToggle: (next: T) => void;
  label?: string;
  /** Tooltip on the group label explaining what the dimension means. */
  labelTitle?: string;
  /** Pill text per key (defaults to the key itself). */
  display?: Partial<Record<T, string>>;
  /** Muted per-pill count, shown after the pill text. */
  counts?: Partial<Record<T, number>>;
  /** Muted trailing hint, e.g. a scale legend. Takes a node, not just a string,
   *  so a legend can mark up a glyph (the → in a range hint is `.enlargen`). */
  hint?: React.ReactNode;
  /** Render a one-option group too. A single pill is noise for a fixed facet
   *  (a rating scale with one value present), but a data-derived facet — the
   *  chains or scopes actually in this atlas — must stay filterable even when
   *  today's data has exactly one. Off by default. */
  showSingle?: boolean;
}) {
  if (categories.length < (showSingle ? 1 : 2)) return null;
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span
        className={`text-xs text-tan-3 mr-1${labelTitle ? " cursor-pointer underline decoration-dotted decoration-[var(--tan-3)] underline-offset-2" : ""}`}
        title={labelTitle}
      >
        {label}:
      </span>
      {categories.map((c) => {
        const isMulti = Array.isArray(active);
        const isActive = isMulti ? active.includes(c) : active === c;
        return (
          <button
            key={c}
            onClick={() => onToggle(c)}
            data-active={isActive ? "true" : undefined}
            className="scope-pill mono text-xs px-2 py-0.5 rounded"
          >
            {isMulti && (
              <span
                aria-hidden
                className="inline-flex items-center justify-center w-3 h-3 mr-1.5 rounded-[2px] border border-current align-[0px] text-[9px] leading-none"
              >
                <span className={isActive ? "" : "invisible"}>✓</span>
              </span>
            )}
            {display?.[c] ?? c}
            {counts?.[c] !== undefined && <span className="opacity-60 ml-1 text-[10px]">({counts[c]})</span>}
          </button>
        );
      })}
      {hint && <span className="text-[10px] text-tan-3 ml-1">{hint}</span>}
    </div>
  );
}
