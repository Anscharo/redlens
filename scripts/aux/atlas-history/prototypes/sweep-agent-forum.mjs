// Quick forum sweep: find posts in the 2 weeks before each agent-doc commit
// that might be the source/announcement of atlas agent edits.
import fs from "node:fs";

const ART = JSON.parse(fs.readFileSync("/Users/m7/lens/public/history-html-era.json", "utf8"));

// agent-doc commit clusters (>=5 non-docNo adds), from the artifact
const byCommit = new Map();
for (const e of ART.events) {
  if (e.changeType !== "added" || (e.docNo && /^A\.|^NR-/.test(e.docNo))) continue;
  const c = byCommit.get(e.commitHash) || { date: e.date?.slice(0, 10), pr: e.pr, n: 0 };
  c.n++;
  byCommit.set(e.commitHash, c);
}
const commits = [...byCommit.entries()]
  .map(([sha, c]) => ({ sha, ...c }))
  .filter((c) => c.n >= 5 && c.date)
  .sort((a, b) => a.date.localeCompare(b.date));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUERIES = ["agent", "atlas", "agent launch", "liquidity layer", "allocator", "primitive"];
const AFTER = "2025-05-13", BEFORE = "2025-11-21";

const topics = new Map();
for (const q of QUERIES) {
  for (let page = 1; page <= 3; page++) {
    const url = `https://forum.skyeco.com/search.json?q=${encodeURIComponent(`${q} after:${AFTER} before:${BEFORE} order:latest`)}&page=${page}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "redline-atlas-research/1.0", Accept: "application/json" } });
      if (!res.ok) { console.error(`  ${q} p${page}: HTTP ${res.status}`); break; }
      const j = await res.json();
      const ts = j.topics || [];
      for (const t of ts) {
        const d = t.created_at?.slice(0, 10);
        if (!d || d < AFTER || d > BEFORE) continue;
        if (!topics.has(t.id)) topics.set(t.id, { id: t.id, date: d, title: t.title, via: new Set() });
        topics.get(t.id).via.add(q);
      }
      if (ts.length < 20) break; // last page
    } catch (e) { console.error(`  ${q} p${page}: ${e.message}`); break; }
    await sleep(1100);
  }
}
console.log(`\ntopics in range: ${topics.size}\n`);

// filter to plausibly agent/atlas-related titles
const REL = /agent|atlas|primitive|liquidity layer|allocator|spark|star|grove|keel|launch|instance|alm|spell/i;
const rel = [...topics.values()].filter((t) => REL.test(t.title)).sort((a, b) => a.date.localeCompare(b.date));

// map each commit -> topics in [date-14d, date]
const dayMs = 86400000;
const out = [];
for (const c of commits) {
  const end = new Date(c.date + "T00:00:00Z").getTime();
  const start = end - 14 * dayMs;
  const hits = rel.filter((t) => {
    const td = new Date(t.date + "T00:00:00Z").getTime();
    return td >= start && td <= end;
  });
  out.push({ commit: c, hits });
  console.log(`\n${c.date} ${c.sha} PR#${c.pr ?? "-"} (${c.n} agent adds)`);
  for (const h of hits.slice(0, 8)) console.log(`   ${h.date}  #${h.id}  ${h.title}`);
  if (!hits.length) console.log("   (no candidate posts in window)");
}
fs.writeFileSync(
  "/private/tmp/claude-502/-Users-m7-lens/6d7b89bd-66ed-458f-82e7-01cccffb710e/scratchpad/agent-forum-sweep.json",
  JSON.stringify({ range: [AFTER, BEFORE], queries: QUERIES, commits: out.map(({ commit, hits }) => ({ ...commit, hits: hits.map((h) => ({ id: h.id, date: h.date, title: h.title, url: `https://forum.skyeco.com/t/${h.id}` })) })) }, null, 1)
);
console.log("\nwrote agent-forum-sweep.json");
