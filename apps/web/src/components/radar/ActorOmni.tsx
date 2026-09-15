import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import type { ActorOmni, OmniDocRef } from "../../lib/omniDocs";
import { extraOmniSections } from "../../lib/omniDocs";

const REQUIRED_ROWS: { key: keyof ActorOmni["required"]; label: string }[] = [
  { key: "root", label: "Root" },
  { key: "govInfo", label: "Governance information" },
  { key: "ecosystemEmergency", label: "Ecosystem emergency" },
  { key: "agentEmergency", label: "Agent emergency" },
];

function Row({ label, doc }: { label: string; doc: OmniDocRef | null }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td
        className="py-1.5 pr-4 mono text-[10px] w-44 align-top pt-2"
        style={{ color: "var(--tan-3)" }}
      >
        {label}
      </td>
      <td className="py-1.5">
        {doc ? (
          <AtlasLink to={atlasHref(doc.id)} className="text-sm text-accent hover:underline">
            {doc.title}
          </AtlasLink>
        ) : (
          <span className="text-sm" style={{ color: "var(--tan-3)" }}>missing</span>
        )}
      </td>
    </tr>
  );
}

export function ActorOmni({ omni }: { omni: ActorOmni }) {
  if (!omni.root) return null;
  const extra = extraOmniSections(omni);

  return (
    <section className="mb-6">
      <h2
        className="mono text-[10px] uppercase tracking-wider mb-3"
        style={{ color: "var(--tan-3)" }}
      >
        Omni Documents
      </h2>
      <table className="w-full text-sm border-collapse">
        <tbody>
          {REQUIRED_ROWS.map(({ key, label }) => (
            <Row key={key} label={label} doc={omni.required[key]} />
          ))}
          {extra.map((s) => (
            <Row key={s.id} label={s.docNo} doc={s} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
