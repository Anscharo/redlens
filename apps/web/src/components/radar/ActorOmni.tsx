import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import type { ActorOmni, OmniDocRef } from "../../lib/omniDocs";
import { omniEssence, omniRows } from "../../lib/omniDocs";

function OmniRow({ doc }: { doc: OmniDocRef }) {
  const essence = omniEssence(doc.content);
  return (
    <div className="flex py-1.5 w-full items-baseline min-w-0 border-t border-[var(--border)]">
      <AtlasLink
        to={atlasHref(doc.id)}
        className="text-sm text-accent hover:underline min-w-0"
      >
        {doc.title}
      </AtlasLink>
      <span
        className="flex-1 min-w-3"
        style={{
          borderBottom: "1px dotted color-mix(in srgb, var(--tan-3) 25%, transparent)",
          margin: "0 4px 3px",
        }}
      />
      {essence && (
        <span
          className="text-sm text-right leading-relaxed shrink-0"
          style={{ maxWidth: "50%", overflowWrap: "break-word", color: "var(--tan-2)" }}
        >
          “{essence}”
        </span>
      )}
    </div>
  );
}

export function ActorOmni({ omni }: { omni: ActorOmni }) {
  const rows = omniRows(omni);
  if (rows.length === 0) return null;

  return (
    <section className="mb-6">
      <h2
        className="mono text-[10px] uppercase tracking-wider mb-3"
        style={{ color: "var(--tan-3)" }}
      >
        Omni
      </h2>
      <div>
        {rows.map((doc) => (
          <OmniRow key={doc.id} doc={doc} />
        ))}
      </div>
    </section>
  );
}
