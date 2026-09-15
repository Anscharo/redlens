import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import type { ActorOmni, OmniDocRef } from "../../lib/omniDocs";
import { omniExcerpt, omniGlance, omniNoteLabel } from "../../lib/omniDocs";

const CHIP =
  "text-xs px-2 py-0.5 rounded border border-[var(--border)] text-accent hover:border-[var(--accent)] transition-colors";

function Chip({ doc }: { doc: OmniDocRef }) {
  return (
    <AtlasLink to={atlasHref(doc.id)} className={CHIP}>
      {omniNoteLabel(doc.title)}
    </AtlasLink>
  );
}

function Excerpt({ doc }: { doc: OmniDocRef }) {
  const excerpt = omniExcerpt(doc.content);
  return (
    <div className="w-full">
      <AtlasLink to={atlasHref(doc.id)} className="text-sm text-accent hover:underline">
        {omniNoteLabel(doc.title)}
      </AtlasLink>
      {excerpt && (
        <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--tan-2)" }}>
          {excerpt}
        </p>
      )}
    </div>
  );
}

export function ActorOmni({ omni }: { omni: ActorOmni }) {
  const glance = omniGlance(omni);
  if (glance.length === 0) return null;

  return (
    <section className="mb-6">
      <h2
        className="mono text-[10px] uppercase tracking-wider mb-3"
        style={{ color: "var(--tan-3)" }}
      >
        Omni
      </h2>
      <div className="flex flex-wrap gap-2 items-start">
        {glance.map((doc) =>
          omniExcerpt(doc.content) ? <Excerpt key={doc.id} doc={doc} /> : <Chip key={doc.id} doc={doc} />,
        )}
      </div>
    </section>
  );
}
