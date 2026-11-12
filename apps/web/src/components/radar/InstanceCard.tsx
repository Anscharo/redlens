import { useMemo, type ComponentProps } from "react";
import { AtlasLink } from "../AtlasLink";
import { prepareWithSegments, measureNaturalWidth } from "@chenglou/pretext";
import type { RadarInstance } from "../../lib/actorIndex";
import { ParamLine } from "./ParamLine";
import { ParamValueLine } from "./ParamValueLine";
import { ParamAddressKeys, type PauPrime } from "./ParamAddressKeys";
import { listedAddress } from "../../lib/pau";
import { atlasHref } from "@/lib/routes";
import { instanceAnchor } from "@/lib/radarAnchors";
import { INVOCATION_STATUS_LABEL, isInvocationStatus } from "@/lib/radarRules";
import { HEADER_OFFSET } from "../../lib/layout";
import { StatusPill } from "../reports/RewardsCells";
import { RadarHeading } from "./RadarHeading";
import { rowMarkFor, type CardMarks } from "../../lib/rowMark";

const PARAM_FONT = '10px "Source Code Pro", monospace';
const MIN_DOTS_PX = 30;

function measureKeyPx(key: string): number {
  try { return measureNaturalWidth(prepareWithSegments(key, PARAM_FONT)); }
  catch { return key.length * 6; }
}

/** An invocation status reads "<Status> Invocation", every other status "<Status> Instance". */
export function statusLabel(status: string): string {
  return isInvocationStatus(status) ? `${INVOCATION_STATUS_LABEL[status]} Invocation` : `${status} Instance`;
}

/** A param line, with the on-chain keys derived from it when it lists an address where a RateLimitID belongs. */
function ParamRow({ prime, ...line }: ComponentProps<typeof ParamLine> & { prime?: PauPrime }) {
  const { p } = line;
  return (
    <div>
      <ParamValueLine {...line} />
      {prime && listedAddress(p.key, p.value) && <ParamAddressKeys prime={prime} paramKey={p.key} value={p.value} />}
    </div>
  );
}

interface InstanceCardProps {
  inst: RadarInstance;
  prime?: PauPrime;
  headingLevel?: number;
  /** The prime's checks against the chain (rowMark.ts); a card with no row checked keeps no mark column. */
  marks?: CardMarks | null;
}

/** One instance's card. `headingLevel` ranks its name in the page outline;
 *  `prime` (the prime whose page this is) lets a RateLimitID param that lists
 *  an address show the on-chain keys derived from it, and `marks` checks each
 *  maxAmount, slope, RateLimitID and address against the chain. */
export function InstanceCard({ inst, prime, headingLevel = 4, marks }: InstanceCardProps) {
  const colWidth = useMemo(() => {
    if (inst.signalParams.length === 0) return MIN_DOTS_PX;
    return Math.max(...inst.signalParams.map((p) => measureKeyPx(p.key))) + MIN_DOTS_PX;
  }, [inst.signalParams]);
  const rowMarks = useMemo(() => inst.signalParams.map((p) => (marks ? rowMarkFor(marks, inst.docId, p) : null)), [marks, inst.docId, inst.signalParams]);
  const markCol = rowMarks.some((m) => m !== null);

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
        {inst.status && <StatusPill s={inst.status} label={statusLabel(inst.status)} />}
      </div>
      {inst.signalParams.length > 0 && (
        <div>
          {inst.signalParams.map((p, i) => (
            <ParamRow key={p.key} p={p} prime={prime} colWidth={colWidth} instanceHint={inst.displayName} mark={rowMarks[i]} markCol={markCol} />
          ))}
        </div>
      )}
    </div>
  );
}
