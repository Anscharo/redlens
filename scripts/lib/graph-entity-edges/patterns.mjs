// The Phase 2 entity/address edge patterns, in run order. Order is load-bearing
// only where a step reads edges an earlier step emitted: role-index reads the role
// edges of 2j–2o, and 2s-ter reads the 2j–2l and 2s-bis edges. Edge order in
// relations.json follows this list.
//
// Add a pattern by writing a module that exports `pattern = { id, run(ctx) }` (ctx
// is built in context.mjs) and listing it here.
import { pattern as primeAgentFor } from "./prime-agent-for.mjs";
import { pattern as executorAgentFor } from "./executor-agent-for.mjs";
import { pattern as facilitatorFor } from "./facilitator-for.mjs";
import { pattern as govopsFor } from "./govops-for.mjs";
import { pattern as alignedDelegateFor } from "./aligned-delegate-for.mjs";
import { pattern as rankedDelegateFor } from "./ranked-delegate-for.mjs";
import { pattern as holdsRoleFor } from "./holds-role-for.mjs";
import { pattern as ecosystemAccord } from "./ecosystem-accord.mjs";
import { pattern as comprises } from "./comprises.mjs";
import { pattern as ergMemberFor } from "./erg-member-for.mjs";
import { pattern as roleIndex } from "./role-index.mjs";
import { pattern as responsiblePartyFor } from "./responsible-party-for.mjs";
import { pattern as processStepResponsiblePartyFor } from "./process-step-responsible-party-for.mjs";
import { pattern as dutyFor } from "./duty-for.mjs";
import { pattern as definesEntity } from "./defines-entity.mjs";
import { pattern as hasAddress } from "./has-address.mjs";
import { pattern as mentions } from "./mentions.mjs";
import { pattern as orgProse } from "./org-prose.mjs";
import { pattern as proxiesTo } from "./proxies-to.mjs";

export const ENTITY_EDGE_PATTERNS = [
  primeAgentFor,
  executorAgentFor,
  facilitatorFor,
  govopsFor,
  alignedDelegateFor,
  rankedDelegateFor,
  holdsRoleFor,
  ecosystemAccord,
  comprises,
  ergMemberFor,
  roleIndex,
  responsiblePartyFor,
  processStepResponsiblePartyFor,
  dutyFor,
  definesEntity,
  hasAddress,
  mentions,
  orgProse,
  proxiesTo,
];
