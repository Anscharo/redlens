import { Address } from "../Address";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import type { StoredPauSnapshot } from "../../lib/pau";

const ROLE_LABEL: Record<string, string> = {
  controller: "Controller",
  almProxy: "ALM proxy",
  rateLimits: "Rate limits",
  accessControls: "AccessControls",
  administeredAgent: "AdministeredAgent",
};

const dim = { color: "var(--tan-3)" };

/** Text linked to the first atlas document that states the contract's address (registry provenance), else plain. */
export function AtlasDocLink({ docs, title, className, style, children }: { docs?: string[]; title: string; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  if (!docs?.length) return <span className={className} style={style}>{children}</span>;
  return (
    <AtlasLink to={atlasHref(docs[0])} className={`${className ?? ""} hover:underline`} style={style} title={docs.length > 1 ? `${title} (${docs.length} atlas documents state it)` : title}>
      {children}
    </AtlasLink>
  );
}

/** A deployment's contracts by role, each role linked to the atlas document that states it. */
export function PauContracts({ snap }: { snap: StoredPauSnapshot }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {snap.contracts.map((c) => (
        <li key={c.address} className="mono text-[11px]" style={dim}>
          <AtlasDocLink docs={c.atlasDocs} title="the atlas document stating this contract">{ROLE_LABEL[c.role] ?? c.role}</AtlasDocLink> <Address address={c.address} chain={snap.chain} />
        </li>
      ))}
    </ul>
  );
}
