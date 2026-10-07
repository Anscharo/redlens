import { Link } from "../Link";
import { Tooltip } from "../Tooltip";
import { ROW_COLORS } from "./primitiveTable";
import type { AffectedDoc, Category } from "./actorHistoryMerge";
import { CATEGORY_LABEL, CATEGORY_TOOLTIP, docHref } from "./actorHistoryLabels";
import { EditCell, TitleCell } from "./ActorHistoryDocCells";

// One row of the per-commit doc table.

const CELL = { verticalAlign: "middle", overflow: "hidden" } as const;
const DOC_NO_CELL = { ...CELL, textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const TITLE_CELL = { ...CELL, color: "var(--tan-2)" } as const;
const CATEGORY_CHIP = { background: "var(--hover)", color: "var(--tan-2)" } as const;

function DocNoCell({ doc: d }: { doc: AffectedDoc }) {
  if (!d.docNo) return <span style={{ color: "var(--tan-3)" }}>—</span>;
  return (
    <Link to={docHref(d.docId)} className="hover:underline focus-visible:underline" style={{ color: "var(--accent)" }}>
      {d.docNo}
    </Link>
  );
}

function RelevanceCell({ category }: { category: Category }) {
  return (
    <Tooltip content={CATEGORY_TOOLTIP[category]}>
      <span className="px-1 rounded cursor-help" style={CATEGORY_CHIP}>{CATEGORY_LABEL[category]}</span>
    </Tooltip>
  );
}

export function DocRow({ doc, rowIndex }: { doc: AffectedDoc; rowIndex: number }) {
  return (
    <tr style={{ background: ROW_COLORS[rowIndex % 2] }}>
      <td className="py-0.5 pr-3" style={DOC_NO_CELL}><DocNoCell doc={doc} /></td>
      <td className="py-0.5 pr-3" style={TITLE_CELL}><TitleCell doc={doc} /></td>
      <td className="py-0.5 pr-3" style={CELL}><RelevanceCell category={doc.category} /></td>
      <td className="py-0.5" style={CELL}><EditCell doc={doc} /></td>
    </tr>
  );
}
