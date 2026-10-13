import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import { LIFECYCLE_STEPS, type LifecycleQuote, type LifecycleStep } from "@/lib/primitiveLifecycle";
import { StatusPill } from "../reports/RewardsCells";
import { statusLabel } from "./InstanceCard";
import { RadarHeading } from "./RadarHeading";

const pillLabel = (step: LifecycleStep): string =>
  step.level === "global" ? `Global Activation Status: ${step.status}` : statusLabel(step.status);

function Quote({ q }: { q: LifecycleQuote }) {
  const start = q.cut === "start" || q.cut === "both" ? "…" : "";
  const end = q.cut === "end" || q.cut === "both" ? "…" : "";
  return (
    <figure className="mt-2">
      <figcaption className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        <AtlasLink to={atlasHref(q.docId)} className="hover:underline" style={{ color: "var(--accent)" }}>
          {q.docTitle}
        </AtlasLink>
        :
      </figcaption>
      <blockquote className="text-[11px] italic pl-2" style={{ color: "var(--tan-2)", borderLeft: "2px solid var(--border)" }}>
        “{start}{q.text}{end}”
      </blockquote>
    </figure>
  );
}

/** How a primitive goes from inactive to done, in the atlas's own words. */
export function PrimitiveLifecycle({ level = 2 }: { level?: number }) {
  return (
    <section
      aria-label="How primitives work"
      className="rounded p-3 mb-6"
      style={{ background: "var(--bg-deep)", border: "1px solid var(--border)" }}
    >
      <RadarHeading level={level} className="text-sm font-medium mb-3" style={{ color: "var(--tan)" }}>
        How primitives work
      </RadarHeading>
      <ol className="grid gap-x-4 gap-y-4 list-none p-0 m-0 md:grid-cols-2 xl:grid-cols-4">
        {LIFECYCLE_STEPS.map((step, i) => (
          <li key={i} className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>{i + 1}.</span>
              <StatusPill s={step.status} label={pillLabel(step)} />
            </div>
            <p className="text-[12px] mt-1" style={{ color: "var(--tan-2)" }}>{step.summary}</p>
            {step.quotes.map((q) => <Quote key={q.docId} q={q} />)}
          </li>
        ))}
      </ol>
    </section>
  );
}
