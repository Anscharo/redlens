// Pattern 22: Prime Agent omni-doc governance metadata (Phase 2.8)
//
// Every Prime Agent's Omni Documents carry a uniform "Governance Information"
// subtree (A.6.1.1.X.3.1) whose direct children declare where the agent is
// governed and how it responds to emergencies:
//
//   A.6.1.1.X.3.1.N  Sky Forum                          "… use the '{Agent} Prime' category."
//   A.6.1.1.X.3.1.N  Discord                            "… located at [url](url)."
//   A.6.1.1.X.3.1.N  Sky Ecosystem Emergency Response   ecosystem-wide protocol (stub today)
//   A.6.1.1.X.3.1.N  Agent-Specific Emergency Response  agent-only protocol (stub today)
//
// These become doc → entity(prime agent) edges so the chatbot/MCP can answer
// "where does {Agent} discuss governance?" and "what is {Agent}'s emergency
// response?" without re-reading the omni tree. The forum category and Discord
// URL are extracted into edge meta for forum indexing.
//
// Accord declarations under the same omni subtree (A.6.1.1.X.3.{N} "Ecosystem
// Accord N") are NOT handled here: each already carries a `cites` edge (Pattern
// 8) to its canonical A.2.8.2.N accord doc, which is itself linked to the party
// entity via `ecosystem_accord` (Pattern 4). A new edge would be redundant.

const FORUM_CATEGORY_RE = /use the ['"“”]([^'"“”]+)['"“”]\s+category/i;
const MD_URL_RE = /\((https?:\/\/[^)]+)\)/;
const PLACEHOLDER_RE = /will be specified in a future iteration/i;

// Direct children of a Governance Information node (A.6.1.1.X.3.1).
const GOV_INFO_RE = /^A\.6\.1\.1\.\d+\.3\.1\.\d+$/;

export function extractOmni(allDocs, docById, docByDocNo, entityByDocId, edges) {
  let channels = 0;
  let emergencies = 0;
  let warnings = 0;

  const warn = (msg) => {
    warnings++;
    console.warn(`  [omni] ${msg}`);
  };

  // Resolve the Prime Agent entity owning a doc_no under A.6.1.1.X.
  const primeAgentFor = (docNo) => {
    const m = docNo.match(/^(A\.6\.1\.1\.\d+)\./);
    if (!m) return null;
    const agentDoc = docByDocNo.get(m[1]);
    if (!agentDoc) return null;
    return entityByDocId.get(agentDoc.id) ?? null;
  };

  for (const d of allDocs) {
    if (!GOV_INFO_RE.test(d.doc_no)) continue;
    const title = (d.title ?? "").trim();
    const isChannel = title === "Sky Forum" || title === "Discord";
    const isEmergency = /Emergency Response$/i.test(title);
    if (!isChannel && !isEmergency) continue;

    const agent = primeAgentFor(d.doc_no);
    if (!agent) {
      warn(`${d.doc_no} «${title}» — no Prime Agent entity resolved; skipping`);
      continue;
    }

    if (isChannel) {
      const platform = title === "Sky Forum" ? "forum" : "discord";
      const meta = { platform };
      const content = d.content ?? "";
      if (platform === "forum") {
        const m = content.match(FORUM_CATEGORY_RE);
        if (m) meta.category = m[1].trim();
        else warn(`${d.doc_no} Sky Forum — no category sentence matched`);
      } else {
        const m = content.match(MD_URL_RE);
        if (m) meta.url = m[1];
        else warn(`${d.doc_no} Discord — no URL matched`);
      }
      edges.push({
        fromId: d.id,
        fromType: "doc",
        toId: agent.id,
        toType: "entity",
        edgeType: "governance_channel",
        sourceDocNos: [d.doc_no],
        meta: JSON.stringify(meta),
      });
      channels++;
    } else {
      const scope = /^Sky Ecosystem/i.test(title) ? "ecosystem" : "agent_specific";
      const status = PLACEHOLDER_RE.test(d.content ?? "") ? "placeholder" : "specified";
      edges.push({
        fromId: d.id,
        fromType: "doc",
        toId: agent.id,
        toType: "entity",
        edgeType: "emergency_response",
        sourceDocNos: [d.doc_no],
        meta: JSON.stringify({ scope, status }),
      });
      emergencies++;
    }
  }

  return { channels, emergencies, warnings };
}
