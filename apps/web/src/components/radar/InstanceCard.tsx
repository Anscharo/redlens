import { useMemo, type ComponentProps } from "react";
import { AtlasLink } from "../AtlasLink";
import { prepareWithSegments, measureNaturalWidth } from "@chenglou/pretext";
import type { RadarInstance } from "../../lib/actorIndex";
import { ParamLine } from "./ParamLine";
import { ParamAddressKeys, type PauPrime } from "./ParamAddressKeys";
import { listedAddress } from "../../lib/pau";
import { atlasHref } from "@/lib/routes";
import { instanceAnchor } from "@/lib/radarAnchors";
import { useAddressMap } from "../../hooks/useAddressMap";
import { HEADER_OFFSET } from "../../lib/layout";
import { StatusPill } from "../reports/RewardsCells";
import { RadarHeading } from "./RadarHeading";

const PARAM_FONT = '10px "Source Code Pro", monospace';
const MIN_DOTS_PX = 30;

function measureKeyPx(key: string): number {
  try { return measureNaturalWidth(prepareWithSegments(key, PARAM_FONT)); }
  catch { return key.length * 6; }
}

/** A param line, with the on-chain keys derived from it when it lists an address where a RateLimitID belongs. */
function ParamRow({ prime, ...line }: ComponentProps<typeof ParamLine> & { prime?: PauPrime }) {
  const { p } = line;
  return (
    <div>
      <ParamLine {...line} />
      {prime && listedAddress(p.key, p.value) && <ParamAddressKeys prime={prime} paramKey={p.key} value={p.value} />}
    </div>
  );
}

/** One instance's card. `headingLevel` ranks its name in the page outline;
 *  `prime` (the prime whose page this is) lets a RateLimitID param that lists
 *  an address show the on-chain keys derived from it. */
export function InstanceCard({ inst, prime, headingLevel = 4 }: { inst: RadarInstance; prime?: PauPrime; headingLevel?: number }) {
  // Loaded here rather than drilled from ActorInstances: loadAddresses() is
  // module-cached, so every card resolves from the one in-flight request.
  const addrMap = useAddressMap();
  const colWidth = useMemo(() => {
    if (inst.signalParams.length === 0) return MIN_DOTS_PX;
    return Math.max(...inst.signalParams.map((p) => measureKeyPx(p.key))) + MIN_DOTS_PX;
  }, [inst.signalParams]);

  return (
    <div
      id={instanceAnchor(inst.id)}
      className="rounded p-3 break-inside-avoid"
      style={{ background: "var(--bg-deep)", border: "1px solid var(--border)", maxWidth: "600px", scrollMarginTop: HEADER_OFFSET }}
    >
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <RadarHeading level={headingLevel}>
          {inst.docId ? (
            <AtlasLink to={atlasHref(inst.docId)} className="text-sm hover:underline" style={{ color: "var(--tan)" }}>
              {inst.displayName}
            </AtlasLink>
          ) : (
            <span className="text-sm" style={{ color: "var(--tan)" }}>{inst.displayName}</span>
          )}
        </RadarHeading>
        {inst.status && <StatusPill s={inst.status} />}
      </div>
      {inst.signalParams.length > 0 && (
        <div>
          {inst.signalParams.map((p) => <ParamRow key={p.key} p={p} prime={prime} colWidth={colWidth} instanceHint={inst.displayName} addrMap={addrMap} />)}
        </div>
      )}
    </div>
  );
}
