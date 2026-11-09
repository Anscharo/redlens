import { useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { useArrivalTarget } from "../../hooks/useArrivalTarget";
import { loadGraph } from "../../lib/graph";
import { loadAtlas } from "../../lib/docs";
import { atlasVerdicts } from "@/lib/pauAtlasMatch";
import { withCheckedKeys } from "@/lib/pauCheckKeys";
import { withRefChains } from "@/lib/pauKeyChains";
import { withSharedLabels } from "@/lib/pauSharedLabels";
import { namedIn } from "@/lib/pauConstantDocs";
import { usePrimeAtlasChecks } from "../../hooks/usePrimeAtlasChecks";
import { addressKeyIndex, instanceKeyIndex, loadPau, loadPauHistory, primeKeyedInstance, snapshotsForPrime, timelineFor, withAddressKeys, type KeyedInstance } from "../../lib/pau";
import { deploymentAnchors, PAU_ANCHOR } from "@/lib/pauAnchors";
import { PauPartHeading } from "./PauSectionHeading";
import { Callout } from "../Callout";
import type { GraphEntity } from "@/types";
import { PauDeployment } from "./ActorPauDeployment";
import { ActorPauTimeline } from "./ActorPauTimeline";

interface Props {
  /** The prime agent: the PAU registry keys deployments by its id, and its params name its controller-wide keys. */
  prime: Pick<GraphEntity, "id" | "m">;
  /** The prime's instances; their rate-limit ID parameters name the other on-chain keys. */
  instances: KeyedInstance[];
}

/** The page's data: the prime's snapshots and change history, the names of their keys, and where a fragment link lands. */
function usePauPage({ prime, instances }: Props) {
  const res = useLoaded(loadPau, { soft: true });
  const snaps = useMemo(() => (res ? snapshotsForPrime(res, prime.id) : []), [res, prime.id]);
  const checks = usePrimeAtlasChecks(prime.id, snaps);
  const atlas = useLoaded(loadAtlas, { soft: true });
  const graph = useLoaded(loadGraph, { soft: true });
  const named = useMemo(() => namedIn(graph?.participants.find((p) => p.id === prime.id)?.did, atlas), [graph, atlas, prime.id]);
  const keyIndex = useMemo(
    () => withSharedLabels(withRefChains(withCheckedKeys(withAddressKeys(instanceKeyIndex([primeKeyedInstance(prime.m), ...instances]), addressKeyIndex(instances, snaps)), checks), atlas)),
    [prime.m, instances, snaps, checks, atlas],
  );
  const verdicts = useMemo(() => atlasVerdicts(checks), [checks]);
  const history = useLoaded(loadPauHistory, { soft: true });
  const groups = useMemo(() => (history ? timelineFor(history, prime.id) : []), [history, prime.id]);
  const anchors = useMemo(() => deploymentAnchors(snaps), [snaps]);
  useArrivalTarget(`${prime.id}/pau`, `${snaps.length}:${groups.length}`);
  return { loaded: !!res, snaps, keyIndex, named, verdicts, groups, anchors };
}

/**
 * The prime's PAU deployments as the chain reports them (GET /api/pau), the
 * body of its PAUs subpage, then their change history. Until the worker has
 * stored a snapshot for this entity it says so instead. Every deployment,
 * section and history group is a fragment (pauAnchors.ts); a link to one
 * lands once both loads have rendered it.
 */
export function ActorPau(props: Props) {
  const { loaded, snaps, keyIndex, named, verdicts, groups, anchors } = usePauPage(props);
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
      <Callout className="mb-3">
        Read from the chain for each contract in the PAU registry. Role holders come from the contracts&apos; grant history,
        each confirmed live; a rate limit is named by the prime or instance whose parameters state its ID.
      </Callout>
      {snaps.map((s) => (
        <PauDeployment key={s.deployment} snap={s} keyIndex={keyIndex} namedIn={named} verdicts={verdicts} anchor={anchors.get(s.deployment)!} />
      ))}
      <ActorPauTimeline groups={groups} snaps={snaps} keyIndex={keyIndex} />
    </section>
  );
}
