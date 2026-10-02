// Per-document version rows (scripts/lib/doc-versions.mjs): one row per change
// of a document's fingerprint, one null row per removal, nothing otherwise.
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types
import { fingerprintSnapshot, versionRows } from "../scripts/lib/doc-versions.mjs";
// @ts-expect-error — .mjs without types
import { gitEntryFingerprint } from "../scripts/lib/doc-fingerprint.mjs";

const C = { sha: "c".repeat(40), seq: 42 };
const entry = (doc_no: string, title: string, content: string) => ({ doc_no, title, content, path: "content/A.1 - X.md" });

describe("fingerprintSnapshot", () => {
  it("maps every document to its cleaned-content fingerprint", () => {
    const snap = new Map([["u1", entry("A.1", "One", "body")]]);
    expect([...fingerprintSnapshot(snap)]).toEqual([["u1", gitEntryFingerprint(entry("A.1", "One", "body"))]]);
  });
});

describe("versionRows", () => {
  const prev = fingerprintSnapshot(
    new Map([
      ["kept", entry("A.1", "Kept", "same")],
      ["edited", entry("A.2", "Edited", "before")],
      ["renumbered", entry("A.3", "Renumbered", "same body")],
      ["gone", entry("A.4", "Gone", "bye")],
    ]),
  );
  const curr = fingerprintSnapshot(
    new Map([
      ["kept", entry("A.1", "Kept", "same")],
      ["edited", entry("A.2", "Edited", "after")],
      // A pure renumbering: no body change, no path change — no history EVENT in
      // the consolidated layout, which is why versions are not read off events.
      ["renumbered", entry("A.9", "Renumbered", "same body")],
      ["new", entry("A.5", "New", "hello")],
    ]),
  );

  it("emits a row for an edit, a renumbering and an addition — and none for an untouched document", () => {
    const rows = versionRows(prev, curr, C);
    const byId = new Map(rows.map((r: { doc_id: string }) => [r.doc_id, r]));
    expect([...byId.keys()].sort()).toEqual(["edited", "gone", "new", "renumbered"]);
    for (const id of ["edited", "renumbered", "new"]) {
      expect(byId.get(id)).toEqual({ doc_id: id, commit_seq: 42, commit_sha: C.sha, fingerprint: curr.get(id) });
    }
  });

  it("records a removal as a null fingerprint — it closes the document's last interval", () => {
    const gone = versionRows(prev, curr, C).find((r: { doc_id: string }) => r.doc_id === "gone");
    expect(gone).toEqual({ doc_id: "gone", commit_seq: 42, commit_sha: C.sha, fingerprint: null });
  });

  it("a commit that changes no document yields no rows; the first commit yields one per document", () => {
    expect(versionRows(curr, curr, C)).toEqual([]);
    expect(versionRows(new Map(), curr, C)).toHaveLength(curr.size);
  });
});
