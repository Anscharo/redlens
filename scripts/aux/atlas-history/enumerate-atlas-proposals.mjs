#!/usr/bin/env node
// Offline enumeration of the Sky forum "Atlas Edit" proposal series.
//
// Produces the work-list manifest consumed by the severed-era reconstruction
// (see docs/plans/forum-severed-era-history.md). Each cycle proposal narrates a
// week's Atlas edits; the pre-truncation ones (< 2025-05-28) are the only public
// record of the HTML history that was garbage-collected from GitHub.
//
// Not part of `pnpm build`. Run on demand:  node scripts/aux/atlas-history/enumerate-atlas-proposals.mjs
// Hits the live Discourse JSON API (forum.skyeco.com); writes a checked-in JSON manifest.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const BASE = "https://forum.skyeco.com";
const TAGS = ["atlas-edit-weekly-proposal", "atlas-edit"];
const SEARCH_TERMS = [
  "Atlas Edit Cycle Proposal",
  "Atlas Edit Weekly Cycle",
  "Atlas Edit Monthly Cycle", // the early-2025 AEP experiment
  "AEP", // AEP-1..AEP-11 monthly proposals (titles don't contain "Atlas Edit")
];
const STRAGGLER_RE = /atlas edit|^aep[\s-]?\d/i; // keep only relevant search hits
const TRUNCATION_DATE = "2025-05-28"; // sky-ecosystem/next-gen-atlas "first commit" re-init
const FORUM_FLOOR = "2024-09-13"; // earliest weekly proposal observed

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "atlas-edit-proposals.json"); // co-located with this script
const AEP_DIR = path.resolve(__dirname, "../../../vendor/next-gen-atlas/Atlas Edit Proposals");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "redlens-atlas-research" } });
      if (res.ok) return await res.json();
      if (res.status === 429) await sleep(2000 * (i + 1));
    } catch (err) {
      if (i === tries - 1) throw err;
    }
    await sleep(500 * (i + 1));
  }
  throw new Error(`fetch failed after ${tries} tries: ${url}`);
}

function classify(title, tagNames) {
  const t = (title || "").toLowerCase();
  const weeklyTag = tagNames.includes("atlas-edit-weekly-proposal");
  const isCycle = weeklyTag || /(cycle|weekly|monthly).*proposal|week of|week starting|^aep[\s-]?\d/.test(t);
  let kind = "other";
  if (/^aep[\s-]?\d|monthly/.test(t)) kind = "monthly";
  else if (weeklyTag || /weekly|week of|week starting/.test(t)) kind = "weekly";
  return { kind, is_cycle_proposal: isCycle };
}

// The monthly AEP series (AEP-1..AEP-11) is also committed in the repo, with
// ratification status the forum topics lack. Parse it as an authoritative
// cross-reference. Graceful if the submodule isn't populated.
function readRepoAeps() {
  let files;
  try {
    files = fs.readdirSync(AEP_DIR).filter((f) => /^AEP-\d+\.md$/i.test(f));
  } catch {
    return [];
  }
  const field = (txt, name) => (txt.match(new RegExp(`^${name}\\s*:\\s*(.+)$`, "im")) || [])[1]?.trim() || null;
  return files
    .map((f) => {
      const txt = fs.readFileSync(path.join(AEP_DIR, f), "utf8");
      const forumUrl = field(txt, "Forum URL");
      const topicId = forumUrl && Number((forumUrl.match(/(\d+)\/?$/) || [])[1]) || null;
      return {
        file: f,
        aep: Number((f.match(/\d+/) || [])[0]),
        date_proposed: field(txt, "Date Proposed"),
        date_ratified: field(txt, "Date Ratified") || null,
        status: field(txt, "Status"),
        authors: field(txt, "Author\\(s\\)"),
        forum_topic_id: topicId,
        forum_url: forumUrl,
      };
    })
    .sort((a, b) => a.aep - b.aep);
}

function normalize(topic, via) {
  const tagNames = topic.tags || [];
  const date = (topic.created_at || "").slice(0, 10);
  const { kind, is_cycle_proposal } = classify(topic.title, tagNames);
  const window = !date ? "unknown" : date < TRUNCATION_DATE ? "severed" : "overlap";
  return {
    id: topic.id,
    date,
    title: topic.title,
    kind,
    is_cycle_proposal,
    window,
    posts_count: topic.posts_count ?? null,
    reply_count: topic.reply_count ?? null,
    last_poster: topic.last_poster_username || null,
    tags: tagNames,
    url: topic.slug ? `${BASE}/t/${topic.slug}/${topic.id}` : `${BASE}/t/${topic.id}`,
    raw_url: `${BASE}/raw/${topic.id}/1`, // the markdown the reconstruction parses
    via,
  };
}

async function enumerateTag(tag) {
  const found = new Map();
  for (let page = 0; page < 20; page++) {
    const d = await getJson(`${BASE}/tag/${tag}.json?page=${page}`);
    const topics = d?.topic_list?.topics || [];
    if (!topics.length) break;
    for (const t of topics) found.set(t.id, normalize(t, `tag:${tag}`));
    if (!d.topic_list.more_topics_url) break;
    await sleep(300);
  }
  return found;
}

async function searchStragglers(known) {
  const extra = new Map();
  for (const term of SEARCH_TERMS) {
    for (let page = 0; page < 4; page++) {
      const d = await getJson(`${BASE}/search.json?q=${encodeURIComponent(term)}&page=${page}`);
      const topics = Object.fromEntries((d.topics || []).map((t) => [t.id, t]));
      const posts = d.posts || [];
      if (!posts.length) break;
      for (const p of posts) {
        const t = topics[p.topic_id];
        if (!t || known.has(t.id) || extra.has(t.id)) continue;
        if (!STRAGGLER_RE.test(t.title || "")) continue;
        extra.set(t.id, normalize(t, "search"));
      }
      await sleep(300);
    }
  }
  return extra;
}

async function main() {
  const all = new Map();
  for (const tag of TAGS) {
    for (const [id, v] of await enumerateTag(tag)) if (!all.has(id)) all.set(id, v);
  }
  for (const [id, v] of await searchStragglers(all)) all.set(id, v);

  // Cross-link committed AEP files → their forum topics (adds ratification status).
  const repoAeps = readRepoAeps();
  const aepByTopic = new Map(repoAeps.filter((a) => a.forum_topic_id).map((a) => [a.forum_topic_id, a]));
  for (const [id, p] of all) {
    const a = aepByTopic.get(id);
    if (a) Object.assign(p, { repo_file: a.file, ratified: a.date_ratified ? "yes" : a.status || "unknown" });
  }

  const proposals = [...all.values()].sort(
    (a, b) => (a.date || "").localeCompare(b.date || "") || a.id - b.id,
  );
  const cycles = proposals.filter((p) => p.is_cycle_proposal);
  const manifest = {
    source: BASE,
    captured: new Date().toISOString().slice(0, 10),
    tags: TAGS,
    anchors: { truncation_commit_date: TRUNCATION_DATE, forum_floor: FORUM_FLOOR },
    counts: {
      total: proposals.length,
      cycle_proposals: cycles.length,
      severed_cycles: cycles.filter((p) => p.window === "severed").length,
      overlap_cycles: cycles.filter((p) => p.window === "overlap").length,
      repo_aep_files: repoAeps.length,
    },
    proposals,
    repo_aep_files: repoAeps, // committed monthly proposals (vendor/next-gen-atlas/Atlas Edit Proposals/)
  };
  fs.writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
  console.log(manifest.counts);
  const severed = cycles.filter((p) => p.window === "severed");
  console.log(`\nsevered-era cycle proposals (forum = sole source), ${severed.length}:`);
  for (const p of severed) console.log(`  ${p.date}  #${p.id}  ${p.title}`);
  const unknown = proposals.filter((p) => p.window === "unknown");
  if (unknown.length) console.log(`\n${unknown.length} topics missing a date (search-only); inspect: ${unknown.map((p) => p.id).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
