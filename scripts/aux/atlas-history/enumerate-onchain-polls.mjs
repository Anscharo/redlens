#!/usr/bin/env node
// Enumerate on-chain Atlas Edit governance polls — the severed-era recovery index.
//
// Sky/Maker ratify each Atlas Edit cycle with an on-chain governance poll. Poll
// CREATION is recorded by `createPoll(start, end, string multiHash, string url)` on
// the emitter 0xF9be… — each call carries the poll's IPFS `multiHash` + a
// `makerdao/community` GitHub raw URL to the poll markdown. These on-chain records
// are permanent and content-addressed, so they index the severed HTML era
// (2024-09 → 2025-05-28) that was garbage-collected from the next-gen-atlas repo.
// Vote tallies live separately as `Voted(voter, pollId, optionId)` on the
// PollingEmitter 0xD3A9FE…. See docs/plans/atlas-prehistory-mips.md (Tier 0) and
// forum-severed-era-history.md.
//
// This script ENUMERATES (date, multiHash, url, title); resolving each poll's
// markdown (→ edited atlas docs, Powerhouse UUIDs, forum link) is the
// reconstruction step's job. On-chain history is immutable, so re-runs are
// deterministic apart from the `captured` date.
//
// Not part of `pnpm build`. Needs an Etherscan key:
//   node --env-file-if-exists=.env.local scripts/aux/atlas-history/enumerate-onchain-polls.mjs
//   (or: ETHERSCAN_API_KEY=… node scripts/aux/atlas-history/enumerate-onchain-polls.mjs)

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

const API_KEY = process.env.ETHERSCAN_API_KEY;
const V2 = "https://api.etherscan.io/v2/api?chainid=1";
const CREATE_EMITTER = "0xF9be8F0945acDdeeDaA64DFCA5Fe9629D0CF8E5D"; // createPoll(start,end,multiHash,url) txs
const VOTE_EMITTER = "0xD3A9FE267852281a1e6307a1C37CDfD76d39b133"; // PollingEmitter; Voted(voter,pollId,optionId) tallies
const CREATE_POLL_SELECTOR = "0xd54a8176"; // createPoll(uint256,uint256,string,string)
const FLOOR_DATE = "2024-08-01"; // before the first Atlas Edit poll (2024-09-16); bounds the scan
const TRUNCATION_DATE = "2025-05-28"; // next-gen-atlas repo re-init; git is authoritative on/after this
const ATLAS_RE = /atlas[\s_%]*edit/i;
const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[0-9a-z]{20,})$/;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "atlas-onchain-polls.json"); // co-located with this script
const AEP_DIR = path.resolve(__dirname, "../../../vendor/next-gen-atlas/Atlas Edit Proposals");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.ok) {
        const j = await res.json();
        // Etherscan rate-limit: {status:"0", message:"NOTOK", result:"Max rate limit reached"}
        if (j.message === "NOTOK" && /rate limit/i.test(j.result || "")) {
          await sleep(1500 * (i + 1));
          continue;
        }
        return j;
      }
    } catch (err) {
      if (i === tries - 1) throw err;
    }
    await sleep(600 * (i + 1));
  }
  throw new Error(`fetch failed after ${tries} tries: ${url}`);
}

// Decode createPoll(uint256 startDate, uint256 endDate, string multiHash, string url).
function decodeCreatePoll(input) {
  if (typeof input !== "string") return null;
  const buf = Buffer.from(input.slice(input.startsWith("0x") ? 10 : 8), "hex"); // strip 0x + 4-byte selector
  if (buf.length < 5 * 32) return null;
  const uint = (i) => Number(BigInt("0x" + buf.subarray(i * 32, (i + 1) * 32).toString("hex")));
  const readStr = (off) => {
    if (!Number.isFinite(off) || off + 32 > buf.length) return null;
    const len = Number(BigInt("0x" + buf.subarray(off, off + 32).toString("hex")));
    if (len <= 0 || off + 32 + len > buf.length) return null;
    return buf.subarray(off + 32, off + 32 + len).toString("utf8");
  };
  return { start: uint(0), end: uint(1), multiHash: readStr(uint(2)), url: readStr(uint(3)) };
}

function classify(title) {
  const m = title.match(/\(AEP-(\d+)\)/i);
  if (m) return { kind: "monthly", aep: Number(m[1]) };
  if (/weekly/i.test(title)) return { kind: "weekly", aep: null };
  return { kind: "other", aep: null };
}

const isoDate = (tsSeconds) => new Date(Number(tsSeconds) * 1000).toISOString().slice(0, 10);

// Committed AEP files carry the ratification-poll URL (a vote.makerdao.com/polling/<slug>
// where <slug> is the IPFS multiHash prefix) — used to cross-link + integrity-check.
function readRepoAeps() {
  let files;
  try {
    files = fs.readdirSync(AEP_DIR).filter((f) => /^AEP-\d+\.md$/i.test(f));
  } catch {
    return [];
  }
  const field = (txt, name) => (txt.match(new RegExp(`^${name}\\s*:\\s*(.+)$`, "im")) || [])[1]?.trim() || null;
  return files.map((f) => {
    const txt = fs.readFileSync(path.join(AEP_DIR, f), "utf8");
    const pollUrl = field(txt, "Ratification Poll URL");
    return {
      aep: Number((f.match(/\d+/) || [])[0]),
      file: f,
      ratification_poll_url: pollUrl,
      poll_slug: (pollUrl && (pollUrl.match(/polling\/([A-Za-z0-9]+)/) || [])[1]) || null,
    };
  });
}

async function fetchCreatePollTxs(startBlock) {
  const out = [];
  for (let page = 1; page <= 25; page++) {
    const j = await getJson(
      `${V2}&module=account&action=txlist&address=${CREATE_EMITTER}&startblock=${startBlock}&endblock=99999999&sort=asc&page=${page}&offset=1000&apikey=${API_KEY}`,
    );
    const txs = Array.isArray(j.result) ? j.result : [];
    out.push(...txs);
    if (txs.length < 1000) break;
    await sleep(300);
  }
  return out;
}

async function main() {
  if (!API_KEY) {
    console.error("ETHERSCAN_API_KEY not set — run: node --env-file-if-exists=.env.local scripts/aux/atlas-history/enumerate-onchain-polls.mjs");
    process.exit(1);
  }
  const floorTs = Math.floor(Date.parse(`${FLOOR_DATE}T00:00:00Z`) / 1000);
  const floor = await getJson(`${V2}&module=block&action=getblocknobytime&timestamp=${floorTs}&closest=before&apikey=${API_KEY}`);
  const startBlock = Number(floor.result);

  const txs = await fetchCreatePollTxs(startBlock);
  const createPolls = txs.filter((t) => (t.input || "").toLowerCase().startsWith(CREATE_POLL_SELECTOR));

  const aepBySlug = readRepoAeps();
  const aeps = new Map(aepBySlug.map((a) => [a.aep, a]));

  const polls = [];
  for (const t of createPolls) {
    const dec = decodeCreatePoll(t.input);
    if (!dec || !dec.url || !dec.multiHash) continue;
    let url = dec.url;
    try {
      url = decodeURIComponent(dec.url);
    } catch {
      /* keep raw */
    }
    if (!ATLAS_RE.test(url) && !ATLAS_RE.test(dec.url)) continue;
    const multiHash = dec.multiHash.trim();
    const title = (url.split("/").pop() || "").replace(/\.md$/i, "");
    const date = isoDate(t.timeStamp);
    const { kind, aep } = classify(title);
    const rec = {
      date,
      window: date < TRUNCATION_DATE ? "severed" : "overlap",
      kind,
      aep,
      title,
      multiHash,
      valid_cid: CID_RE.test(multiHash),
      ipfs_url: `https://ipfs.io/ipfs/${multiHash}`,
      poll_url: url,
      start_date: isoDate(dec.start),
      end_date: isoDate(dec.end),
      tx: t.hash,
      block: Number(t.blockNumber),
      create_emitter: CREATE_EMITTER,
    };
    if (aep && aeps.has(aep)) {
      const a = aeps.get(aep);
      rec.repo_file = a.file;
      rec.aep_poll_match = a.poll_slug ? multiHash.startsWith(a.poll_slug) : null;
    }
    polls.push(rec);
  }
  polls.sort((a, b) => a.date.localeCompare(b.date) || a.block - b.block);

  const manifest = {
    source: "ethereum mainnet (Etherscan v2)",
    captured: new Date().toISOString().slice(0, 10),
    create_emitter: CREATE_EMITTER,
    vote_emitter: VOTE_EMITTER,
    create_poll_selector: CREATE_POLL_SELECTOR,
    anchors: { floor_date: FLOOR_DATE, truncation_date: TRUNCATION_DATE },
    counts: {
      createpoll_txs_scanned: createPolls.length,
      atlas_polls: polls.length,
      severed: polls.filter((p) => p.window === "severed").length,
      overlap: polls.filter((p) => p.window === "overlap").length,
      invalid_cid: polls.filter((p) => !p.valid_cid).length,
    },
    polls,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
  console.log(manifest.counts);
  for (const p of polls) {
    console.log(`  ${p.date}  ${p.kind}${p.aep ? `(AEP-${p.aep})` : ""}  ${p.multiHash}  ${p.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
