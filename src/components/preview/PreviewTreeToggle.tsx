import { useDataSource } from "../../lib/dataSource";
import { usePreviewView } from "../../lib/previewView";
import { usePreviewDiff } from "../../lib/previewDiff";

// Sits above the tree in preview mode: "All" ⇄ "Changed only". The toggle is
// shared state, so it filters both this sidebar AND the reader area.
export function PreviewTreeToggle() {
  const { preview } = useDataSource();
  const { onlyChanged, setOnlyChanged } = usePreviewView();
  const diff = usePreviewDiff();
  if (!preview) return null;
  const count = diff.added.size + diff.changed.size;

  const btn = (active: boolean, color: string): React.CSSProperties => ({
    color: active ? color : "var(--tan-3)",
    background: active ? "var(--hover)" : "transparent",
    fontWeight: active ? 600 : 400,
  });

  return (
    <div
      className="flex items-center gap-1 px-2 py-1.5 text-[11px] mono shrink-0"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <button className="px-2 py-0.5 rounded" style={btn(!onlyChanged, "var(--tan)")} onClick={() => setOnlyChanged(false)}>
        All
      </button>
      <button className="px-2 py-0.5 rounded" style={btn(onlyChanged, "#fff")} onClick={() => setOnlyChanged(true)}>
        Changed only{count ? ` · ${count}` : ""}
      </button>
    </div>
  );
}
