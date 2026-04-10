import { useState, useEffect, useRef, useMemo } from "react";
import { prepare, layout } from "@chenglou/pretext";
import { ScopeNode } from "./ScopeNode";
import { RelatedNode } from "./RelatedNode";
import { AddressCard } from "./AddressCard";
import { loadAtlas } from "../lib/docs";
import { loadAddresses } from "../lib/addresses";
import { loadChainState, type ChainValue } from "../lib/chainstate";
import { setAddressMap } from "./NodeContent";
import { realDepth, type AtlasNode, type AddressInfo } from "../types";

// --- Breadcrumb helpers ---

const STOP_WORDS = /\b(the|a|of|an|and|or|for|in|on|to|at|by|with|from)\b/gi;

const ABBREVIATIONS: Record<string, string> = {
  directory: "Dir.",
  directories: "Dirs.",
  document: "Doc.",
  documents: "Docs.",
  configuration: "Config.",
  configurations: "Configs.",
  specification: "Spec.",
  specifications: "Specs.",
  controller: "Ctrl.",
  controllers: "Ctrls.",
  primitives: "Prims.",
  primitive: "Prim.",
  instances: "Inst.",
  instance: "Inst.",
  artifacts: "Artfcts.",
  properties: "Props.",
  property: "Prop.",
  governance: "Gov.",
  definition: "Def.",
  definitions: "Defs.",
  ecosystem: "Eco.",
  implementation: "Impl.",
  implementations: "Impls.",
  transformation: "Xform.",
  transformations: "Xforms.",
  transitionary: "Trans.",
  customizations: "Customs.",
  customization: "Custom.",
  accessibility: "A11y.",
  reimbursement: "Reimb.",
  communication: "Comms.",
  communications: "Comms.",
  responsibilities: "Resps.",
  responsibility: "Resp.",
  authorization: "Auth.",
  infrastructure: "Infra.",
  determination: "Determ.",
  administrative: "Admin.",
  accountability: "Acctbl.",
  reconciliation: "Recon.",
  documentation: "Docs.",
  identification: "Ident.",
  interpolation: "Interp.",
  participation: "Partic.",
  representation: "Rep.",
  classification: "Class.",
  incorporation: "Incorp.",
  consolidation: "Consol.",
  qualification: "Qual.",
  organizational: "Org.",
  comprehensive: "Compr.",
  bootstrapping: "Bootstrap.",
  distribution: "Distrib.",
  management: "Mgmt.",
  operational: "Oper.",
  parameters: "Params.",
  parameter: "Param.",
  collateral: "Collat.",
  foundation: "Fndn.",
  information: "Info.",
  transaction: "Txn.",
  transactions: "Txns.",
  integration: "Integ.",
  integrations: "Integs.",
  requirements: "Reqs.",
  requirement: "Req.",
  environment: "Env.",
  application: "App.",
  applications: "Apps.",
  verification: "Verif.",
  notification: "Notif.",
  notifications: "Notifs.",
};

function shortenTitle(title: string, maxChars: number, abbrRatio = 0.5): string {
  // Drop stop words
  let t = title.replace(STOP_WORDS, "").replace(/\s{2,}/g, " ").trim();
  // Abbreviate words (longest first for max savings)
  const words = t.split(" ");
  const maxAbbrev = Math.max(1, Math.floor(words.length * abbrRatio));
  let abbrCount = 0;
  const candidates = words
    .map((w, i) => ({ i, w, abbr: ABBREVIATIONS[w.toLowerCase()] }))
    .filter((c) => c.abbr)
    .sort((a, b) => b.w.length - a.w.length);
  for (const c of candidates) {
    if (abbrCount >= maxAbbrev) break;
    words[c.i] = c.abbr;
    abbrCount++;
  }
  t = words.join(" ");
  if (t.length > maxChars) {
    t = t.slice(0, maxChars - 1) + "…";
  }
  return t;
}

const BREADCRUMB_FONT = "12px 'Source Code Pro', monospace";
const SEPARATOR = " / ";

/** Use pretext to measure total breadcrumb width and progressively shorten until it fits. */
function fitBreadcrumbs(titles: string[], availableWidth: number): string[] {
  if (titles.length <= 2) {
    // Normal mode: no shortening
    return titles
  }
  if (titles.length <= 4) {
    // some shortening
    return titles.map((t) => shortenTitle(t, 48, 0.33));
  }
  if (titles.length <= 6) {
    // Normal mode: standard shortening
    return titles.map((t) => shortenTitle(t, 36, 0.66));
  }
  debugger
  // Start aggressive: try decreasing maxChars and increasing abbr ratio
  const steps: Array<{ maxChars: number; abbrRatio: number }> = [
    { maxChars: 26, abbrRatio: 0.66 },
    { maxChars: 22, abbrRatio: 0.8 },
    { maxChars: 16, abbrRatio: 1.0 },
    { maxChars: 10, abbrRatio: 1.0 },
    { maxChars: 8, abbrRatio: 1.0 },
  ];

  for (const { maxChars, abbrRatio } of steps) {
    const shortened = titles.map((t) => shortenTitle(t, maxChars, abbrRatio));
    const fullText = shortened.join(SEPARATOR);
    const prepared = prepare(fullText, BREADCRUMB_FONT);
    const { lineCount } = layout(prepared, availableWidth, 16);
    if (lineCount <= 1) return shortened;
  }

  // Last resort: already at minimum
  return titles.map((t) => shortenTitle(t, 6, 1.0));
}

function buildAncestors(docs: Record<string, AtlasNode>, docNoToId: Map<string, string>, nodeId: string): AtlasNode[] {
  const node = docs[nodeId];
  if (!node || node.doc_no.startsWith("NR-")) return [];
  const ancestors: AtlasNode[] = [];
  const parts = node.doc_no.split(".");
  // Walk from root toward the node, building each ancestor's doc_no
  // A.1.2.3 → ancestors are A.1, A.1.2
  for (let i = 2; i < parts.length; i++) {
    const ancestorDocNo = parts.slice(0, i).join(".");
    const aid = docNoToId.get(ancestorDocNo);
    if (aid && docs[aid]) ancestors.push(docs[aid]);
  }
  return ancestors;
}

function depthColor(depth: number): string {
  if (depth <= 1) return "var(--depth-1)";
  if (depth >= 17) return "var(--depth-17)";
  return `var(--depth-${depth})`;
}

// --- End breadcrumb helpers ---

// Extract UUIDs from markdown links in content: [text](uuid)
const UUID_LINK_RE = /\[[^\]]+\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

function extractLinkedIds(node: AtlasNode): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of node.content.matchAll(UUID_LINK_RE)) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  return ids;
}

interface DetailState {
  loaded: boolean;
  ancestors: AtlasNode[];
  scopeNodes: AtlasNode[];
  linkedNodes: AtlasNode[];
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
}

const INITIAL: DetailState = { loaded: false, ancestors: [], scopeNodes: [], linkedNodes: [], targetAddresses: {}, chainValues: {} };

export function NodeDetail({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
  const [state, setState] = useState<DetailState>(INITIAL);
  const [breadcrumbWidth, setBreadcrumbWidth] = useState(1000);
  const breadcrumbRef = useRef<HTMLElement>(null);

  // Track breadcrumb container width
  useEffect(() => {
    const el = breadcrumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBreadcrumbWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadAtlas(), loadAddresses(), loadChainState()]).then(([{ docs, byParent, docNoToId }, addresses, chainState]) => {
      if (cancelled) return;

      // Push the shared address map into NodeContent's module-level lookup so
      // its rehype plugin can resolve explorer URLs. Idempotent.
      setAddressMap(addresses);

      const target = docs[id];
      if (!target) { setState({ ...INITIAL, loaded: true }); return; }

      const ancestors = buildAncestors(docs, docNoToId, id);
      const parent = target.parentId ? docs[target.parentId] ?? null : null;

      // Siblings: same parentId, already sorted by `order` in the prebuilt index.
      const siblings = byParent.get(target.parentId) ?? [];
      const idx = siblings.indexOf(target);
      const above = idx > 0 ? siblings.slice(0, idx) : [];
      const below = idx >= 0 ? siblings.slice(idx + 1) : [];

      // Direct children of target — also pre-sorted.
      const children = byParent.get(target.id) ?? [];

      // Display order: parent → above siblings → target → children → below siblings
      const scopeNodes: AtlasNode[] = [];
      if (parent) scopeNodes.push(parent);
      scopeNodes.push(...above, target, ...children, ...below);

      const linkedNodes = extractLinkedIds(target)
        .map((lid) => docs[lid])
        .filter((n): n is AtlasNode => !!n);

      // Join target's addressRefs against the shared address map and chain state
      const targetAddresses: Record<string, AddressInfo> = {};
      const chainValues: Record<string, Record<string, ChainValue>> = {};
      for (const ref of target.addressRefs ?? []) {
        const info = addresses[ref];
        if (info) targetAddresses[ref] = info;
        const cv = chainState.values[ref];
        if (cv) chainValues[ref] = cv;
      }

      setState({ loaded: true, ancestors, scopeNodes, linkedNodes, targetAddresses, chainValues });
    });
    return () => { cancelled = true; };
  }, [id]);

  const { loaded, ancestors, scopeNodes, linkedNodes, targetAddresses, chainValues } = state;

  // Fit breadcrumbs to single line when deep (>8 ancestors)
  const fittedTitles = useMemo(() => {
    if (ancestors.length === 0) return [];
    return fitBreadcrumbs(ancestors.map((a) => a.title), breadcrumbWidth - 46); // 46 = paddingLeft + paddingRight
  }, [ancestors, breadcrumbWidth]);

  if (!loaded) {
    return (
      <div className="flex-1 flex items-center justify-center py-24 text-sm" style={{ color: "var(--gray)" }}>
        Loading…
      </div>
    );
  }

  if (scopeNodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 text-sm" style={{ color: "var(--red)" }}>
        Node not found: {id}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
      {/* Breadcrumb — fixed strip below search bar */}
      {ancestors.length > 0 && (
        <nav
          ref={breadcrumbRef}
          className={`flex items-center gap-x-1 text-xs mono ${ancestors.length > 6 ? "" : "flex-wrap"}`}
          style={{ color: "var(--tan-3)", paddingLeft: 30, paddingRight: 16, paddingTop: 6, paddingBottom: 6, borderBottom: "1px solid var(--border)", background: "var(--bg)", overflow: "hidden", whiteSpace: ancestors.length > 6 ? "nowrap" : undefined }}
        >
          {ancestors.map((a, i) => (
            <span key={a.id} className="flex items-center gap-x-1">
              {i > 0 && <span style={{ color: "var(--tan-3)" }}>/</span>}
              <a
                href={`${import.meta.env.BASE_URL}?id=${a.id}`}
                onClick={(e) => { e.preventDefault(); onNavigate(a.id); }}
                className="breadcrumb-link"
                style={{ "--crumb-color": depthColor(realDepth(a.doc_no)) } as React.CSSProperties}
              >
                <span className="short">{fittedTitles[i] ?? a.title}</span>
                <span className="full">{a.title}</span>
              </a>
            </span>
          ))}
        </nav>
      )}

      {/* Content grid */}
      <div className="flex-1 lg:grid lg:grid-cols-[3fr_2fr]" style={{ minHeight: 0, overflow: "hidden" }}>
      {/* Left — context */}
      <div className="overflow-y-auto" style={{ borderRight: "1px solid var(--border)" }}>
        <div className="max-w-2xl mx-auto px-4 py-6">
          {scopeNodes.map((node) => (
            <ScopeNode key={node.id} node={node} isTarget={node.id === id} onNavigate={onNavigate} />
          ))}
        </div>
      </div>

      {/* Right — annotations: linked nodes on top, addresses below */}
      <div className="overflow-y-auto hidden lg:block">
        <div className="px-4 py-6">
          {linkedNodes.length > 0 ? (
            <>
              <p className="text-xs mono mb-4" style={{ color: "var(--tan-3)" }}>
                annotations · {linkedNodes.length} linked node{linkedNodes.length !== 1 ? "s" : ""}
              </p>
              {linkedNodes.map((node) => (
                <RelatedNode key={node.id} node={node} onNavigate={onNavigate} />
              ))}
            </>
          ) : (
            <p className="text-xs mono" style={{ color: "var(--tan-3)" }}>
              annotations · no linked nodes
            </p>
          )}

          {Object.keys(targetAddresses).length > 0 && (
            <div className="mt-8">
              <p className="text-xs mono mb-4" style={{ color: "var(--tan-3)" }}>
                addresses · {Object.keys(targetAddresses).length}
              </p>
              {Object.entries(targetAddresses).map(([address, info]) => (
                <AddressCard key={address} address={address} info={info} chainValues={chainValues[address]} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
