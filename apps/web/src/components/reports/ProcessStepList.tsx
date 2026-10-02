// Numbered step children of a process doc, shown in the Processes report's
// expanded row beneath the process doc's own content.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { NodeContent } from "../NodeContent";
import type { AtlasNode } from "@/types";

type ProcessStepListProps = {
  steps: AtlasNode[];
  onNavigate: React.ComponentProps<typeof NodeContent>["onNavigate"];
};

export function ProcessStepList({ steps, onNavigate }: ProcessStepListProps) {
  return (
    <>
      <p className="mt-8 mb-4 text-xs mono text-tan-3 uppercase tracking-wider">
        {steps.length} step{steps.length === 1 ? "" : "s"}
      </p>
      <ol className="space-y-8 list-none pl-0">
        {steps.map((s, i) => (
          <li key={s.id}>
            <h3 className="text-base font-medium mb-3" style={{ color: "var(--tan)" }}>
              <span className="mono text-tan-3 mr-2">{i + 1}.</span>
              <AtlasLink to={atlasHref(s.id)} className="hover:underline text-left">
                {s.title}
              </AtlasLink>
              <span className="ml-2 mono text-[10px] text-tan-3 font-normal" title={s.id}>
                ({s.id.slice(0, 8)})
              </span>
            </h3>
            <NodeContent content={s.content} onNavigate={onNavigate} />
          </li>
        ))}
      </ol>
    </>
  );
}
