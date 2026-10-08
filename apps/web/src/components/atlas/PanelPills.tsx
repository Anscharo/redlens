import type { AtlasTab } from "../../lib/atlasTab";

interface PanelPillsProps {
  shown: AtlasTab[];
  active: AtlasTab;
  /** Badge count per section; zero shows no badge. */
  counts: Record<AtlasTab, number>;
  onSelect: (t: AtlasTab) => void;
}

// The right panel's jump bar: one pill per shown section, the active one marked.
export function PanelPills({ shown, active, counts, onSelect }: PanelPillsProps) {
  return (
    <nav
      className="flex flex-wrap gap-2 border-b shrink-0"
      style={{ borderColor: "var(--border)", padding: "10px 16px" }}
      aria-label="Panel sections"
    >
      {shown.map((t) => (
        <button
          key={t}
          type="button"
          aria-current={active === t ? "true" : undefined}
          data-state={active === t ? "active" : "inactive"}
          onClick={() => onSelect(t)}
          className="right-pill"
        >
          {t}{counts[t] > 0 && <span style={{ marginLeft: 4 }}>· {counts[t]}</span>}
        </button>
      ))}
    </nav>
  );
}
