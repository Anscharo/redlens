// Browser-side loader for processes.json. Split out of processesIndex.ts (now
// shared with the server report tool) so that module stays pure — mirrors
// oeaReportLoad.ts's split from oeaReport.ts.
import { fetchJson } from "@/lib/verify";
import type { ProcessEntry } from "@/lib/processesIndex";

let cache: Promise<ProcessEntry[]> | null = null;

export function loadProcesses(): Promise<ProcessEntry[]> {
  if (!cache) {
    cache = fetchJson<ProcessEntry[]>(
      `${import.meta.env.BASE_URL}processes.json`,
      "processes.json",
    ).catch((err) => {
      cache = null;
      throw err;
    });
  }
  return cache;
}
