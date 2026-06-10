// Regression canaries for `public/history/<uuid>.json`.
//
// These assert load-bearing facts about the built history that we've
// previously fixed bugs in — if a future build regresses any of these the
// suite fails loudly. They depend on a populated public/history/ (build
// with `pnpm build:history` first); the suite no-ops when the directory
// is empty so a fresh clone doesn't fail.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const HISTORY_DIR = path.join(ROOT, "public/history");
const DOCS_PATH = path.join(ROOT, "public/docs.json");
const RELS_PATH = path.join(ROOT, "public/relations.json");

const have =
  fs.existsSync(HISTORY_DIR) &&
  fs.existsSync(DOCS_PATH) &&
  fs.existsSync(path.join(HISTORY_DIR, "_manifest.json"));

interface HistoryEntry {
  date: string;
  commitHash: string;
  changeType: "added" | "modified" | "removed" | "moved";
  pr?: number;
  prTitle?: string;
  summary?: string;
  description?: string;
  changeKind?: "lint" | "typo" | "semantic";
}

function loadEntries(uuid: string): HistoryEntry[] {
  const p = path.join(HISTORY_DIR, `${uuid}.json`);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function* allHistoryFiles() {
  for (const f of fs.readdirSync(HISTORY_DIR)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    yield path.join(HISTORY_DIR, f);
  }
}

const skipIfNoHistory = have ? describe : describe.skip;

skipIfNoHistory("history canaries", () => {
  // ──────────── load-once shared state ────────────
  const docs = have ? JSON.parse(fs.readFileSync(DOCS_PATH, "utf8")).nodes : {};
  const rels = have ? JSON.parse(fs.readFileSync(RELS_PATH, "utf8")) : { entities: [] };

  // doc_no prefix for each prime agent — used to scope per-prime assertions.
  const primePrefix = new Map<string, string>();
  for (const e of rels.entities ?? []) {
    if (e.et !== "agent" || e.st !== "prime" || !e.did) continue;
    const doc = docs[e.did];
    if (doc?.doc_no) primePrefix.set(e.slug, doc.doc_no);
  }

  // ──────────── change-type / migration canaries ────────────
  it("PR #117 (markdown migration) entries are all `moved`, not `added`", () => {
    let added = 0;
    let moved = 0;
    for (const f of allHistoryFiles()) {
      for (const e of JSON.parse(fs.readFileSync(f, "utf8")) as HistoryEntry[]) {
        if (e.commitHash !== "22cc27b") continue;
        if (e.changeType === "added") added++;
        if (e.changeType === "moved") moved++;
      }
    }
    expect(added).toBe(0);
    expect(moved).toBeGreaterThan(7000); // ~7681 docs migrated
  });

  it("atomization commit (15909e5) entries are all `moved`", () => {
    let nonMoved = 0;
    for (const f of allHistoryFiles()) {
      for (const e of JSON.parse(fs.readFileSync(f, "utf8")) as HistoryEntry[]) {
        if (e.commitHash !== "15909e5") continue;
        if (e.changeType !== "moved") nonMoved++;
      }
    }
    expect(nonMoved).toBe(0);
  });

  // ──────────── attribution canaries ────────────
  // Each of these was a false attribution we identified and fixed during the
  // matcher iteration. Locking in so a future change doesn't regress them.

  it("Launch Agent 7 defining doc is tagged with the LA7 bullet for PR #186", () => {
    const la7 = "d0d77316-0b08-447c-b75a-ae7926b07019";
    const entry = loadEntries(la7).find((e) => e.pr === 186);
    expect(entry).toBeDefined();
    expect(entry!.summary).toBe("Add Launch Agent 7 Artifact");
  });

  it("Launch Agent 7 instance docs are not falsely tagged with the Skybase bullet", () => {
    const prefix = primePrefix.get("launch-agent-7");
    expect(prefix).toBeTruthy();
    const bad = "Add Integration Boost Instances To Skybase Artifact";
    let falseAttrs = 0;
    for (const [id, d] of Object.entries(docs)) {
      const doc = d as { doc_no?: string };
      if (!doc.doc_no?.startsWith(prefix + ".")) continue;
      for (const e of loadEntries(id)) {
        if (e.summary === bad) falseAttrs++;
      }
    }
    expect(falseAttrs).toBe(0);
  });

  it("Grove docs are never tagged with a Keel-titled bullet", () => {
    const prefix = primePrefix.get("grove");
    expect(prefix).toBeTruthy();
    let falseAttrs = 0;
    for (const [id, d] of Object.entries(docs)) {
      const doc = d as { doc_no?: string };
      if (!doc.doc_no?.startsWith(prefix + ".")) continue;
      for (const e of loadEntries(id)) {
        if (/\bKeel\b/i.test(e.summary ?? "")) falseAttrs++;
      }
    }
    expect(falseAttrs).toBe(0);
  });

  it("Pattern docs are never tagged with a Grove-titled bullet", () => {
    const prefix = primePrefix.get("pattern");
    expect(prefix).toBeTruthy();
    let falseAttrs = 0;
    for (const [id, d] of Object.entries(docs)) {
      const doc = d as { doc_no?: string };
      if (!doc.doc_no?.startsWith(prefix + ".")) continue;
      for (const e of loadEntries(id)) {
        if (/\bGrove\b/i.test(e.summary ?? "")) falseAttrs++;
      }
    }
    expect(falseAttrs).toBe(0);
  });

  // ──────────── content-cleanliness canaries ────────────
  it("no description carries merge-gate / forum-post boilerplate", () => {
    const offenders: string[] = [];
    for (const f of allHistoryFiles()) {
      for (const e of JSON.parse(fs.readFileSync(f, "utf8")) as HistoryEntry[]) {
        const d = e.description ?? "";
        if (
          /do not (?:merge|post)/i.test(d) ||
          /poll passes/i.test(d) ||
          /originating forum post/i.test(d)
        ) {
          offenders.push(`${path.basename(f)} ${e.commitHash}: ${d.slice(0, 80)}`);
          if (offenders.length >= 5) return; // early-exit so failure stays small
        }
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });

  it("no description is just a bare URL", () => {
    for (const f of allHistoryFiles()) {
      for (const e of JSON.parse(fs.readFileSync(f, "utf8")) as HistoryEntry[]) {
        const d = e.description ?? "";
        if (d && /^\s*https?:\/\/\S+\s*$/.test(d)) {
          expect.fail(`bare URL in description ${path.basename(f)} ${e.commitHash}: ${d}`);
        }
      }
    }
  });

  it("every history file is JSON-parseable and matches the manifest count", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, "_manifest.json"), "utf8"));
    let mismatches = 0;
    for (const f of allHistoryFiles()) {
      const id = path.basename(f, ".json");
      const entries = JSON.parse(fs.readFileSync(f, "utf8"));
      expect(Array.isArray(entries)).toBe(true);
      if (manifest[id] !== entries.length) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  // ──────────── changeKind sanity ────────────
  it("changeKind is only set on `modified` entries", () => {
    let leak = 0;
    for (const f of allHistoryFiles()) {
      for (const e of JSON.parse(fs.readFileSync(f, "utf8")) as HistoryEntry[]) {
        if (e.changeKind && e.changeType !== "modified") leak++;
      }
    }
    expect(leak).toBe(0);
  });

  it("PR #218 (remove whitespace) and #223 (non-breaking space) modified entries are tagged lint", () => {
    let nonLint = 0;
    for (const f of allHistoryFiles()) {
      for (const e of JSON.parse(fs.readFileSync(f, "utf8")) as HistoryEntry[]) {
        if ((e.pr === 218 || e.pr === 223) && e.changeType === "modified") {
          if (e.changeKind !== "lint") nonLint++;
        }
      }
    }
    expect(nonLint).toBe(0);
  });
});
