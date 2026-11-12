import {
  classifyPrTitle,
  cleanDescription,
  matchBulletsToNodes,
  parsePrBullets,
} from "../lib/history-classify.mjs";
import { extractPrNumber, fetchPr } from "../lib/github-pr-cache.mjs";
import { diffSnapshots, eventDiff, snapshotEvents } from "../lib/history-events.ts";
import { BACKFILLED_CHANGE_TYPES } from "../../src/server/history/history-db.ts";

export function prEntryFields(prNum, pr) {
  if (!pr) return prNum ? { pr: prNum } : {};
  const out = { pr: prNum ?? pr.number, prTitle: pr.title, prAuthor: pr.author, prUrl: pr.url };
  if (pr.reviewCount > 0) out.reviewCount = pr.reviewCount;
  if (pr.approvalCount > 0) out.approvalCount = pr.approvalCount;
  if (pr.commentCount > 0) out.commentCount = pr.commentCount;
  return out;
}

export async function walkCommits({ commits, prevSnapshot, startIndex, backfillBelow, lastCommitHash, loadSnapshot, agentNamePrefixes }) {
  const newHistory = new Map();
  let totalChanges = 0;
  let last = lastCommitHash;
  let previous = prevSnapshot;
  for (let i = 0; i < commits.length; i++) {
    const step = await oneCommit({
      commit: commits[i],
      index: startIndex + i,
      progress: `${(((i + 1) / commits.length) * 100).toFixed(0)}%`,
      backfilling: i < backfillBelow,
      previous,
      loadSnapshot,
      agentNamePrefixes,
    });
    previous = step.snapshot;
    last = step.commit.hash;
    for (const entry of step.entries) pushEntry(newHistory, entry);
    totalChanges += step.entries.length;
  }
  return { newHistory, totalChanges, lastCommitHash: last, prevSnapshot: previous };
}

function pushEntry(newHistory, entry) {
  if (!newHistory.has(entry.nodeId)) newHistory.set(entry.nodeId, []);
  newHistory.get(entry.nodeId).push(entry.entry);
}

async function oneCommit({ commit, index, progress, backfilling, previous, loadSnapshot, agentNamePrefixes }) {
  console.error(`[${progress}] ${commit.hash.slice(0, 7)} ${commit.message.slice(0, 60)}`);
  const snapshot = await loadSnapshot(commit.hash);
  const events = commitEvents(previous, snapshot, backfilling, commit.message);
  if (events.length === 0) return { commit, snapshot, entries: [] };
  const entries = await entriesForCommit({ commit, index, backfilling, previous, snapshot, events, agentNamePrefixes });
  return { commit, snapshot, entries };
}

function commitEvents(previous, snapshot, backfilling, message) {
  const changed = diffSnapshots(previous, snapshot);
  const events = snapshotEvents(changed).filter((ev) => !backfilling || BACKFILLED_CHANGE_TYPES.includes(ev.changeType));
  if (/migrate.*to.*markdown/i.test(message) || extractPrNumber(message) === 117) {
    for (const ev of events) if (ev.changeType === "added") ev.changeType = "moved";
  }
  return Object.assign(events, { changed });
}

async function entriesForCommit({ commit, index, backfilling, previous, snapshot, events, agentNamePrefixes }) {
  const prNum = extractPrNumber(commit.message);
  const pr = prNum ? await fetchPr(prNum) : null;
  const matches = bulletMatches(pr, events, events.changed, snapshot, backfilling, agentNamePrefixes);
  return events.map((ev) => ({
    nodeId: ev.node.id,
    entry: historyEntry({ ev, commit, index, previous, snapshot, pr, prNum, matches }),
  }));
}

function bulletMatches(pr, events, changed, snapshot, backfilling, agentNamePrefixes) {
  if (!pr?.body) return { matches: new Map(), inline: false };
  const bullets = parsePrBullets(pr.body);
  if (bullets.length === 0) return { matches: new Map(), inline: false };
  const kept = backfilling ? new Set(events.map((ev) => ev.node.id)) : null;
  const { added, retitled, modified, removed } = changed;
  const targets = [...new Map([...added, ...retitled, ...modified, ...removed].map((n) => [n.id, n])).values()].filter((n) => !kept || kept.has(n.id));
  const matches = matchBulletsToNodes(bullets, targets, snapshot, { agentNamePrefixes });
  if (targets.length > 0) console.error(`    bullets: ${matches.size}/${targets.length} matched (${((matches.size / targets.length) * 100).toFixed(0)}%)`);
  return { matches, inline: true };
}

function historyEntry({ ev, commit, index, previous, snapshot, pr, prNum, matches }) {
  const entry = {
    date: commit.date.slice(0, 10),
    commitHash: commit.hash.slice(0, 7),
    commitSeq: 1000 + index,
    changeType: ev.changeType,
    ...eventDiff(ev, previous, snapshot, { midHistory: index > 0, kindHint: pr ? classifyPrTitle(pr.title) : null }),
  };
  Object.assign(entry, prEntryFields(prNum, pr));
  applyBullet(entry, matches, ev.node.id, pr);
  return entry;
}

function applyBullet(entry, { matches, inline }, nodeId, pr) {
  const hit = matches.get(nodeId);
  if (hit) {
    entry.summary = hit.bulletTitle;
    const cleaned = cleanDescription(hit.bulletDescription);
    if (cleaned) entry.description = cleaned;
    return;
  }
  if (pr?.body && !inline && pr.body.length < 500) {
    entry.summary = pr.title;
    const cleaned = cleanDescription(pr.body);
    if (cleaned) entry.description = cleaned;
  }
}
