// One table per category of a role-responsibility report, in the config's
// categoryLabels order; categories with no filtered rows render nothing.
import type { RoleRow } from "./RoleCategoryTable";
import type { RoleReportConfig } from "./roleReportTypes";
import type { useRoleReportState } from "./useRoleReportState";

export function RoleCategoryTables<R extends RoleRow>({
  config,
  state,
}: {
  config: RoleReportConfig<R>;
  state: ReturnType<typeof useRoleReportState<R>>;
}) {
  const CategoryTable = config.CategoryTable;
  return (Object.entries(config.categoryLabels) as [R["category"], string][]).map(([c, label]) => {
    const rows = state.byCategory[c];
    if (!rows?.length) return null;
    return <CategoryTable key={c} cat={c} label={label} rows={rows} chains={state.chains} rq={state.rq} />;
  });
}
