// Types for atlas-parser.mjs: the build pipeline is plain ESM JS, but TypeScript
// reads its heading grammar too (atlas-git-parse.ts, and through it the preview
// server), so the history walk and the build can never disagree about a heading.

export declare function sha256(s: string): string;

/** `## A.0.1 - Title [Type]  <!-- UUID: <uuid> -->` → [, hashes, doc_no, title, type, uuid]. */
export declare const HEADING_RE: RegExp;

export declare const KNOWN_DOC_TYPES: Set<string>;

export interface ParsedNode {
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

export declare function parse(src: string): { nodes: ParsedNode[]; nodeMap: Record<string, ParsedNode> };

export declare function unquoteYamlName(s: string): string;

export declare function computeLevels(
  docs: { uuid: string; doc_no: string; targets: string[]; folderPath: string[] }[],
  contentRoot: string,
): Map<string, number>;

export declare function parseTree(contentRoot: string): { nodes: ParsedNode[]; nodeMap: Record<string, ParsedNode> };

export declare function cleanContent(lines: string[]): string;
