import { Link } from "../Link";
import { Tooltip } from "../Tooltip";
import type { CategoryStat, PrimitiveStat } from "../../lib/primitiveStats";
import { toAnchorId } from "../../lib/anchorId";
import { actorHref } from "@/lib/routes";
import {
  BORDER,
  CELL_PADDING,
  GROUP_BORDER,
  GroupedNameList,
  HEADERS,
  NameList,
  ROW_COLORS,
  anchorFor,
  namesFor,
  shortenCategoryTitle,
  tdStyle,
  type NameGroup,
} from "./primitiveTable";

function PrimitiveRow({ p, rowIndex, agentSlug }: { p: PrimitiveStat; rowIndex: number; agentSlug: string }) {
  return (
    <tr style={{ background: ROW_COLORS[rowIndex % 2] }}>
      <td className="py-0.5 pl-3" style={{ maxWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <Tooltip content={`${p.title} Primitive`}>
          <Link to={actorHref(agentSlug, p.st)} className="mono text-[11px] hover:underline w-full text-left truncate block" style={{ color: "var(--tan-2)" }}>
            {p.title}
          </Link>
        </Tooltip>
      </td>
      {[p.invocations, p.active, p.suspended, p.completed].map((n, i) => {
        const h = HEADERS[i];
        const style = tdStyle(h, n === 0);
        const tip = n === 0 ? `No ${h.label}` : <NameList names={namesFor(p, i)} />;
        if (n === 0) {
          return (
            <Tooltip key={i} content={tip}>
              <td className="mono text-[10px] py-0.5" style={style}>{n}</td>
            </Tooltip>
          );
        }
        return (
          <Tooltip key={i} content={tip}>
            <td className="mono text-[10px] py-0.5" style={style}>
              <Link to={actorHref(agentSlug, anchorFor(h, p.st))} className="hover:underline" style={{ color: "inherit" }}>
                {n}
              </Link>
            </td>
          </Tooltip>
        );
      })}
    </tr>
  );
}

export function CategoryRows({ cat, startIndex, agentSlug }: { cat: CategoryStat; startIndex: number; agentSlug: string }) {
  const title = shortenCategoryTitle(cat.title);
  const sums = cat.primitives.reduce(
    (acc, p) => {
      acc[0] += p.invocations;
      acc[1] += p.active;
      acc[2] += p.suspended;
      acc[3] += p.completed;
      return acc;
    },
    [0, 0, 0, 0],
  );
  return (
    <>
      <tr style={{ fontWeight: "bold" }}>
        <td className="pt-3 pb-0.5 pl-3" style={{ borderBottom: BORDER }}>
          <Tooltip content={cat.title}>
            <Link to={actorHref(agentSlug, toAnchorId(cat.title))} className="mono text-[10px] uppercase tracking-wider hover:underline" style={{ color: "var(--lily-green)" }}>
              {title}
            </Link>
          </Tooltip>
        </td>
        {HEADERS.map((h, i) => {
          const sum = sums[i];
          const groups: NameGroup[] = cat.primitives
            .map((p) => ({ primTitle: p.title, names: namesFor(p, i) }))
            .filter((g) => g.names.length > 0);
          const tip = sum === 0
            ? `No ${h.label} in ${cat.title}`
            : <GroupedNameList groups={groups} />;
          const cellStyle: React.CSSProperties = {
            textAlign: "center",
            borderLeft: h.isGroupStart ? GROUP_BORDER : BORDER,
            borderBottom: BORDER,
            paddingLeft: CELL_PADDING,
            paddingRight: CELL_PADDING,
            color: "var(--terminal-green)",
            opacity: sum === 0 ? 0.3 : 1,
          };
          return (
            <Tooltip key={h.key} content={tip}>
              <td className="mono text-[10px] pt-3 pb-0.5" style={cellStyle}>
                {sum === 0 ? (
                  sum
                ) : (
                  <Link to={actorHref(agentSlug, toAnchorId(cat.title))} className="hover:underline" style={{ color: "inherit" }}>
                    {sum}
                  </Link>
                )}
              </td>
            </Tooltip>
          );
        })}
      </tr>
      {cat.primitives.map((p, i) => (
        <PrimitiveRow key={p.st} p={p} rowIndex={startIndex + i} agentSlug={agentSlug} />
      ))}
    </>
  );
}
