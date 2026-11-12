// A param that lists its holders in a table (src/lib/paramTable.ts): the param
// as one line, with the one address its sentence names as its value, then each
// holder set in beneath it as its own key and value, then any note after the
// table. The sentence itself is the key's hover text.
import type { ComponentProps } from "react";
import type { ParamTable } from "@/lib/paramTable";
import { ParamLine } from "./ParamLine";

type ParamTableLineProps = ComponentProps<typeof ParamLine> & { table: ParamTable };

export function ParamTableLine({ table, p, ...line }: ParamTableLineProps) {
  return (
    <div data-slot="param-table">
      <ParamLine {...line} p={{ ...p, value: table.main ?? "" }} keyTitle={table.lead || undefined} />
      {table.rows.map((r, i) => (
        <ParamLine key={`${r.label}-${i}`} {...line} mark={null} p={{ key: r.label, value: r.value, srcDocId: null }} indent />
      ))}
      {table.note && (
        <p className="mono text-[10px] pl-4 leading-relaxed" style={{ color: "var(--tan-3)" }}>
          {table.note}
        </p>
      )}
    </div>
  );
}
