// Prototype: parse the 29 severed-era forum proposals into edit-sets + doc bullets,
// then measure how many severed-born, alive-today docs get forum coverage.
import fs from "node:fs";
import { parseHtmlToNodes, loadHtmlAt } from "/Users/m7/lens/scripts/htmlhist/atlas-html.mjs";
import { matchNodes } from "/Users/m7/lens/scripts/htmlhist/history-identity.mjs";

const SCRATCH = "/private/tmp/claude-502/-Users-m7-lens/6d7b89bd-66ed-458f-82e7-01cccffb710e/scratchpad";
const REPO = "/Users/m7/lens/vendor/next-gen-atlas";
const ROOT_SHA = "4e931dfd4017a9b9d573dec1aac352e60f1bb02a";

const normTitle = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------- 1. parse the 29 proposals ----------
const manifest = JSON.parse(fs.readFileSync("/Users/m7/lens/scripts/aux/atlas-history/atlas-edit-proposals.json", "utf8"));
const severedMeta = new Map(manifest.proposals.filter((p) => p.window === "severed").map((p) => [p.id, p]));

const VERB_RE = /^\s*[-*]?\s*\*\*(Add|Adds?|Replace|Delete|Remove|Move|Renumber|Update|Amend|Introduce|Correct)[\w ]*?\*\*/i;
// nested doc bullet: "- **Title** *(Type)* - content"  (tolerates (*Type*) and **(Type)** variants)
const BULLET_RE = /^(\s*)[-*] \*\*(.{2,120}?)\*\*\s*[(*]{1,3}\s*\(?([A-Z][\w /]{1,30}?)\)?\s*[)*]{1,3}\s*[-–]\s*(.*)/;
const DOCNO_RE = /\bA\.\d+(?:\.\d+)*(?:\.[\w-]+)*\b/g;
const PH_LINK_RE = /sky-atlas\.powerhouse\.io\/([A-Za-z0-9._%-]+)\/([0-9a-f-]{12,36})/g;

const proposals = [];
for (const file of fs.readdirSync(`${SCRATCH}/forum-severed`).filter((f) => f.endsWith(".md"))) {
  const id = +file.replace(".md", "");
  const text = fs.readFileSync(`${SCRATCH}/forum-severed/${file}`, "utf8");
  const lines = text.split("\n");
  const editSets = [];
  let cur = null;
  const flush = () => { if (cur) editSets.push(cur); };
  for (const line of lines) {
    const h = line.match(/^#{2,4}\s+(.*)/);
    if (h) { flush(); cur = { name: h[1].trim(), verbs: [], bullets: 0, docNos: new Set(), phUuids: new Set(), titles: new Set() }; continue; }
    if (!cur) cur = { name: "(preamble)", verbs: [], bullets: 0, docNos: new Set(), phUuids: new Set(), titles: new Set() };
    const v = line.match(VERB_RE);
    if (v) cur.verbs.push(v[1]);
    const b = line.match(BULLET_RE);
    if (b) { cur.bullets++; cur.titles.add(normTitle(b[2])); }
    for (const m of line.matchAll(DOCNO_RE)) cur.docNos.add(m[0]);
    for (const m of line.matchAll(PH_LINK_RE)) cur.phUuids.add(m[2]);
  }
  flush();
  const multiPost = /split into two posts|continued in the next post|second post/i.test(text);
  proposals.push({ id, date: severedMeta.get(id)?.date, bytes: text.length, editSets, multiPost });
}
proposals.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

let totVerbs = 0, totBullets = 0, allTitles = new Set(), allDocNos = new Set(), allPh = new Set(), multi = 0;
for (const p of proposals) {
  let v = 0, bl = 0;
  for (const es of p.editSets) {
    v += es.verbs.length; bl += es.bullets;
    for (const t of es.titles) allTitles.add(t);
    for (const d of es.docNos) allDocNos.add(d);
    for (const u of es.phUuids) allPh.add(u);
  }
  totVerbs += v; totBullets += bl;
  if (p.multiPost) multi++;
  console.log(`${p.id} ${p.date} ${String(p.bytes).padStart(6)}b  sets=${String(p.editSets.length - 1).padStart(2)} verbs=${String(v).padStart(3)} bullets=${String(bl).padStart(4)} phLinks=${[...p.editSets.reduce((s, e) => { e.phUuids.forEach((x) => s.add(x)); return s; }, new Set())].length}${p.multiPost ? "  [MULTI-POST]" : ""}`);
}
console.log(`\nTOTAL: verbs=${totVerbs} docBullets=${totBullets} distinctBulletTitles=${allTitles.size} distinctDocNos=${allDocNos.size} distinctPhUuids=${allPh.size} multiPost=${multi}/29`);

// ---------- 2. severed-born alive-today docs ----------
const genesis = parseHtmlToNodes(fs.readFileSync(`${SCRATCH}/genesis-sky-atlas.html`, "utf8"));
const root = loadHtmlAt(ROOT_SHA, REPO);
const artifact = JSON.parse(fs.readFileSync("/Users/m7/lens/public/history-html-era.json", "utf8"));
const docs = JSON.parse(fs.readFileSync("/Users/m7/lens/public/docs.json", "utf8")).nodes;
const currentIds = new Set(Object.keys(docs));

const m = matchNodes(genesis, root, { seedHop: true, recoverByContent: true });
const matchedRootOrders = new Set(m.pairs.map((p) => p.newer.order));

const rootSha7 = ROOT_SHA.slice(0, 7);
const addedAtRoot = artifact.events.filter((e) => e.commitHash === rootSha7 && e.changeType === "added");
const evByKey = new Map();
for (const e of addedAtRoot) {
  const k = `${e.docNo || ""}|${(e.title || "").toLowerCase()}`;
  (evByKey.get(k) || evByKey.set(k, []).get(k)).push(e);
}
const claimIdx = new Map();
const severedBorn = []; // { title, docNo, uuid } present at root, absent from genesis, alive today
for (const r of root.slice().sort((a, b) => a.order - b.order)) {
  const k = `${r.doc_no || ""}|${(r.title || "").toLowerCase()}`;
  const evs = evByKey.get(k);
  const i = claimIdx.get(k) || 0;
  if (!evs || i >= evs.length) continue;
  claimIdx.set(k, i + 1);
  const ev = evs[i];
  if (!matchedRootOrders.has(r.order) && currentIds.has(ev.docId)) {
    severedBorn.push({ title: r.title, docNo: r.doc_no, uuid: ev.docId, section: r.section });
  }
}
console.log(`\nsevered-born docs alive today: ${severedBorn.length}`);
const agentBorn = severedBorn.filter((d) => d.section === "Agent Scope Database");
console.log(`  of which Agent Scope Database: ${agentBorn.length}`);
const coreBorn = severedBorn.filter((d) => d.section !== "Agent Scope Database");
console.log(`  core (non-Agent) severed-born: ${coreBorn.length}`);

// ---------- 3. coverage ----------
let titleHit = 0;
const unhit = [];
for (const d of coreBorn) {
  if (allTitles.has(normTitle(d.title))) titleHit++;
  else unhit.push(d);
}
console.log(`core docs covered by a forum doc-bullet title: ${titleHit} (${Math.round((100 * titleHit) / coreBorn.length)}%)`);
// weaker: title appears anywhere in any proposal text
const fullText = fs.readdirSync(`${SCRATCH}/forum-severed`).map((f) => normTitle(fs.readFileSync(`${SCRATCH}/forum-severed/${f}`, "utf8"))).join("\n");
let mentionHit = 0;
const stillUnhit = [];
for (const d of unhit) {
  const t = normTitle(d.title);
  if (t.length >= 10 && fullText.includes(t)) mentionHit++;
  else stillUnhit.push(d);
}
console.log(`additionally mentioned somewhere in proposal text: ${mentionHit}`);
console.log(`uncovered: ${stillUnhit.length}`);
const byArt = {};
for (const d of stillUnhit) byArt[(d.docNo || "?").split(".").slice(0, 2).join(".")] = (byArt[(d.docNo || "?").split(".").slice(0, 2).join(".")] || 0) + 1;
console.log("uncovered by scope/article:", JSON.stringify(Object.entries(byArt).sort((a, b) => b[1] - a[1]).slice(0, 12)));
fs.writeFileSync(`${SCRATCH}/forum-coverage.json`, JSON.stringify({ proposals: proposals.map((p) => ({ id: p.id, date: p.date, bytes: p.bytes, multiPost: p.multiPost, sets: p.editSets.length, verbs: p.editSets.reduce((a, e) => a + e.verbs.length, 0), bullets: p.editSets.reduce((a, e) => a + e.bullets, 0) })), severedBornAlive: severedBorn.length, titleHit, mentionHit, uncovered: stillUnhit.length }, null, 1));
