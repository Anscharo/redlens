import { CHANGE_COLOR, CHANGE_LABEL } from "@/lib/changeTypes";
import { movePaths, type HistoryEntry } from "@/lib/history";
import { DocNoDiff, TypeDiff } from "./ChangePair";
import { TitleDiff } from "./TitleDiff";

/** A history entry's type of edit. A move reads as one sentence, folding its
 *  from/to paths into the label rather than a separate arrow line; a
 *  renumbering or type change shows its two values, the changed parts marked;
 *  a retitling shows the title's word diff below the label. */
export function ChangeLabel({ entry, label }: { entry: HistoryEntry; label?: string }) {
  const move = movePaths(entry);
  const pair = entry.movedFrom && entry.movedTo ? { prev: entry.movedFrom, next: entry.movedTo } : null;
  return (
    <>
      <p className="mono text-[12px] mt-1 break-all" style={{ color: CHANGE_COLOR[entry.changeType] }}>
        {label ?? CHANGE_LABEL[entry.changeType]}
        {move && (
          <>
            {move.from && (
              <>
                {" from "}
                <span style={{ color: "var(--tan-3)" }}>{move.from}</span>
              </>
            )}
            {" to "}
            <span style={{ color: "var(--tan-2)" }}>{move.to}</span>
          </>
        )}
        {pair && entry.changeType === "renumbered" && <> <DocNoDiff {...pair} /></>}
        {pair && entry.changeType === "retyped" && <> <TypeDiff {...pair} /></>}
      </p>
      {pair && entry.changeType === "retitled" && <TitleDiff {...pair} />}
    </>
  );
}
