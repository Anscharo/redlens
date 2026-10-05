import type { ReactNode } from "react";
import { atlasHref } from "@/lib/routes";
import { track } from "../../lib/analytics";

export interface FindingCiteProps {
  /** The atlas document the finding points at. */
  uuid: string;
  /** Opens that document in the reader. */
  onAtlas: (uuid: string) => void;
  children: ReactNode;
}

// A citation link inside a verify finding: SPA-navigates to the document and
// records the same `chat_citation_click` as an answer citation.
export function FindingCite({ uuid, onAtlas, children }: FindingCiteProps) {
  return (
    <a
      className="rlc-cite"
      href={atlasHref(uuid)}
      onClick={(e) => {
        e.preventDefault();
        track("chat_citation_click", { product: "chat", node_id: uuid });
        onAtlas(uuid);
      }}
    >
      {children}
    </a>
  );
}
