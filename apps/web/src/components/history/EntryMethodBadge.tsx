import { RECONSTRUCTED_ERAS } from "@/lib/history";
import { LINE1_H } from "./Timeline";

const BADGED = new Set(["ai", "human"]);

/** AI or human lineage on a reconstructed entry. Deterministic matches carry no badge. */
export function EntryMethodBadge({ era, method }: { era?: string; method?: string }) {
  if (!era || !RECONSTRUCTED_ERAS.has(era) || !method || !BADGED.has(method)) return null;
  const ai = method === "ai";
  return (
    <span
      title={ai ? "Lineage resolved by an AI model" : "Lineage resolved by human review"}
      className="shrink-0 px-1 rounded text-[10px] uppercase tracking-wide"
      style={{
        background: ai ? "var(--accent)" : "var(--hover)",
        color: ai ? "var(--bg)" : "var(--tan-2)",
        lineHeight: `${LINE1_H}px`,
      }}
    >
      {ai ? "AI" : "human"}
    </span>
  );
}
