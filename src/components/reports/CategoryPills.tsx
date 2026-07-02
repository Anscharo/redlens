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
}: {
  categories: readonly T[];
  active: T | null;
  onToggle: (next: T) => void;
}) {
  if (categories.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-xs text-tan-3 mr-1">Category:</span>
      {categories.map((c) => (
        <button
          key={c}
          onClick={() => onToggle(c)}
          data-active={active === c ? "true" : undefined}
          className="scope-pill mono text-xs px-2 py-0.5 rounded"
        >
          {c}
        </button>
      ))}
    </div>
  );
}
