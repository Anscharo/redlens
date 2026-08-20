import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import type { ActorContact } from "@/lib/actorIndex";

const SCOPE_LABEL: Record<string, string> = {
  ecosystem: "Emergency · Ecosystem",
  agent_specific: "Emergency · Agent",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td
        className="py-1.5 pr-4 mono text-[10px] w-36 align-top pt-2"
        style={{ color: "var(--tan-3)" }}
      >
        {label}
      </td>
      <td className="py-1.5">{children}</td>
    </tr>
  );
}

export function ActorContact({ contact }: { contact: ActorContact }) {
  const { channels, emergency } = contact;
  if (channels.length === 0 && emergency.length === 0) return null;

  return (
    <section className="mb-6">
      <h2
        className="mono text-[10px] uppercase tracking-wider mb-3"
        style={{ color: "var(--tan-3)" }}
      >
        Contact
      </h2>
      <table className="w-full text-sm border-collapse">
        <tbody>
          {channels.map((c) =>
            c.platform === "forum" ? (
              <Row key={c.docId} label="Forum">
                <AtlasLink to={atlasHref(c.docId)} className="text-accent hover:underline">
                  Sky Forum
                </AtlasLink>
                {c.category && (
                  <span style={{ color: "var(--tan-2)" }}> — “{c.category}” category</span>
                )}
              </Row>
            ) : (
              <Row key={c.docId} label="Discord">
                {c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    {c.url.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  <AtlasLink to={atlasHref(c.docId)} className="text-accent hover:underline">
                    Discord
                  </AtlasLink>
                )}
              </Row>
            ),
          )}
          {emergency.map((em) => (
            <Row key={em.docId} label={SCOPE_LABEL[em.scope] ?? "Emergency"}>
              <AtlasLink to={atlasHref(em.docId)} className="text-accent hover:underline">
                {em.status === "placeholder" ? "Not yet specified" : "Response protocol"}
              </AtlasLink>
            </Row>
          ))}
        </tbody>
      </table>
    </section>
  );
}
