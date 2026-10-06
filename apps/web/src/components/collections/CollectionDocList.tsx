import type { RowMark } from "@/lib/collectionDiff";
import type { AtlasNode } from "@/types";

const MARK_GLYPH = { add: "+", remove: "−" } as const;
// Doubles as the diff colour token name: --diff-added-*, --diff-removed-*.
const MARK_LABEL = { add: "added", remove: "removed" } as const;

// One document: doc_no and title. A changed row (add / remove) is tinted with
// the audited diff colours and gets a +/− and an accessible label.
function DocRow({ node, mark, marked }: { node: AtlasNode; mark?: RowMark; marked: boolean }) {
  const changed = mark === "add" || mark === "remove";
  const tint = changed ? { background: `var(--diff-${MARK_LABEL[mark]}-bg)`, color: `var(--diff-${MARK_LABEL[mark]}-fg)` } : undefined;
  return (
    <li className="text-xs flex gap-2 min-w-0" style={tint}>
      {marked && (
        <span className="mono shrink-0 w-3 text-center" role={changed ? "img" : undefined} aria-label={changed ? MARK_LABEL[mark] : undefined}>
          {changed ? MARK_GLYPH[mark] : ""}
        </span>
      )}
      <span className={changed ? "mono shrink-0" : "mono text-tan-3 shrink-0"}>{node.doc_no}</span>
      <span className="truncate" style={changed ? undefined : { color: "var(--tan-2)" }}>{node.title}</span>
    </li>
  );
}

// A collection's documents as doc_no + title rows, cut to `limit` with a
// "+N more" tail. Renders nothing until `docs` (docs.json) has loaded, so a
// caller shows its own bare count meanwhile. With `marks`, rows tagged add /
// remove get a +/− and the diff colours (the save dialog's preview).
export function CollectionDocList({
  ids,
  docs,
  limit,
  marks,
  className,
}: {
  ids: readonly string[];
  docs: Record<string, AtlasNode> | null;
  limit: number;
  marks?: ReadonlyMap<string, RowMark>;
  className?: string;
}) {
  const items = docs
    ? ids
        .slice(0, limit)
        .map((id) => docs[id])
        .filter((n): n is AtlasNode => Boolean(n))
    : [];
  if (items.length === 0) return null;
  const extra = ids.length - items.length;

  return (
    <ul className={`flex flex-col gap-0.5 ${className ?? ""}`}>
      {items.map((n) => (
        <DocRow key={n.id} node={n} mark={marks?.get(n.id)} marked={Boolean(marks)} />
      ))}
      {extra > 0 && <li className="text-xs text-tan-3">+{extra} more</li>}
    </ul>
  );
}
