/** Semantic depth per Atlas spec. Handles supporting doc patterns (.0.3, .0.4, .0.6, .1.X, .varX).
 *  NR-X (Needed Research) nodes need parentDocNo to resolve depth (parent + 1). */
export function realDepth(doc_no: string, parentDocNo?: string): number {
  if (doc_no.startsWith("NR-")) return parentDocNo ? realDepth(parentDocNo) + 1 : 1;
  const parts = doc_no.split(".");

  // .varX → parent depth + 1
  const varIdx = parts.findIndex((p) => p.startsWith("var"));
  if (varIdx >= 0) return realDepth(parts.slice(0, varIdx).join(".")) + 1;

  // Find last supporting-doc directory marker: .0.3 / .0.4 / .0.6
  let markerIdx = -1;
  for (let i = 1; i < parts.length - 1; i++) {
    if (parts[i] === "0" && (parts[i + 1] === "3" || parts[i + 1] === "4" || parts[i + 1] === "6")) {
      markerIdx = i;
    }
  }

  if (markerIdx >= 0) {
    const targetDepth = markerIdx - 1; // segments before marker, minus A prefix
    const supportingIdx = markerIdx + 2; // index of the instance number
    const baseDepth = targetDepth + 1;
    // Scenario nesting after instance: each .1.X pair = +1 level
    const after = parts.slice(supportingIdx + 1);
    let extra = 0;
    let i = 0;
    while (i < after.length) {
      if (after[i] === "1" && i + 1 < after.length) {
        extra++; i += 2;
      } else {
        extra++; i++;
      }
    }
    return baseDepth + extra;
  }

  // Regular document: segments - 1 (A prefix doesn't count)
  return parts.length - 1;
}

/** Returns semantic depth for each segment of a doc_no (for per-segment coloring).
 *  Regular segments get incrementing depths. Directory markers (.0.3, .0.4, .0.6)
 *  and their instances share the supporting doc's depth. Scenario .1.X pairs share one depth. */
export function segmentDepths(doc_no: string): number[] {
  if (doc_no.startsWith("NR-")) return [1];
  const parts = doc_no.split(".");
  const depths: number[] = new Array(parts.length).fill(0);

  let curDepth = 0;
  let inTenet = false; // track if we just processed a .0.4.X tenet group
  let i = 0;
  while (i < parts.length) {
    // .varX → same depth as parent scenario
    if (parts[i].startsWith("var")) {
      curDepth++;
      depths[i] = curDepth;
      inTenet = false;
      i++;
      continue;
    }
    // .0.{3|4|6}.X directory pattern
    if (parts[i] === "0" && i + 2 < parts.length && (parts[i + 1] === "3" || parts[i + 1] === "4" || parts[i + 1] === "6")) {
      curDepth++;
      depths[i] = curDepth;
      depths[i + 1] = curDepth;
      depths[i + 2] = curDepth;
      inTenet = parts[i + 1] === "4"; // only .0.4 enables scenario nesting
      i += 3;
      continue;
    }
    // .1.X scenario pattern — only valid immediately after a tenet (.0.4.X) group
    if (inTenet && parts[i] === "1" && i + 1 < parts.length) {
      curDepth++;
      depths[i] = curDepth;
      depths[i + 1] = curDepth;
      inTenet = false; // scenarios don't nest further via .1.X
      i += 2;
      continue;
    }
    // Regular segment
    if (i === 0) {
      depths[i] = 0; // A prefix
    } else {
      curDepth++;
      depths[i] = curDepth;
    }
    inTenet = false;
    i++;
  }
  return depths;
}

export interface AtlasNode {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  parentId: string | null;
  content: string;
  order: number; // parse order, used for sorting within a scope
  addressRefs: string[]; // normalized address keys; resolved via loadAddresses()
}

export interface AddressInfo {
  chain: string;
  explorerUrl: string;
  label: string | null;     // resolved by chainlogId > atlas entityLabel > etherscan ContractName
  chainlogId?: string;      // mainnet only
  etherscanName?: string;   // verified contract name
  isContract: boolean;      // false for unverified contracts and EOAs
  isProxy: boolean;
  implementation?: string;  // lowercase address, only when isProxy
  roles: string[];          // multi-label tags from build-index.mjs ROLE_VOCAB
  aliases: string[];        // other labels found for this address (atlas + losing candidates)
  expectedTokens: string[]; // text-derived guess at which ERC20s to query
}

export interface SearchHit {
  id: string;
  score: number;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  parentId: string | null;
  snippet: string; // highlighted HTML snippet from content
  titleHtml: string; // highlighted HTML title
  matchReason: string; // why this result was included, e.g. "title + content"
  chainlogId?: string; // set when result was found via chainlog reverse-lookup
  chainlogAddress?: string; // the resolved address for chainlog matches
}

// Worker message types
export type WorkerInMessage =
  | { type: "query"; id: number; q: string }
  | { type: "ping" };

export type WorkerOutMessage =
  | { type: "ready" }
  | { type: "results"; id: number; hits: SearchHit[]; durationMs: number }
  | { type: "error"; id: number; message: string };
