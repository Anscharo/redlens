// Expanded-row body for the Processes report: the process doc's own content,
// its numbered step children, and the curation panel. Split out of
// ProcessesReport.tsx to keep each file small.
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { NodeContent } from "../NodeContent";
import { ProcessCurationPanel } from "./ProcessCurationPanel";
import type { LocalIgnore } from "../../lib/curationStore";
import type { AtlasNode } from "@/types";

export function ProcessExpandedBody({
  node,
  steps,
  onNavigate,
  existing,
  onMark,
  onUnmark,
}: {
  node: AtlasNode;
  steps: AtlasNode[];
  onNavigate: (id: string) => void;
  existing: LocalIgnore | undefined;
  onMark: (uuid: string, reason: string) => void;
  onUnmark: (uuid: string) => void;
}) {
  return (
    <div className="px-6 py-5 bg-[var(--bg)] border-l-2 border-[var(--accent)]">
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <NodeContent content={node.content} onNavigate={onNavigate} />
          {steps.length > 0 && (
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
          )}
        </div>
        <aside className="w-full lg:w-56 lg:shrink-0">
          <ProcessCurationPanel uuid={node.id} existing={existing} onMark={onMark} onUnmark={onUnmark} />
        </aside>
      </div>
    </div>
  );
}
