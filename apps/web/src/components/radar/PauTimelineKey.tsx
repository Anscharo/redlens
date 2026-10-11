import type { TimelineGroup } from "../../lib/pau";

const KEY: [TimelineGroup["kind"], string, string][] = [
  ["executive", "Executive Vote", "a spell the chain proves made the change; one group per vote, across every chain it reached"],
  ["operator", "Operator change", "made through the Configurator without a spell, within the BeamState bounds shown"],
  ["deployment", "Deployment", "contract creation and setup before the deployment's first governed change"],
  ["relayed", "Relayed from Ethereum", "an L2 action set that no bridge message id ties to a spell yet"],
  ["direct", "Direct call", "a call after setup from an address outside governance"],
  ["unknown", "Not yet attributed", "the worker has not yet proven what made the change; each line says what it is waiting on"],
];

const dim = { color: "var(--tan-3)" };

/** What each kind of change-history group means, for the kinds this Prime's history holds. */
export function PauTimelineKey({ kinds }: { kinds: Set<TimelineGroup["kind"]> }) {
  const rows = KEY.filter(([k]) => kinds.has(k));
  if (rows.length === 0) return null;
  return (
    <dl className="pau-timeline-key text-[12px] mb-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5" aria-label="Group kinds">
      {rows.map(([k, term, meaning]) => (
        <div key={k} className="contents" data-kind={k}>
          <dt style={{ color: "var(--tan-2)" }}>{term}</dt>
          <dd style={dim}>{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}
