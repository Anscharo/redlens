import { useEffect, useMemo, useState } from "react";
import type { ValueCheck } from "@/lib/pauAtlasValues";
import { datedDocs, withSteps, type ValueStep } from "@/lib/pauPending";
import { loadPauSteps } from "../lib/pauSteps";

/**
 * The checks with each mismatch or limit never set carrying what governance
 * did about it (`onchain`) and who can change it (`routes`), as the server
 * works them out (GET /api/pau/steps). Asked for only when a check needs one;
 * until they land, or when they cannot be read, the checks come back as they
 * are, so a mismatch is never hidden by a failed read.
 */
export function useOnchainSteps(checks: ValueCheck[]): ValueCheck[] {
  const needed = useMemo(() => datedDocs(checks).length > 0, [checks]);
  const [steps, setSteps] = useState<Map<string, ValueStep> | null>(null);
  useEffect(() => {
    if (!needed) return;
    let live = true;
    loadPauSteps().then((s) => {
      if (live && s) setSteps(s);
    });
    return () => {
      live = false;
    };
  }, [needed]);
  return useMemo(() => (steps ? withSteps(checks, steps) : checks), [checks, steps]);
}
