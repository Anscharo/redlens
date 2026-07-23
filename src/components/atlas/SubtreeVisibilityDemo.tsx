export type SubtreeVisibilityMode = "cycle" | "shift-hide-open" | "shift-hide-restore";

const MODES: { id: SubtreeVisibilityMode; label: string; title: string }[] = [
  {
    id: "cycle",
    label: "3-way cycle",
    title: "Normal double-chevron click cycles collapsed, expanded, hidden.",
  },
  {
    id: "shift-hide-open",
    label: "Shift: hide/open",
    title: "Click toggles expand/collapse. Shift-click hides. Clicking hidden opens everything.",
  },
  {
    id: "shift-hide-restore",
    label: "Shift: hide/restore",
    title: "Click toggles expand/collapse. Shift-click hides. Clicking hidden restores the previous branch shape.",
  },
];

export function SubtreeVisibilityDemo({
  mode,
  onModeChange,
}: {
  mode: SubtreeVisibilityMode;
  onModeChange: (mode: SubtreeVisibilityMode) => void;
}) {
  return (
    <div className="subtree-demo-switcher" aria-label="Subtree visibility behavior demo">
      {MODES.map((item) => (
        <button
          key={item.id}
          type="button"
          className={mode === item.id ? "is-active" : undefined}
          aria-pressed={mode === item.id}
          title={item.title}
          onClick={() => onModeChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
