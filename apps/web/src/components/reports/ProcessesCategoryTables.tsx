// The Processes report body: one ProcessesTable per category present in the
// filtered rows, sharing the expanded row and the local ignore marks.
import type { AtlasNode } from "@/types";
import type { useProcessesState } from "./useProcessesState";
import { ProcessesTable } from "./ProcessesTable";

type ProcessesCategoryTablesProps = {
  state: ReturnType<typeof useProcessesState>;
  docs: Record<string, AtlasNode>;
  expandedUuid: string | null;
  onToggle: (uuid: string) => void;
};

export function ProcessesCategoryTables({ state: s, docs, expandedUuid, onToggle }: ProcessesCategoryTablesProps) {
  return [...s.byCategory.entries()].map(([category, list]) => (
    <ProcessesTable
      key={category}
      category={category}
      rows={list}
      docs={docs}
      childrenByParentDocNo={s.childrenByParentDocNo}
      expandedUuid={expandedUuid}
      onToggle={onToggle}
      ignoresByUuid={s.ignores.byUuid}
      onMark={s.ignores.mark}
      onUnmark={s.ignores.unmark}
      rq={s.rq}
    />
  ));
}
