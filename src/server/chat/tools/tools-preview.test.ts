// The preview tools' result builders against a fake bundle on disk: shapes,
// doc_no order, paging, cite links, the removed list (and its absence on older
// bundles), and the source_class marker the verifier keys on. Opening a
// preview — who may see what — is tool-access.test.ts's job.
import { test, expect, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { previewPaths, type PreviewMeta } from "../../preview/cache.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { AtlasNode } from "../../../types.ts";
import { buildPreviewDiff } from "./tools-preview-diff.ts";
import { buildPreviewGet } from "./tools-preview-get.ts";

const SHA = "9e".repeat(20);
const P = "00000000-0000-4000-8000-0000000000aa";
const KEPT = "00000000-0000-4000-8000-000000000001";
const ADDED = "00000000-0000-4000-8000-000000000002";
const GONE = "00000000-0000-4000-8000-000000000003";
const ADDED2 = "00000000-0000-4000-8000-000000000004";

const node = (id: string, doc_no: string, title: string, content: string, parentId: string | null = P): AtlasNode => ({
  id, doc_no, title, type: "Core", depth: 2, parentId, content, order: Number(doc_no.split(".").pop()), addressRefs: [],
});
const parent = node(P, "A.1", "Parent", "", null);
const live = [parent, node(KEPT, "A.1.10", "Kept", "old text"), node(GONE, "A.1.3", "Gone", "bye")];
const head = [parent, node(KEPT, "A.1.10", "Kept", "new text"), node(ADDED, "A.1.2", "Added", "hello"), node(ADDED2, "A.1.11", "Added too", "x")];

const ix = { docMap: new Map(live.map((n) => [n.id, n])), meta: { atlasCommit: "abcdef1234" } } as unknown as Indexes;
const meta = { sha: SHA, repo: "sky-ecosystem/next-gen-atlas", ref: "pull-5", kind: "pr", prNumber: 5, prTitle: "Tweak", prAuthor: "amy", resolvedAt: "", docCount: 4, buildMs: 1 } as PreviewMeta;
const open = { status: "ready" as const, id: "pull-5", sha: SHA, meta };

const out = previewPaths(SHA).outDir;
function writeBundle(withRemoved: boolean) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "docs.json"), JSON.stringify({ atlasCommit: SHA, nodes: Object.fromEntries(head.map((n) => [n.id, n])) }));
  const diff = { added: [ADDED, ADDED2], changed: [KEPT], renumbered: {}, retitled: {}, reusedSlot: {}, identitySwap: {}, formerUuid: {} };
  fs.writeFileSync(path.join(out, "diff.json"), JSON.stringify(withRemoved ? { ...diff, removed: [GONE] } : diff));
  fs.writeFileSync(path.join(out, "patches.json"), JSON.stringify({ [KEPT]: [["~", [["-", "old"], ["+", "new"], ["=", " text"]]]], [ADDED]: [["+", "hello"]] }));
}
writeBundle(true);
afterAll(() => fs.rmSync(previewPaths(SHA).dir, { recursive: true, force: true }));

const diffArgs = { offset: 0, limit: 40, patch_lines: 12 };

test("diff: source_class leads, counts, doc_no order, cite forms", () => {
  const r = buildPreviewDiff(ix, open, diffArgs) as any;
  expect(Object.keys(r)[0]).toBe("source_class");
  expect(r.source_class).toBe("preview");
  expect(r.counts).toMatchObject({ added: 2, changed: 1, removed: 1 });
  expect(r.documents.map((d: any) => d.doc_no)).toEqual(["A.1.2", "A.1.3", "A.1.10", "A.1.11"]);
  const byId = Object.fromEntries(r.documents.map((d: any) => [d.id, d]));
  expect(byId[ADDED].cite).toBe(`/preview/${SHA}/atlas?id=${ADDED}`);
  expect(byId[GONE]).toMatchObject({ change: "removed", title: "Gone", cite: `/atlas/${GONE}` });
  // An in-line edit is whole old line, then whole new line, never word markup.
  expect(byId[KEPT].patch).toEqual(["- old text", "+ new text"]);
  expect(byId[ADDED].parent).toEqual({ id: P, doc_no: "A.1", title: "Parent" });
  expect(r.preview).toMatchObject({ id: "pull-5", pr: { number: 5, title: "Tweak" }, base: { label: "live atlas" } });
  expect(r.citation_note).toContain("/preview/");
});

test("diff: paging and the change filter", () => {
  const p1 = buildPreviewDiff(ix, open, { ...diffArgs, limit: 2 }) as any;
  expect(p1.documents).toHaveLength(2);
  expect(p1).toMatchObject({ has_more: true, next_offset: 2 });
  const p2 = buildPreviewDiff(ix, open, { ...diffArgs, offset: 2, limit: 2 }) as any;
  expect(p2.has_more).toBe(false);
  const added = buildPreviewDiff(ix, open, { ...diffArgs, change: "added" }) as any;
  expect(added.documents.map((d: any) => d.id)).toEqual([ADDED, ADDED2]);
  expect((buildPreviewDiff(ix, open, { ...diffArgs, patch_lines: 0 }) as any).documents.some((d: any) => d.patch)).toBe(false);
});

test("diff: a bundle without a recorded removed list says so instead of claiming zero", () => {
  writeBundle(false);
  try {
    const r = buildPreviewDiff(ix, open, diffArgs) as any;
    expect(r.counts.removed).toBeNull();
    expect(r.removed_note).toBeTruthy();
  } finally {
    writeBundle(true);
  }
});

test("get: by uuid or the preview's doc_no, with live text for comparison", () => {
  const r = buildPreviewGet(ix, open, { ids: [KEPT, "A.1.2", "Z.9"], include_base: true, include_children: false }) as any;
  expect(r.source_class).toBe("preview");
  expect(r.not_found).toEqual(["Z.9"]);
  const [kept, added] = r.documents;
  expect(kept).toMatchObject({ status: "changed", content: "new text", base: { content: "old text", source: "live atlas abcdef1" } });
  expect(kept.ancestors).toEqual([{ doc_no: "A.1", title: "Parent" }]);
  expect(added).toMatchObject({ status: "added", content: "hello", cite: `/preview/${SHA}/atlas?id=${ADDED}` });
  expect(added.base).toBeUndefined();
  expect(r.style_hint).toContain("atlas_filter");
});

test("get: children on request", () => {
  const r = buildPreviewGet(ix, open, { ids: ["A.1"], include_base: false, include_children: true }) as any;
  expect(r.documents[0].children.map((c: any) => c.doc_no)).toEqual(["A.1.2", "A.1.10", "A.1.11"]);
});
