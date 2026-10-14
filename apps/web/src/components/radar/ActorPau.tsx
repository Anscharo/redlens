import { useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { useArrivalTarget } from "../../hooks/useArrivalTarget";
import { loadGraph } from "../../lib/graph";
import { loadAtlas } from "../../lib/docs";
import { checkAtlasValues, type ValueCheck } from "@/lib/pauAtlasValues";
import { atlasVerdicts } from "@/lib/pauAtlasMatch";
import { withCheckedKeys } from "@/lib/pauCheckKeys";
import { withRefChains } from "@/lib/pauKeyChains";
import { graphPrimeSources } from "@/lib/pauDocSources";
import { addressKeyIndex, instanceKeyIndex, loadPau, loadPauHistory, primeKeyedInstance, snapshotsForPrime, timelineFor, withAddressKeys, type KeyedInstance } from "../../lib/pau";
import { deploymentAnchors, PAU_ANCHOR } from "@/lib/pauAnchors";
import { PauPartHeading } from "./PauSectionHeading";
import type { GraphEntity } from "@/types";
import { PauDeployment } from "./ActorPauDeployment";
import { ActorPauTimeline } from "./ActorPauTimeline";

interface Props {
  /** The prime agent: the PAU registry keys deployments by its id, and its params name its controller-wide keys. */
  prime: Pick<GraphEntity, "id" | "m">;
  /** The prime's instances; their rate-limit ID parameters name the other on-chain keys. */
  instances: KeyedInstance[];
}

/** Every value the atlas states for the prime's keys, in its instances and in its limit documents, beside the chain (pauAtlasValues.ts); empty until the graph loads. */
function useAtlasChecks(primeId: string, snaps: Parameters<typeof checkAtlasValues>[1]): ValueCheck[] {
  const graph = useLoaded(loadGraph, { soft: true });
  const atlas = useLoaded(loadAtlas, { soft: true });
  return useMemo(() => {
    const sources = graphPrimeSources(primeId, graph, atlas ?? undefined);
    return sources ? checkAtlasValues(sources, snaps) : [];
  }, [graph, atlas, primeId, snaps]);
}

/** The page's data: the prime's snapshots and change history, the names of their keys, and where a fragment link lands. */
function usePauPage({ prime, instances }: Props) {
  const res = useLoaded(loadPau, { soft: true });
  const snaps = useMemo(() => (res ? snapshotsForPrime(res, prime.id) : []), [res, prime.id]);
  const checks = useAtlasChecks(prime.id, snaps);
  const atlas = useLoaded(loadAtlas, { soft: true });
  const keyIndex = useMemo(
    () => withRefChains(withCheckedKeys(withAddressKeys(instanceKeyIndex([primeKeyedInstance(prime.m), ...instances]), addressKeyIndex(instances, snaps)), checks), atlas),
    [prime.m, instances, snaps, checks, atlas],
  );
  const verdicts = useMemo(() => atlasVerdicts(checks), [checks]);
  const history = useLoaded(loadPauHistory, { soft: true });
  const groups = useMemo(() => (history ? timelineFor(history, prime.id) : []), [history, prime.id]);
  const anchors = useMemo(() => deploymentAnchors(snaps), [snaps]);
  useArrivalTarget(`${prime.id}/pau`, `${snaps.length}:${groups.length}`);
  return { loaded: !!res, snaps, keyIndex, verdicts, groups, anchors };
}

/**
 * The prime's PAU deployments as the chain reports them (GET /api/pau), the
 * body of its PAUs subpage, then their change history. Until the worker has
 * stored a snapshot for this entity it says so instead. Every deployment,
 * section and history group is a fragment (pauAnchors.ts); a link to one
 * lands once both loads have rendered it.
 */
export function ActorPau(props: Props) {
  const { loaded, snaps, keyIndex, verdicts, groups, anchors } = usePauPage(props);
  if (snaps.length === 0) {
    return (
      <p className="mono text-[11px]" style={{ color: "var(--tan-3)" }}>
        {loaded ? "no PAU contracts have been read for this Prime yet" : "loading PAU snapshots…"}
      </p>
    );
  }

  return (
    <section aria-labelledby={PAU_ANCHOR.currentState}>
      <PauPartHeading anchor={{ id: PAU_ANCHOR.currentState, aliases: [] }}>Current state</PauPartHeading>
      <p className="text-[12px] mb-3" style={{ color: "var(--tan-3)" }}>
        Read from the chain for each contract in the PAU registry. Role holders come from the contracts&apos; grant history,
        each confirmed live; a rate limit is named by the prime or instance whose parameters state its ID.
      </p>
      {snaps.map((s, i) => (
        <PauDeployment key={s.deployment} snap={s} keyIndex={keyIndex} verdicts={verdicts} defaultOpen={i === 0} anchor={anchors.get(s.deployment)!} />
      ))}
      <ActorPauTimeline groups={groups} snaps={snaps} keyIndex={keyIndex} />
    </section>
  );
}
