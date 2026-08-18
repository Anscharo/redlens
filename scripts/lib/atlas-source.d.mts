// Types for atlas-source.mjs — the build pipeline is plain ESM JS, but the
// preview server (TypeScript) imports the same loader so a preview and a real
// build can never disagree about what a checkout contains.

export declare const LAYOUT: {
  readonly MONOLITH: "monolith";
  readonly ATOMIZED: "atomized";
  readonly CONSOLIDATED: "consolidated";
};

export type AtlasLayout = "monolith" | "atomized" | "consolidated";

export declare class AtlasSourceError extends Error {}

export declare const MONOLITH_REL: string;
export declare const CONTENT_REL: string;
export declare const MIN_NODES_DEFAULT: number;

export declare function bucketFromFilename(name: string): string | null;
export declare function bucketOrderKey(bucket: string): number[];
export declare function compareBuckets(a: string, b: string): number;
export declare function listBuckets(contentRoot: string): { bucket: string; file: string }[];
export declare function readConsolidated(contentRoot: string): string;
export declare function detectLayout(atlasSrcDir: string): AtlasLayout;

export interface AtlasSourceNode {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  parentId: string | null;
  order: number;
  content: string;
  contentHash: string;
}

export declare function loadAtlasSource(
  atlasSrcDir: string,
  opts?: { minNodes?: number },
): { layout: AtlasLayout; nodes: AtlasSourceNode[]; nodeMap: Record<string, AtlasSourceNode> };
