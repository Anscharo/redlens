import { toAnchorId } from "../../lib/anchorId";
import type { ActiveFilter, Pill } from "../../lib/reportChains";

export function FilterPills({
  label,
  items,
  kind,
  filter,
  onToggle,
}: {
  label: string;
  items: Pill[];
  kind: "govops" | "executor";
  filter: ActiveFilter;
  onToggle: (next: ActiveFilter) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-xs text-tan-3 mr-1">{label}:</span>
      {items.map((f) => {
        const slug = toAnchorId(f.name);
        return (
          <button
            key={f.id}
            onClick={() => onToggle({ kind, slug })}
            data-active={filter?.kind === kind && filter.slug === slug ? "true" : undefined}
            className="scope-pill text-xs px-2 py-0.5 rounded"
          >
            {f.name}
          </button>
        );
      })}
    </div>
  );
}
