import type { AtlasNode } from "@/types";

// Required Omni Documents every Agent Artifact must carry — A.1.14.2.5.1
// (b6e391fa-3265-4694-a835-3231049c2062). Titles match the artifact docs, not
// the spec's "Root Omni Document" paraphrase; the head of the subtree is
// titled "Omni Documents" in every current Prime Artifact.
export const REQUIRED_OMNI_TITLES = {
  root: "Omni Documents",
  govInfo: "Governance Information Unrelated To Root Edit Primitive",
  ecosystemEmergency: "Sky Ecosystem Emergency Response",
  agentEmergency: "Agent-Specific Emergency Response",
} as const;

const CHANNEL_TITLES = new Set(["Sky Forum", "Discord"]);
const PLACEHOLDER_RE = /will be specified in a future iteration/i;
const DIRECTORY_RE = /^(the documents herein|the provisions herein)\b/i;
const RELATING_TO_RE = /\brelating to\s+(.+)/i;
const ABOVE_AT_RE = /\s+above at\s+.+$/i;
/** The load-bearing clause of the current emergency stubs. */
export const FUTURE_ITERATION_ESSENCE = "will be specified in a future iteration";

export interface OmniDocRef {
  id: string;
  docNo: string;
  title: string;
  content: string;
}

export interface ActorOmni {
  root: OmniDocRef | null;
  /** Direct children of the root Omni Document, in parse order. */
  sections: OmniDocRef[];
  /** Governance-info children that aren't forum/discord or placeholder stubs. */
  notes: OmniDocRef[];
  required: {
    root: OmniDocRef | null;
    govInfo: OmniDocRef | null;
    ecosystemEmergency: OmniDocRef | null;
    agentEmergency: OmniDocRef | null;
  };
}

export const EMPTY_OMNI: ActorOmni = {
  root: null,
  sections: [],
  notes: [],
  required: { root: null, govInfo: null, ecosystemEmergency: null, agentEmergency: null },
};

function ref(d: AtlasNode): OmniDocRef {
  return { id: d.id, docNo: d.doc_no, title: d.title, content: d.content ?? "" };
}

function numberedChildren(parent: AtlasNode, docs: Record<string, AtlasNode>): AtlasNode[] {
  // Direct children in the numbering tree (one extra doc_no segment). parentId
  // is flattened at the depth-6 heading cap, so A.6.1.1.X.3.1.N emergencies
  // (7 segments) parent to the Omni Documents node rather than Governance
  // Information — counting segments is the only way to recover the true child
  // list. Not a hardcoded scope prefix: the parent doc_no comes from the node
  // we already resolved.
  const prefix = `${parent.doc_no}.`;
  const segs = parent.doc_no.split(".").length + 1;
  return Object.values(docs)
    .filter((d) => d.doc_no.startsWith(prefix) && d.doc_no.split(".").length === segs)
    .sort((a, b) => a.order - b.order);
}

function byTitle(nodes: AtlasNode[], title: string): AtlasNode | undefined {
  return nodes.find((n) => n.title === title);
}

export function isOmniPlaceholder(content: string): boolean {
  return PLACEHOLDER_RE.test(content);
}

function firstParagraph(content: string): string {
  return content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripDirectory(s: string): string {
  return s
    .replace(/^(the documents herein|the provisions herein)\s+(?:define|specify)\s+/i, "")
    .replace(/^[A-Za-z][\w .'-]*['’]s\s+/u, "")
    .trim();
}

/** Distinctive remainder of a required Omni doc's summary — not the title restatement. */
export function omniEssence(content: string): string | null {
  const t = firstParagraph(content);
  if (!t) return null;
  if (PLACEHOLDER_RE.test(t)) return FUTURE_ITERATION_ESSENCE;

  const operational = sentences(t).find((s) => !DIRECTORY_RE.test(s));
  let pick = operational ?? sentences(t)[0] ?? t;
  pick = pick.replace(ABOVE_AT_RE, "");
  if (DIRECTORY_RE.test(pick)) {
    const relating = pick.match(RELATING_TO_RE);
    pick = relating ? relating[1] : stripDirectory(pick);
  }
  pick = pick.replace(/\.$/, "").trim();
  return pick || null;
}

/** Per-agent Omni Document catalog. Empty when the defining doc has no
 *  "Omni Documents" child — executors/facilitators, or a truncated artifact. */
export function collectActorOmni(
  definingDoc: AtlasNode | null,
  docs: Record<string, AtlasNode>,
): ActorOmni {
  if (!definingDoc) return EMPTY_OMNI;
  const root = byTitle(numberedChildren(definingDoc, docs), REQUIRED_OMNI_TITLES.root);
  if (!root) return EMPTY_OMNI;

  const sections = numberedChildren(root, docs);
  const govInfo = byTitle(sections, REQUIRED_OMNI_TITLES.govInfo);
  const govKids = govInfo ? numberedChildren(govInfo, docs) : [];
  const ecosystemEmergency = byTitle(govKids, REQUIRED_OMNI_TITLES.ecosystemEmergency);
  const agentEmergency = byTitle(govKids, REQUIRED_OMNI_TITLES.agentEmergency);
  const notes = govKids
    .filter((k) => !CHANNEL_TITLES.has(k.title) && !isOmniPlaceholder(k.content ?? ""))
    .map(ref);

  return {
    root: ref(root),
    sections: sections.map(ref),
    notes,
    required: {
      root: ref(root),
      govInfo: govInfo ? ref(govInfo) : null,
      ecosystemEmergency: ecosystemEmergency ? ref(ecosystemEmergency) : null,
      agentEmergency: agentEmergency ? ref(agentEmergency) : null,
    },
  };
}

/** Top-level omni sections that are not the required Governance Information node. */
export function extraOmniSections(omni: ActorOmni): OmniDocRef[] {
  const govId = omni.required.govInfo?.id;
  return govId ? omni.sections.filter((s) => s.id !== govId) : omni.sections;
}

/** The four Omni docs every Prime Artifact must carry (A.1.14.2.5.1), in spec order. */
export function requiredOmniDocs(omni: ActorOmni): OmniDocRef[] {
  const { root, govInfo, ecosystemEmergency, agentEmergency } = omni.required;
  return [root, govInfo, ecosystemEmergency, agentEmergency].filter(
    (d): d is OmniDocRef => d !== null,
  );
}
