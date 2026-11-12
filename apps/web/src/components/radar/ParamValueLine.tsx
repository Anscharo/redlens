// How an instance card shows one param: a holder table as one line per holder
// (src/lib/paramTable.ts), else the value its sentence states with the sentence
// on hover (src/lib/paramGist.ts), else the value as written.
import type { ComponentProps } from "react";
import { paramGist } from "@/lib/paramGist";
import { paramTable } from "@/lib/paramTable";
import { ParamLine } from "./ParamLine";
import { ParamTableLine } from "./ParamTableLine";

export function ParamValueLine(line: ComponentProps<typeof ParamLine>) {
  const table = paramTable(line.p.value);
  if (table) return <ParamTableLine {...line} table={table} />;
  const gist = paramGist(line.p.key, line.p.value);
  return gist ? <ParamLine {...line} p={{ ...line.p, value: gist }} valueTitle={line.p.value} /> : <ParamLine {...line} />;
}
