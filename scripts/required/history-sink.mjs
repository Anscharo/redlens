import fs from "node:fs";
import path from "node:path";
import { sql } from "../../src/server/db.ts";
import {
  eventToRow,
  gitCommitSeq,
  htmlEraRows,
  preEraRows,
  stampMigrationSeam,
  upsertHistory,
} from "../../src/server/history/history-db.ts";

export async function writeDbSink(root, newHistory) {
  const seqByCommit = gitCommitSeq();
  const rows = markdownRows(newHistory, seqByCommit);
  await upsertHistory(sql, rows);
  const html = await writeHtmlEra(root, seqByCommit);
  const pre = await writePreEra(root, seqByCommit);
  await sql.end();
  console.error(dbDone(rows.length, newHistory.size, html, pre));
}

function markdownRows(newHistory, seqByCommit) {
  const rows = [];
  for (const [nodeId, entries] of newHistory) {
    for (const entry of entries) {
      const row = eventToRow(nodeId, entry, seqByCommit);
      if (row) rows.push(row);
    }
  }
  return rows;
}

async function writeHtmlEra(root, seqByCommit) {
  const htmlEraPath = path.join(root, "public/history-html-era.json");
  if (!fs.existsSync(htmlEraPath)) return { count: 0, seam: 0 };
  const artifact = JSON.parse(fs.readFileSync(htmlEraPath, "utf8"));
  const htmlRows = htmlEraRows(artifact, seqByCommit);
  await upsertHistory(sql, htmlRows);
  return { count: htmlRows.length, seam: await stampMigrationSeam(sql, artifact) };
}

async function writePreEra(root, seqByCommit) {
  const preEraPath = path.join(root, "public/history-pre-era.json");
  if (!fs.existsSync(preEraPath)) return { count: 0, superseded: 0 };
  const artifact = JSON.parse(fs.readFileSync(preEraPath, "utf8"));
  const superseded = await deleteSuperseded(artifact.supersedes || []);
  const preRows = preEraRows(artifact, seqByCommit);
  await upsertHistory(sql, preRows);
  return { count: preRows.length, superseded };
}

async function deleteSuperseded(rows) {
  let superseded = 0;
  for (const row of rows) {
    const { count } = await sql`
      DELETE FROM atlas_history
      WHERE doc_id = ${row.docId} AND commit_sha = ${row.commitHash} AND change_type = ${row.changeType}
    `;
    superseded += count ?? 0;
  }
  return superseded;
}

function dbDone(rows, nodes, html, pre) {
  return (
    `\ndone: upserted ${rows} markdown-era change entries across ${nodes} nodes` +
    `${html.count ? ` + ${html.count} html-era rows from the frozen artifact` : ""}` +
    `${html.seam ? ` (seam verdict stamped on ${html.seam} migration rows)` : ""}` +
    `${pre.count ? ` + ${pre.count} pre-git origin rows from the frozen artifact` : ""}` +
    `${pre.superseded ? ` (deleted ${pre.superseded} superseded row(s) first)` : ""} into atlas_history`
  );
}

export function writeJsonSink(outDir, existingManifest, walked) {
  let fileCount = 0;
  for (const [nodeId, entries] of walked.newHistory) if (appendNode(outDir, nodeId, entries)) fileCount++;
  console.error(`\ndone: ${fileCount} node history files updated, ${walked.totalChanges} new change entries`);
  const manifest = { ...existingManifest };
  for (const [nodeId, entries] of walked.newHistory) manifest[nodeId] = (manifest[nodeId] ?? 0) + entries.length;
  fs.writeFileSync(path.join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.error(`manifest: ${Object.keys(manifest).length} nodes with history`);
  fs.writeFileSync(path.join(outDir, "_last_commit.txt"), walked.lastCommitHash);
  console.error(`checkpoint: ${walked.lastCommitHash}`);
}

function appendNode(outDir, nodeId, entries) {
  const filePath = path.join(outDir, `${nodeId}.json`);
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : [];
  const seen = new Set(existing.map((e) => `${e.commitHash}:${e.changeType}`));
  const fresh = entries.filter((e) => !seen.has(`${e.commitHash}:${e.changeType}`));
  if (fresh.length === 0) return false;
  fs.writeFileSync(filePath, JSON.stringify([...existing, ...fresh], null, 2) + "\n");
  return true;
}
