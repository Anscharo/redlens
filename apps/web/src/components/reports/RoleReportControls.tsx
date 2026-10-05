// The pill area of a role-responsibility report: the role-holder, Executor and
// Prime pill groups plus the category pills, all driven by useRoleReportState.
import { FilterPills, PrimePills } from "./FilterPills";
import { CategoryPills } from "./CategoryPills";
import type { RoleRow } from "./RoleCategoryTable";
import type { RoleReportConfig } from "./roleReportTypes";
import type { useRoleReportState } from "./useRoleReportState";

export function RoleReportControls<R extends RoleRow>({
  config,
  state,
}: {
  config: RoleReportConfig<R>;
  state: ReturnType<typeof useRoleReportState<R>>;
}) {
  const { filter, toggle, pills } = state;
  return (
    <div className="flex flex-wrap gap-4 mb-6">
      <FilterPills label={config.pillLabel} items={pills.holders} kind={config.pillKind} filter={filter} onToggle={toggle} />
      <FilterPills label="Executor" items={pills.executors} kind="executor" filter={filter} onToggle={toggle} />
      <PrimePills agents={state.allAgents} filter={filter} onToggle={toggle} />
      <CategoryPills categories={state.presentCats} active={state.cat} onToggle={state.toggleCat} />
    </div>
  );
}
