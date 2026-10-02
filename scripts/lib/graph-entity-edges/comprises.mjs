// 2q. comprises: composite party → each member (Pattern 12). The "Sky" party maps
// to the Sky Core bootstrap entity, so it gets no composite and no comprises edge.
// Members resolve against entities Phase 1 already created; nothing new is made here.
import { slugify } from "../graph-patterns.mjs";

const parseNameList = (str) =>
  str
    .split(/,\s*/)
    .flatMap((p) => p.split(/\s+and\s+/i))
    .map((s) => s.trim().replace(/^(?:the|and)\s+/i, "").trim())
    .filter(Boolean);

function resolveMember(ctx, rawName) {
  const cleaned = rawName.replace(/^the\s+/i, "").trim();
  if (/^Sky Core$/i.test(cleaned)) return ctx.skyCore;
  const stripped = cleaned.replace(/\s+(Prime Agent|Executor Agent)$/i, "").trim();
  if (stripped !== cleaned) {
    const hit = ctx.entityMap.get(slugify(stripped));
    if (hit) return hit;
  }
  return ctx.entityMap.get(slugify(cleaned)) ?? null;
}

// One edge per (party, member) pair. Every accord that restates the party is
// appended to sourceDocNos: a later accord restating "Grove comprises …" is
// provenance, not a duplicate to drop.
function run(ctx) {
  const emitted = new Map(); // `${party}:${member}` → edge
  for (const [, partyDocs] of ctx.accordPartyDocsByAccordDocNo) {
    for (const { partyEntity, sourceDocNo, memberStr, isSky } of partyDocs) {
      if (isSky) continue;
      for (const memberName of parseNameList(memberStr)) {
        const member = resolveMember(ctx, memberName);
        if (!member || member.id === partyEntity.id) continue;
        const key = `${partyEntity.id}:${member.id}`;
        const prior = emitted.get(key);
        if (!prior) emitted.set(key, ctx.addEdge(partyEntity.id, "entity", member.id, "entity", "comprises", [sourceDocNo]));
        else if (!prior.sourceDocNos.includes(sourceDocNo)) prior.sourceDocNos.push(sourceDocNo);
      }
    }
  }
}

export const pattern = { id: "2q", run };
