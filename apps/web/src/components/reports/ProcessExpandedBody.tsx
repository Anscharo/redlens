// Expanded-row body for the Processes report: the process doc's own content,
// its numbered step children, and the curation panel.
import { NodeContent } from "../NodeContent";
import { ProcessCurationPanel } from "./ProcessCurationPanel";
import { ProcessStepList } from "./ProcessStepList";
import type { LocalIgnore } from "../../lib/curationStore";
import type { AtlasNode } from "@/types";
import { useNavigateToNode } from "../../hooks/useNavigation";

type ProcessExpandedBodyProps = {
  node: AtlasNode;
  steps: AtlasNode[];
  existing: LocalIgnore | undefined;
  onMark: (uuid: string, reason: string) => void;
  onUnmark: (uuid: string) => void;
};

export function ProcessExpandedBody({ node, steps, existing, onMark, onUnmark }: ProcessExpandedBodyProps) {
  const onNavigate = useNavigateToNode();
  return (
    <div className="px-6 py-5 bg-[var(--bg)] border-l-2 border-[var(--accent)]">
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <NodeContent content={node.content} onNavigate={onNavigate} />
          {steps.length > 0 && <ProcessStepList steps={steps} onNavigate={onNavigate} />}
        </div>
        <aside className="w-full lg:w-56 lg:shrink-0">
          <ProcessCurationPanel uuid={node.id} existing={existing} onMark={onMark} onUnmark={onUnmark} />
        </aside>
      </div>
    </div>
  );
}
