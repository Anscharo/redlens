import { PLUMBING_KEY, type Plumbing } from "@/lib/pauPlumbing";
import { PLUMBING_COLOR } from "./PauPlumbingParts";
import { PLUMBING_EDGE_KINDS } from "./PauPlumbingSvg";

/** What a diagram's arrows and outlines mean: only the kinds it draws. */
export function PlumbingKey({ plumbing }: { plumbing: Plumbing }) {
  const used = PLUMBING_EDGE_KINDS.filter((k) => plumbing.edges.some((e) => e.kind === k));
  return (
    <ul className="flex flex-wrap gap-x-4">
      {used.map((k) => (
        <li key={k}>
          <span aria-hidden="true" style={{ color: PLUMBING_COLOR[k] }}>→</span> {PLUMBING_KEY[k]}
        </li>
      ))}
      {plumbing.edges.some((e) => e.optional) && <li>dashed arrow: only some deployments</li>}
      {plumbing.ownNote && <li><span style={{ color: "var(--accent)" }}>outlined</span>: {plumbing.ownNote}</li>}
      <li>hover an arrow for the rule behind it</li>
    </ul>
  );
}
