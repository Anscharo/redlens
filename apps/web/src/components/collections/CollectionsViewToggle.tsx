export type CollectionsView = "mine" | "conversations";
export const COLLECTIONS_VIEWS: readonly CollectionsView[] = ["mine", "conversations"];

const VIEW_LABEL: Record<CollectionsView, string> = {
  mine: "My collections",
  conversations: "Collections from conversations",
};

// Exclusive tabs: the user's saved collections vs the auto collections each
// conversation builds from the docs it cited.
export function CollectionsViewToggle({
  active,
  onChange,
}: {
  active: CollectionsView;
  onChange: (view: CollectionsView) => void;
}) {
  return (
    <div className="flex gap-1 border-b mb-4" style={{ borderColor: "var(--border)" }} role="tablist" aria-label="Collections">
      {COLLECTIONS_VIEWS.map((v) => (
        <button key={v} type="button" role="tab" aria-selected={active === v} onClick={() => onChange(v)} className="right-tab">
          {VIEW_LABEL[v]}
        </button>
      ))}
    </div>
  );
}
