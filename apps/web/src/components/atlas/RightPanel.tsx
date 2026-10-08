import { useCallback, useMemo, type ReactNode } from "react";
import type { AtlasNode, AddressInfo } from "@/types";
import type { ChainValue } from "../../lib/chainstate";
import type { EdgeResult } from "../../lib/graph";
import type { CousinDoc } from "../../lib/cousins";
import type { GlossaryEntry } from "../../lib/glossary";
import { NodeHistory } from "../history/NodeHistory";
import { PreviewHistory } from "../history/PreviewHistory";
import { ErrorBoundary, InlineError } from "../ErrorBoundary";
import { useDataSource } from "../../lib/dataSource";
import { track } from "../../lib/analytics";
import { ATLAS_TABS, type AtlasTab } from "../../lib/atlasTab";
import { PanelNotes } from "./PanelNotes";
import { PanelOnchain } from "./PanelOnchain";
import { PanelGlossary } from "./PanelGlossary";
import { splitPanelEdges } from "./panelSections";
import { useSectionScroll } from "./useSectionScroll";

// A section's title bar: a pill-styled label anchored by a rule across the rest
// of the width, marking the start of a panel section. The active section's bar
// stays highlighted so the selection is always clear.
function SectionDivider({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`rl-section-divider${active ? " rl-section-divider--active" : ""}`}>
      <span className="rl-section-label">{label}</span>
    </div>
  );
}

interface RightPanelProps {
  id: string;
  /** Element Annotations attached to this doc (`<this doc_no>.0.3.N`). */
  annotationDocs: AtlasNode[];
  linkedNodes: AtlasNode[];
  cousinDocs: CousinDoc[];
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
  /** Addresses this section named only by chainlog key, not a 0x literal. */
  byNameOnly?: Set<string>;
  graphEdges: EdgeResult;
  glossaryTerms: GlossaryEntry[][];
  onNavigate: (id: string) => void;
  onNavigateByDocNo: (docNo: string) => void;
  /** The section the pill bar highlights and the scroll area jumps to, driven by
   *  the URL's ?view=. A hidden (empty) section falls back to the first shown one. */
  tab: AtlasTab;
  onTabChange: (t: AtlasTab) => void;
  /** Show self-subscribing selection checkboxes on related cards. The checkbox
   *  state lives in each card's RelatedSelectBox, so a selection toggle doesn't
   *  re-render this panel (or the sibling reader) — only the checkbox itself. */
  selectable?: boolean;
  byParent?: Map<string | null, AtlasNode[]>;
}

export function RightPanel(props: RightPanelProps) {
  const { id, annotationDocs, linkedNodes, cousinDocs, targetAddresses, graphEdges, glossaryTerms, onNavigate, onNavigateByDocNo, tab, onTabChange } = props;
  const { preview } = useDataSource();

  // Navigation from the panel, tagged with what was clicked.
  const nav = useCallback(
    (kind: string, nid: string) => {
      track("reader_annotation_nav", { kind, node_id: nid });
      onNavigate(nid);
    },
    [onNavigate],
  );
  const navDoc = useCallback(
    (kind: string, docNo: string) => {
      track("reader_annotation_nav", { kind, doc_no: docNo });
      onNavigateByDocNo(docNo);
    },
    [onNavigateByDocNo],
  );

  const { citedBy, relations } = useMemo(() => splitPanelEdges(graphEdges), [graphEdges]);
  const addressCount = Object.keys(targetAddresses).length;
  // The relations header counts raw edges, even if every row self-nav-filters out.
  const noteCount = annotationDocs.length + linkedNodes.length + cousinDocs.length + citedBy.length + relations.length;

  // Each section's body, or null when it has nothing to show; history always shows.
  const bodies: Record<AtlasTab, ReactNode> = {
    notes: noteCount > 0 ? (
      <PanelNotes {...props} citedBy={citedBy} relations={relations} onNav={nav} onNavDoc={navDoc} />
    ) : null,
    onchain: addressCount > 0 ? <PanelOnchain {...props} /> : null,
    history: (
      <ErrorBoundary resetKey={id} fallback={(error) => <InlineError error={error} />}>
        {preview ? <PreviewHistory nodeId={id} /> : <NodeHistory nodeId={id} />}
      </ErrorBoundary>
    ),
    glossary: glossaryTerms.length > 0 ? <PanelGlossary glossaryTerms={glossaryTerms} onNav={nav} /> : null,
  };
  const counts: Record<AtlasTab, number> = { notes: noteCount, onchain: addressCount, history: 0, glossary: glossaryTerms.length };
  const shown = ATLAS_TABS.filter((t) => bodies[t] != null);
  const active = shown.includes(tab) ? tab : shown[0];
  const { scrollRef, sectionRefs, selectSection } = useSectionScroll(active, id, onTabChange);

  return (
    <>
      <nav
        className="flex flex-wrap gap-2 border-b shrink-0"
        style={{ borderColor: "var(--border)", padding: "10px 16px" }}
        aria-label="Panel sections"
      >
        {shown.map((t) => (
          <button
            key={t}
            type="button"
            aria-current={active === t ? "true" : undefined}
            data-state={active === t ? "active" : "inactive"}
            onClick={() => selectSection(t)}
            className="right-pill"
          >
            {t}{counts[t] > 0 && <span style={{ marginLeft: 4 }}>· {counts[t]}</span>}
          </button>
        ))}
      </nav>

      <div className="overflow-y-auto flex-1" ref={scrollRef}>
        <div className="px-4 py-5">
          {shown.map((t) => (
            <section
              key={t}
              className="rl-section"
              ref={(el) => { sectionRefs.current[t] = el; }}
              data-testid={`${t}-panel`}
            >
              <SectionDivider label={t} active={active === t} />
              {bodies[t]}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
