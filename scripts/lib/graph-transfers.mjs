/**
 * Transfer/grant event extraction (Pattern 18) for build-graph.
 *
 * Completed or planned token movements become `funds_transfer` edges (sender
 * entity → recipient entity; meta carries amounts/tx hash/status). Atlas docs
 * that authorize or describe recurring payments, but do not record transfer
 * rows, become `funds_authorization` edges instead so chat/reporting can say
 * exactly where payment data should exist without implying ledger coverage.
 * Planned transfer docs that name a source but defer amount/recipient details
 * become `funds_data_gap` records tied to the source doc/entity.
 *
 *  A. Grant docs under A.2.13 (isGrantDoc) — structured bullet lists:
 *       - Recipient: Sky Frontier Foundation
 *       - Recipient Address: `0x…`
 *       - Transaction Hash: `0x…`
 *       - USDS amount: 50,000,000
 *     Sender is Sky (treasury disbursement approved by governance) → sky-core.
 *
 *  B. Genesis token distribution narratives (docs titled "Minting Of Tokens…"
 *     / "Transfer Of Tokens…" under agent artifacts):
 *       "SPK Company Ltd transferred 6.5 billion SPK tokens … to the Sky
 *        Pause Proxy."  (past tense = completed; "will transfer" = planned)
 *
 *  C. Accord grant authorizations (title contains "Grant Authorization")
 *     become `funds_authorization`, not `funds_transfer`:
 *       "… grant of 800,000 USDS per month to the Grove Foundation from
 *        Grove's Prime Treasury for a three (3) month period …"
 *
 * Never-silent: docs that look like one of the shapes but fail to parse are
 * warned about individually.
 */

import { slugify, normalizeKey, buildNameIndex, isGrantDoc } from "./graph-patterns.mjs";

const AMOUNT_LINE_RE = /^[-*]\s*(.+?)\s+amount:\s*([\d,.]+)\s*$/gim;
const RECIPIENT_RE = /^[-*]\s*Recipient:\s*(.+?)\s*$/im;
const RECIPIENT_ADDR_RE = /^[-*]\s*Recipient Address:\s*`?(0x[0-9a-fA-F]{40})`?\s*$/im;
const TX_HASH_RE = /^[-*]\s*Transaction Hash:\s*`?(0x[0-9a-fA-F]{64})`?\s*$/im;

// "X transferred 6.5 billion SPK tokens from … to the Y." / "X will transfer
// SPK tokens … to the Y." Amount group is optional (some planned transfers
// name no figure yet).
const GENESIS_TRANSFER_RE =
  /\b(.+?)\s+(transferred|will transfer)\s+(?:all of (?:the )?)?(?:([\d,.]+(?:\s+(?:billion|million|thousand))?)\s+)?([A-Z]{2,10})\s+tokens?\b[^.]*?\bto\s+(?:the\s+)?([^.,]+?)(?:,|\.|$)/i;
const GENESIS_TRANSFER_GAP_RE =
  /\b(.+?)\s+account\s+will transfer\s+([A-Z]{2,10})\s+tokens?\b[\s\S]*?\bfuture iteration\b/i;
const GENESIS_MINT_RE =
  /The Genesis Supply was minted to an account owned by\s+(?:the\s+)?(.+?)\./i;

const AUTH_GRANT_RE =
  /grant of\s+([\d,.]+)\s+([A-Z]{2,10})\s+per month to (?:the )?(.+?) from (.+?)(?:['’]s)? (?:Prime )?Treasury\b[\s\S]*?for a\s+\w+\s*\((\d+)\)\s*month period/i;
const AUTH_BEGIN_RE = /beginning on ([^.]+?)\./i;

// Shape D — accord capital allocations. Title must END with the allocation
// phrase ("Spark Initial Allocation", "Genesis Capital Allocation") so
// mechanics docs like "Initial Allocation Distribution" don't gate in.
//   "The Initial Allocation for Spark is 25,000,000 USDS."
//   "The Genesis Capital Allocation for Amatsu is 25,000,000 USDS. The
//    transfer … will be included in the March 26, 2026 Executive Vote."
const ALLOCATION_TITLE_RE = /\b(?:Initial Allocation|Genesis Capital Allocation)$/i;
const ALLOCATION_RE =
  /\bThe (Initial Allocation|Genesis Capital Allocation) for (.+?) is ([\d,.]+)\s+([A-Z]{2,10})\./i;
const ALLOCATION_VOTE_RE = /included in the ([^.]+?Executive Vote)/i;

// Shape E — executed budget transfers. No title gate: the required
// "{amount} {TOKEN} from … to …" core makes the sentence intrinsically
// monetary, and endpoints resolve-only (never created), so prose like
// "the Spell Crafter has transferred the spell" can't produce an edge.
//   "Sky has transferred 2 million USDS from the Sky Ecosystem Liquidity
//    Bootstrapping Budget to Spark to provide liquidity to market makers."
const BUDGET_TRANSFER_RE =
  /\b(.+?)\s+has transferred\s+([\d,.]+(?:\s+(?:billion|million|thousand))?)\s+([A-Z]{2,10})\s+from\s+(?:the\s+)?([^.]+?)\s+to\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*)*)/;

// Enumerated allocation form (A.2.8.2.5.2.2): "Sky Core shall directly
// transfer (1) 20,000,000 USDS to the Core Council Executor Agent 1 SubProxy
// and (2) 5,000,000 USDS to the Core Council Buffer." One edge per item.
const ALLOCATION_DIRECT_RE = /(?:^|,\s*)([A-Z][A-Za-z ]+?)\s+shall directly transfer\b/;
const ALLOCATION_ITEM_RE =
  /\(\d+\)\s*([\d,.]+(?:\s+(?:billion|million|thousand))?)\s+([A-Z]{2,10})\s+to\s+(?:the\s+)?([^.,()]+?)(?=\s+and\s+\(|[.,(])/g;

// Directory docs ("The documents herein record …" / "The subdocuments
// herein set out …") are containers, not events.
const DIRECTORY_RE = /^The (?:sub)?documents? herein\b/i;
// Markdown links inject doc_no dots into sentences ("specified in [A.6.1.… -
// Title](uuid)") which break the [^.] sentence-boundary classes — strip them
// entirely before matching.
const stripLinks = (s) => s.replace(/\[[^\]]*\]\([^)]*\)/g, "");

// Prose names that refer to Sky-side system accounts rather than entities.
const PARTY_ALIASES = new Map([
  ["skypauseproxy", "sky-core"],
  ["sky", "sky-core"],
]);

// Longest trailing run of capitalized tokens: "The SPK Company Ltd account
// holder" → "" (lowercase tail), "yesterday SPK Company Ltd" → "SPK Company Ltd".
function trailingProperNoun(s) {
  const tokens = s.trim().split(/\s+/);
  let start = tokens.length;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^[A-Z0-9]/.test(tokens[i])) start = i;
    else break;
  }
  return tokens.slice(start).join(" ");
}

export function extractTransfers(allDocs, docById, docByDocNo, entityMap, edges, addEntity) {
  const nameIndex = buildNameIndex(entityMap);
  const stats = {
    grants: 0, genesis: 0, authorizations: 0, allocations: 0, budgetTransfers: 0,
    planned: 0, dataGaps: 0, warnings: 0,
  };
  const warn = (msg) => { stats.warnings++; console.warn(`  transfers: ${msg}`); };

  function resolveParty(rawName, sourceDoc, { create = true } = {}) {
    let name = rawName.trim().replace(/^the\s+/i, "").trim();
    if (!name) return null;
    const alias = PARTY_ALIASES.get(normalizeKey(name));
    if (alias) return entityMap.get(alias) ?? null;
    // "Spark SubProxy Account" / "Grove SubProxy" → the agent
    const acct = name.match(/^(.+?)\s+(?:SubProxy(?:\s+Account)?|Account)$/i);
    // Prose refers to multisigs without the suffix ("the Core Council
    // Buffer") while Pattern 17 names them from the threshold sentence
    // ("Core Council Buffer Multisig") — try the suffixed form last.
    const direct =
      nameIndex.get(normalizeKey(name)) ??
      (acct ? nameIndex.get(normalizeKey(acct[1])) : null) ??
      nameIndex.get(normalizeKey(`${name} Multisig`));
    if (direct) return direct;
    if (!create) return null;
    const et = /\bFoundation$/i.test(name) ? "foundation" : "ecosystem_actor";
    const created = addEntity(slugify(name), name, et, null, null, {
      source: "transfer_party",
      source_doc_no: sourceDoc.doc_no,
    });
    nameIndex.set(normalizeKey(name), created);
    return created;
  }

  function addTransfer(from, to, sourceDoc, meta) {
    edges.push({
      fromId: from.id, fromType: "entity", toId: to.id, toType: "entity",
      edgeType: "funds_transfer", sourceDocNos: [sourceDoc.doc_no],
      meta: JSON.stringify(meta),
    });
  }
  function addAuthorization(from, to, sourceDoc, meta) {
    edges.push({
      fromId: from.id, fromType: "entity", toId: to.id, toType: "entity",
      edgeType: "funds_authorization", sourceDocNos: [sourceDoc.doc_no],
      meta: JSON.stringify({
        ...meta,
        kind: "grant_authorization",
        status: "authorized",
        populated: false,
        recorded_transfer: false,
        silence_reason: "Atlas authorizes recurring payments here but does not record completed transfer rows.",
        expected_record_fields: [
          "reward period",
          "payee",
          "payment address",
          "amount paid",
          "transaction hash",
          "transaction date",
        ],
      }),
    });
  }
  function addDataGap(sourceDoc, relatedEntity, meta) {
    edges.push({
      fromId: sourceDoc.id, fromType: "doc", toId: relatedEntity.id, toType: "entity",
      edgeType: "funds_data_gap", sourceDocNos: [sourceDoc.doc_no],
      meta: JSON.stringify({
        ...meta,
        populated: false,
        recorded_transfer: false,
        silence_reason: "Atlas describes a planned token movement here but defers recipient, amount, or execution details to a future iteration.",
        expected_record_fields: [
          "sender",
          "recipient",
          "amount",
          "token",
          "transaction hash",
          "transaction date",
        ],
      }),
    });
  }

  const skyCore = entityMap.get("sky-core");

  // --- Shape A: A.2.13 grant docs ---
  for (const d of allDocs.filter(isGrantDoc)) {
    const content = d.content ?? "";
    const recipientName = content.match(RECIPIENT_RE)?.[1];
    if (!recipientName) { warn(`grant doc without Recipient line: ${d.doc_no}`); continue; }
    const recipient = resolveParty(recipientName, d);
    const amounts = {};
    AMOUNT_LINE_RE.lastIndex = 0;
    for (const m of content.matchAll(AMOUNT_LINE_RE)) amounts[m[1].trim()] = m[2];
    if (!Object.keys(amounts).length) warn(`grant doc without amounts: ${d.doc_no}`);
    addTransfer(skyCore, recipient, d, {
      kind: "grant",
      status: /disbursed/i.test(content) ? "disbursed" : "approved",
      period: d.title.replace(/\s*Grant\s*$/i, "").trim() || undefined,
      amounts,
      tx_hash: content.match(TX_HASH_RE)?.[1]?.toLowerCase(),
      recipient_address: content.match(RECIPIENT_ADDR_RE)?.[1]?.toLowerCase(),
    });
    stats.grants++;
  }

  // --- Shape B: genesis token distribution narratives ---
  for (const d of allDocs) {
    if (!/^(Minting|Transfer) Of Tokens/i.test(d.title)) continue;
    const content = stripLinks(d.content ?? "");
    if (DIRECTORY_RE.test(content.trim())) continue;

    const mint = content.match(GENESIS_MINT_RE);
    if (mint) {
      // Mint event: the agent's token comes into existence in this account.
      // Sender = the agent whose artifact this doc sits in.
      const agentDoc = docByDocNo.get(d.doc_no.match(/^(A\.6\.1\.1\.\d+)\./)?.[1] ?? "");
      const agent = agentDoc ? nameIndex.get(normalizeKey(agentDoc.title)) : null;
      const holder = resolveParty(mint[1], d);
      if (agent && holder) {
        addTransfer(agent, holder, d, { kind: "genesis_mint", status: "completed" });
        stats.genesis++;
      } else warn(`genesis mint endpoints unresolved: ${d.doc_no}`);
      continue;
    }

    const t = content.match(GENESIS_TRANSFER_RE);
    if (!t) {
      const gap = content.match(GENESIS_TRANSFER_GAP_RE);
      const source = gap ? resolveParty(gap[1], d) : null;
      if (gap && source) {
        addDataGap(d, source, {
          kind: "planned_genesis_distribution_gap",
          status: "planned",
          token: gap[2],
        });
        stats.planned++;
        stats.dataGaps++;
        continue;
      }
      warn(`genesis transfer did not parse: ${d.doc_no} ("${d.title}")`);
      continue;
    }
    // Sender capture can carry sentence lead-in ("The X account will…") —
    // try resolve-only on the raw capture and its trailing proper noun before
    // creating an entity (avoids junk entities from lead-in words).
    const fromRaw = t[1].trim();
    const fromTail = trailingProperNoun(fromRaw);
    const from =
      resolveParty(fromRaw, d, { create: false }) ??
      resolveParty(fromTail, d, { create: false }) ??
      resolveParty(fromTail || fromRaw, d);
    const to = resolveParty(t[5], d);
    if (!from || !to || from.id === to.id) { warn(`genesis transfer endpoints unresolved: ${d.doc_no}`); continue; }
    const planned = t[2].toLowerCase() !== "transferred";
    if (planned) stats.planned++;
    addTransfer(from, to, d, {
      kind: "genesis",
      status: planned ? "planned" : "completed",
      amounts: t[3] ? { [t[4]]: t[3] } : {},
    });
    stats.genesis++;
  }

  // --- Shape C: grant authorizations in accords ---
  for (const d of allDocs) {
    if (!/grant authorization/i.test(d.title)) continue;
    const content = stripLinks(d.content ?? "");
    if (DIRECTORY_RE.test(content.trim())) continue;
    const m = content.match(AUTH_GRANT_RE);
    if (!m) { warn(`grant authorization did not parse: ${d.doc_no} ("${d.title}")`); continue; }
    const recipient = resolveParty(m[3], d);
    const sender = resolveParty(m[4], d);
    if (!recipient || !sender) { warn(`grant authorization endpoints unresolved: ${d.doc_no}`); continue; }
    addAuthorization(sender, recipient, d, {
      amounts: { [`${m[2]} per month`]: m[1] },
      period_months: Number(m[5]),
      // "Spark Foundation Grant Authorization: December 2025" → "December 2025"
      period: d.title.match(/Grant Authorization:?\s*(.+)$/i)?.[1]?.trim(),
      begin_date: content.match(AUTH_BEGIN_RE)?.[1]?.trim(),
    });
    stats.authorizations++;
  }

  // --- Shape D: accord capital allocations ---
  for (const d of allDocs) {
    if (!ALLOCATION_TITLE_RE.test(d.title)) continue;
    const content = stripLinks(d.content ?? "");
    if (DIRECTORY_RE.test(content.trim())) continue;
    const m = content.match(ALLOCATION_RE);
    if (m) {
      const recipient = resolveParty(m[2], d, { create: false });
      if (!recipient) { warn(`allocation recipient unresolved "${m[2]}": ${d.doc_no}`); continue; }
      const vote = content.match(ALLOCATION_VOTE_RE)?.[1]?.trim();
      addTransfer(skyCore, recipient, d, {
        kind: "allocation",
        allocation_type: /genesis/i.test(m[1]) ? "genesis_capital" : "initial",
        status: vote ? "planned" : "allocated",
        amounts: { [m[4]]: m[3] },
        ...(vote ? { scheduled: vote } : {}),
      });
      stats.allocations++;
      continue;
    }
    // Enumerated form: one edge per "(n) {amount} {TOKEN} to {recipient}" item.
    const direct = content.match(ALLOCATION_DIRECT_RE);
    const items = direct ? [...content.matchAll(ALLOCATION_ITEM_RE)] : [];
    if (!direct || !items.length) { warn(`allocation did not parse: ${d.doc_no} ("${d.title}")`); continue; }
    const sender = resolveParty(direct[1], d, { create: false }) ?? skyCore;
    for (const item of items) {
      const rawRecipient = item[3].trim();
      const recipient = resolveParty(rawRecipient, d, { create: false });
      if (!recipient) { warn(`allocation recipient unresolved "${rawRecipient}": ${d.doc_no}`); continue; }
      addTransfer(sender, recipient, d, {
        kind: "allocation",
        allocation_type: "genesis_capital",
        status: "planned",
        amounts: { [item[2]]: item[1] },
        ...(rawRecipient !== recipient.name ? { account: rawRecipient } : {}),
      });
      stats.allocations++;
    }
  }

  // --- Shape E: executed budget transfers ---
  for (const d of allDocs) {
    if (/^(Minting|Transfer) Of Tokens/i.test(d.title)) continue; // Shape B owns these
    const content = stripLinks(d.content ?? "");
    if (DIRECTORY_RE.test(content.trim())) continue;
    const m = content.match(BUDGET_TRANSFER_RE);
    if (!m) continue;
    const fromRaw = m[1].trim();
    const from =
      resolveParty(fromRaw, d, { create: false }) ??
      resolveParty(trailingProperNoun(fromRaw), d, { create: false });
    const to = resolveParty(m[5], d, { create: false });
    if (!from || !to || from.id === to.id) {
      warn(`budget transfer endpoints unresolved: ${d.doc_no} ("${d.title}")`);
      continue;
    }
    addTransfer(from, to, d, {
      kind: "budget_transfer",
      status: "completed",
      amounts: { [m[3]]: m[2] },
      source_budget: m[4].trim(),
    });
    stats.budgetTransfers++;
  }

  return stats;
}
