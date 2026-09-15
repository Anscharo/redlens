// Pure unit test for the processes report builder. Runs under `bun test` (NOT
// vitest — src/server is excluded there). publicDir is injectable, so
// processes.json is read from a real temp file rather than config.publicDir.
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildProcessesReport } from "./processes.ts";
import type { Indexes, AtlasNode } from "../retrieval/indexes.ts";

function node(id: string, doc_no: string, title: string): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 3, parentId: null, order: 0, content: "", contentHash: `h-${id}`, addressRefs: [] } as AtlasNode;
}

function makeIx(): Indexes {
  const docs = [node("A", "A.1.1", "Onboard a New Facilitator"), node("B", "A.2.1", "Retire a Multisig Signer")];
  const docMap = new Map(docs.map((d) => [d.id, d]));
  return {
    docMap,
    byDocNo: new Map(docs.map((d) => [d.doc_no, d])),
    entities: [],
    edges: [],
    meta: { atlasCommit: "test" },
  } as unknown as Indexes;
}

function withProcessesJson<T>(entries: unknown[], fn: (publicDir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "processes-test-"));
  fs.writeFileSync(path.join(dir, "processes.json"), JSON.stringify(entries));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("buildProcessesReport joins processes.json entries against live doc titles/doc_nos", () => {
  withProcessesJson(
    [
      { uuid: "A", category: "Governance", shape: "inline", status: "active" },
      { uuid: "B", category: "Settlement", shape: "child", status: "deferred-stub" },
    ],
    (publicDir) => {
      const r = buildProcessesReport(makeIx(), {}, publicDir) as any;
      expect(r.report).toBe("processes");
      expect(r.total).toBe(2);
      const a = r.processes.find((p: any) => p.uuid === "A");
      expect(a.docNo).toBe("A.1.1");
      expect(a.title).toBe("Onboard a New Facilitator");
      expect(a.category).toBe("Governance");
    },
  );
});

test("filter scopes rows by title/doc no, same as the report page", () => {
  withProcessesJson(
    [
      { uuid: "A", category: "Governance", shape: "inline", status: "active" },
      { uuid: "B", category: "Settlement", shape: "child", status: "deferred-stub" },
    ],
    (publicDir) => {
      const r = buildProcessesReport(makeIx(), { filter: "Multisig" }, publicDir) as any;
      expect(r.total).toBe(1);
      expect(r.processes[0].uuid).toBe("B");
    },
  );
});

test("a curated entry whose uuid no longer resolves is dropped, not thrown", () => {
  withProcessesJson([{ uuid: "GHOST", category: "Governance", shape: "inline", status: "active" }], (publicDir) => {
    const r = buildProcessesReport(makeIx(), {}, publicDir) as any;
    expect(r.total).toBe(0);
  });
});

test("missing processes.json degrades to zero rows, not a throw", () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "processes-empty-"));
  try {
    const r = buildProcessesReport(makeIx(), {}, emptyDir) as any;
    expect(r.report).toBe("processes");
    expect(r.total).toBe(0);
    expect(r.processes).toEqual([]);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});
