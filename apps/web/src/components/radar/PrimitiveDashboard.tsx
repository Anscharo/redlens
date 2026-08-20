import type { AgentPrimitiveStat } from "../../lib/primitiveStats";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import { AgentPanel } from "./AgentPanel";

const execCodec = urlString(null);

interface Props {
  agents: AgentPrimitiveStat[];
}

export function PrimitiveDashboard({ agents }: Props) {
  const [executorFilter, setExecutorFilter] = useUrlState("exec", execCodec);

  const executors = [...new Map(
    agents.filter(a => a.executorSlug).map(a => [a.executorSlug!, a.executorName!])
  ).entries()];

  const visible = executorFilter
    ? agents.filter(a => a.executorSlug === executorFilter)
    : agents;

  return (
    <div className="flex-1 px-6 py-6 min-w-0">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="text-xl" style={{ color: "var(--tan)" }}>
          Prime Agent Primitive Stats
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExecutorFilter(null)}
            className="mono text-[10px] px-1.5 py-0.5 rounded"
            style={{
              border: "1px solid var(--border)",
              color: executorFilter === null ? "var(--tan)" : "var(--tan-3)",
              background: executorFilter === null ? "var(--hover)" : "transparent",
            }}
          >
            All
          </button>
          {executors.map(([slug, name]) => (
            <button
              key={slug}
              onClick={() => setExecutorFilter(slug === executorFilter ? null : slug)}
              className="mono text-[10px] px-1.5 py-0.5 rounded"
              style={{
                border: "1px solid var(--border)",
                color: executorFilter === slug ? "var(--tan)" : "var(--tan-3)",
                background: executorFilter === slug ? "var(--hover)" : "transparent",
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div style={{ columns: "280px", columnGap: "1rem" }}>
        {visible.map((agent) => (
          <div key={agent.slug} className="mb-4">
            <AgentPanel agent={agent} />
          </div>
        ))}
      </div>
    </div>
  );
}
