// 2p. ecosystem_accord: accord doc → each party entity (a composite party or Sky
// Core), never the individual members. Built from Pattern 12's party-details scan.
function run(ctx) {
  for (const [accordDocNo, partyDocs] of ctx.accordPartyDocsByAccordDocNo) {
    const accordDoc = ctx.docByDocNo.get(accordDocNo);
    if (!accordDoc) continue;
    for (const { partyEntity } of partyDocs) {
      ctx.addEdge(accordDoc.id, "doc", partyEntity.id, "entity", "ecosystem_accord", [accordDocNo]);
    }
  }
}

export const pattern = { id: "2p", run };
