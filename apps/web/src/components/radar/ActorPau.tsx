import { useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { useArrivalTarget } from "../../hooks/useArrivalTarget";
import { loadGraph } from "../../lib/graph";
import { checkAtlasValues } from "@/lib/pauAtlasValues";
import { atlasMatchedKeys } from "@/lib/pauAtlasMatch";
import { primeValueSources } from "@/lib/pauDocSources";
import { addressKeyIndex, instanceKeyIndex, loadPau, loadPauHistory, primeKeyedInstance, snapshotsForPrime, timelineFor, withAddressKeys, type KeyedInstance } from "../../lib/pau";
import { deploymentAnchors, PAU_ANCHOR } from "@/lib/pauAnchors";
import { HeadingAnchor } from "../HeadingAnchor";
import type { GraphEntity } from "@/types";
import { PauDeployment } from "./ActorPauDeployment";
import { ActorPauTimeline } from "./ActorPauTimeline";

interface Props {
  /** The prime agent: the PAU registry keys deployments by its id, and its params name its controller-wide keys. */
  prime: Pick<GraphEntity, "id" | "m">;
  /** The prime's instances; their rate-limit ID parameters name the other on-chain keys. */
  instances: KeyedInstance[];
}

/** The prime's rate-limit keys whose stated values all match the chain (pauAtlasMatch.ts); empty until the graph loads. */
function useAtlasMatched(primeId: string, snaps: Parameters<typeof checkAtlasValues>[1]): Set<string> {
  const graph = useLoaded(loadGraph, { soft: true });
  return useMemo(() => {
    const sources = primeValueSources(primeId, graph);
    return sources ? atlasMatchedKeys(checkAtlasValues(sources, snaps)) : new Set<string>();
  }, [graph, primeId, snaps]);
}

/** The page's data: the prime's snapshots and change history, the names of their keys, and where a fragment link lands. */
function usePauPage({ prime, instances }: Props) {
  const res = useLoaded(loadPau, { soft: true });
  const snaps = useMemo(() => (res ? snapshotsForPrime(res, prime.id) : []), [res, prime.id]);
  const keyIndex = useMemo(
    () => withAddressKeys(instanceKeyIndex([primeKeyedInstance(prime.m), ...instances]), addressKeyIndex(instances, snaps)),
    [prime.m, instances, snaps],
  );
  const matched = useAtlasMatched(prime.id, snaps);
  const history = useLoaded(loadPauHistory, { soft: true });
  const groups = useMemo(() => (history ? timelineFor(history, prime.id) : []), [history, prime.id]);
  const anchors = useMemo(() => deploymentAnchors(snaps), [snaps]);
  useArrivalTarget(`${prime.id}/pau`, `${snaps.length}:${groups.length}`);
  return { loaded: !!res, snaps, keyIndex, matched, groups, anchors };
}

/**
 * The prime's PAU deployments as the chain reports them (GET /api/pau), the
 * body of its PAUs subpage, then their change history. Until the worker has
 * stored a snapshot for this entity it says so instead. Every deployment,
 * section and history group is a fragment (pauAnchors.ts); a link to one
 * lands once both loads have rendered it.
 */
export function ActorPau(props: Props) {
  const { loaded, snaps, keyIndex, matched, groups, anchors } = usePauPage(props);
  if (snaps.length === 0) {
    return (
      <p className="mono text-[11px]" style={{ color: "var(--tan-3)" }}>
        {loaded ? "no PAU contracts have been read for this Prime yet" : "loading PAU snapshots…"}
      </p>
    );
  }

  return (
    <section aria-labelledby={PAU_ANCHOR.currentState}>
      <h2 id={PAU_ANCHOR.currentState} className="heading-with-anchor mono text-[14px] uppercase tracking-wider mb-1" style={{ color: "var(--tan-2)" }}>
        Current state<HeadingAnchor id={PAU_ANCHOR.currentState} />
      </h2>
      <p className="text-[12px] mb-3" style={{ color: "var(--tan-3)" }}>
        Read from the chain for each contract in the PAU registry. Role holders come from the contracts&apos; grant history,
        each confirmed live; a rate limit is named by the prime or instance whose parameters state its ID.
      </p>
      {snaps.map((s, i) => (
        <PauDeployment key={s.deployment} snap={s} keyIndex={keyIndex} matched={matched} defaultOpen={i === 0} anchor={anchors.get(s.deployment)!} />
      ))}
      <ActorPauTimeline groups={groups} snaps={snaps} keyIndex={keyIndex} />
    </section>
  );
}
