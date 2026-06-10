// sync:history-pg — upsert atlas_history from public/history/<uuid>.json files.
// Includes the diff JSONB column (sync.ts intentionally excluded it; this script
// is the canonical history sink now that history JSON files are no longer committed).
//
//   bun src/server/sync-history-pg.ts            # upsert only new/changed rows
//   bun src/server/sync-history-pg.ts --force    # upsert all rows unconditionally
//
// Reads: public/history/<uuid>.json (per-node history arrays)
// Writes: atlas_history (doc_id, commit_sha, change_type as natural key)
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { sql, waitForDb } from "./db.ts";
import { config } from "./config.ts";
import { runMigrations } from "./migrate.ts";
import { UUID_RE } from "../lib/patterns.ts";

const pub = (f: string) => join(config.publicDir, f);

// chatbot-plan vocabulary: the frontend uses modified/moved; Postgres stores content/structural.
const CHANGE_TYPE_MAP: Record<string, string> = { modified: "content", moved: "structural" };

// Topological commit order (oldest = 1) from the submodule git log.
function gitCommitSeq(): Map<string, number> {
  try {
    const out = execSync("git log --reverse --format=%H", {
      cwd: join(config.root, "vendor/next-gen-atlas"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = new Map<string, number>();
    out.trim().split("\n").forEach((h, i) => h && m.set(h.slice(0, 7), i + 1));
    return m;
  } catch {
    return new Map();
  }
}

interface HistRow {
  doc_id: string;
  commit_sha: string;
  committed_at: string | null;
  commit_seq: number | null;
  pr_number: number | null;
  pr_title: string | null;
  pr_url: string | null;
  pr_author: string | null;
  summary: string | null;
  description: string | null;
  moved_from: string | null;
  moved_to: string | null;
  change_type: string;
  diff: unknown | null;
}

const HISTORY_COLS = [
  "doc_id", "commit_sha", "committed_at", "commit_seq", "pr_number", "pr_title", "pr_url",
  "pr_author", "summary", "description", "moved_from", "moved_to", "change_type", "diff",
] as const;

async function chunked<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

async function main() {
  await waitForDb();
  await runMigrations();

  const dir = pub("history");
  if (!existsSync(dir)) {
    console.log("sync:history-pg — no public/history/ directory, nothing to sync");
    await sql.end();
    return;
  }

  const seqByCommit = gitCommitSeq();
  const files = readdirSync(dir).filter((f) => UUID_RE.test(f.replace(/\.json$/, "")));

  const rows: HistRow[] = [];
  for (const f of files) {
    const docId = f.replace(/\.json$/, "");
    let events: Array<{
      date?: string; commitHash?: string; changeType?: string; pr?: number;
      prTitle?: string; prUrl?: string; prAuthor?: string; summary?: string;
      description?: string; movedFrom?: string; movedTo?: string; diff?: unknown;
    }>;
    try {
      events = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      continue;
    }
    for (const e of events) {
      if (!e.commitHash || !e.changeType) continue;
      rows.push({
        doc_id: docId,
        commit_sha: e.commitHash,
        committed_at: e.date ?? null,
        commit_seq: seqByCommit.get(e.commitHash) ?? null,
        pr_number: e.pr ?? null,
        pr_title: e.prTitle ?? null,
        pr_url: e.prUrl ?? null,
        pr_author: e.prAuthor ?? null,
        summary: e.summary ?? null,
        description: e.description ?? null,
        moved_from: e.movedFrom ?? null,
        moved_to: e.movedTo ?? null,
        change_type: CHANGE_TYPE_MAP[e.changeType] ?? e.changeType,
        diff: e.diff ?? null,
      });
    }
  }

  if (rows.length === 0) {
    console.log("sync:history-pg — 0 rows to upsert");
    await sql.end();
    return;
  }

  console.log(`sync:history-pg — upserting ${rows.length} rows from ${files.length} nodes`);

  // `diff` is JSONB. Build the INSERT by hand so the placeholder carries an
  // explicit `$N::jsonb` cast and the RAW JS value is passed through — Bun.sql
  // JSON-encodes it once for the cast. Pre-stringifying (the old approach) made
  // Bun encode the string a second time, storing a jsonb *string scalar* that
  // read back as a string and crashed the diff renderer. Mirrors sync.ts.
  const setClause = HISTORY_COLS.filter((c) => c !== "doc_id" && c !== "commit_sha" && c !== "change_type")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");

  await chunked(rows, 1000, async (chunk) => {
    const params: unknown[] = [];
    const valuesSql = chunk
      .map((r) => {
        const ph = HISTORY_COLS.map((c) => {
          params.push((r as Record<string, unknown>)[c]);
          return c === "diff" ? `$${params.length}::jsonb` : `$${params.length}`;
        });
        return `(${ph.join(",")})`;
      })
      .join(",");
    await sql.unsafe(
      `INSERT INTO atlas_history (${HISTORY_COLS.join(",")}) VALUES ${valuesSql}
       ON CONFLICT (doc_id, commit_sha, change_type) DO UPDATE SET ${setClause}`,
      params,
    );
  });

  console.log(`sync:history-pg — done (${rows.length} rows across ${files.length} nodes)`);
  await sql.end();
}

await main();
