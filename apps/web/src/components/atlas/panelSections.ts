import { useCallback } from "react";
import type { AtlasNode, AddressInfo } from "@/types";
import type { ChainValue } from "../../lib/chainstate";
import type { EdgeResult } from "../../lib/graph";
import type { CousinDoc } from "../../lib/cousins";
import type { GlossaryEntry } from "../../lib/glossary";
import type { AtlasTab } from "../../lib/atlasTab";
import { track } from "../../lib/analytics";

export const SECTION_HEAD = "text-sm mono text-tan-2 font-semibold tracking-wide";

export interface RightPanelProps {
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
  /** Every document, for matching the onchain section's Executive Votes to this one's dated claims. */
  docs: Record<string, AtlasNode>;
}

/** Navigation from the panel, tagged with what was clicked. */
export type Nav = (kind: string, target: string) => void;

export function usePanelNav(onNavigate: (id: string) => void, onNavigateByDocNo: (docNo: string) => void) {
  const nav = useCallback<Nav>((kind, nid) => {
    track("reader_annotation_nav", { kind, node_id: nid });
    onNavigate(nid);
  }, [onNavigate]);
  const navDoc = useCallback<Nav>((kind, docNo) => {
    track("reader_annotation_nav", { kind, doc_no: docNo });
    onNavigateByDocNo(docNo);
  }, [onNavigateByDocNo]);
  return { nav, navDoc };
}

type Edge = EdgeResult["outbound"][number];
export interface PanelRelation {
  edge: Edge;
  isOut: boolean;
}

// Structural and citation edges are not relations: parent_of/mentions/proxies_to
// are shown by the tree and the reader, and cites has its own "cited by" list.
const HIDE = new Set(["parent_of", "mentions", "proxies_to", "cites"]);

// Splits doc `id`'s graph edges into the notes section's cited-by list and its
// relations (both directions, each tagged with its direction once). A relation
// whose far end is the doc itself is dropped, so counts match the rows shown.
export function splitPanelEdges(graphEdges: EdgeResult, id: string): { citedBy: Edge[]; relations: PanelRelation[] } {
  const out = graphEdges.outbound.filter((e) => !HIDE.has(e.e)).map((edge) => ({ edge, isOut: true }));
  const inb = graphEdges.inbound.filter((e) => !HIDE.has(e.e)).map((edge) => ({ edge, isOut: false }));
  return {
    citedBy: graphEdges.inbound.filter((e) => e.e === "cites"),
    relations: [...out, ...inb].filter((rel) => !isSelfRelation(rel, id)),
  };
}

function isSelfRelation({ edge, isOut }: PanelRelation, id: string): boolean {
  const did = isOut ? edge.to_did : edge.from_did;
  return did === id || (isOut ? edge.t : edge.f) === id;
}

/** The relation's far end: its label (a short id when unlabelled) and the doc to
 *  open for it — the doc itself, an entity's defining doc, or null for neither. */
export function relationEnd({ edge: e, isOut }: PanelRelation): { label: string; navId: string | null } {
  const otherId = (isOut ? e.t : e.f) ?? "";
  const label = (isOut ? e.to_label : e.from_label) ?? otherId.slice(0, 8);
  const otherType = isOut ? e.tt : e.ft;
  const navId = otherType === "doc" ? otherId : ((isOut ? e.to_did : e.from_did) ?? null);
  return { label, navId };
}
