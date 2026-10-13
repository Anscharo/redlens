// Risk-rules triage as four Jev (TypeSafe System One) yes/no questions over one
// paragraph: is it an operative rule, and does it belong to each of the three
// review domains. Jev returns P(yes) per question, never prose; the paragraph's
// description is written by the assess stage instead (assess-risk-prompt.ts).
// inScope is derived (any domain at or above τ), never asked, so it can't
// disagree with the domain answers.

import type { AtlasNode } from "../../src/types";
import { RISK_DOMAINS, type RiskCandidate } from "../../src/lib/riskRules";
import type { RiskTriage, RiskTriageProbabilities } from "../../src/lib/riskAssessment";
import { askJev, noulOf, type JevQuestion } from "../../src/server/jev";
import { candidateHeader, capped } from "./assess-risk-prompt";

const ATLAS = "the Sky Atlas, the rulebook of the Sky stablecoin protocol (Sky Core mints USDS; Primes, also called Stars, allocate USDS)";

const domainQuestion = (scope: string, notInScope: string): JevQuestion => ({
  type: "noul",
  instructions: {
    task: `Does this paragraph of ${ATLAS} belong to a risk-management review of ${scope}?`,
    counts: `Rules, parameters, processes or efforts whose subject is ${scope}.`,
    doesNotCount: `${notInScope} Passing mentions of a risk term inside an unrelated subject.`,
  },
});

export const TRIAGE_QUESTIONS: Record<keyof RiskTriageProbabilities, JevQuestion> = {
  isRule: {
    type: "noul",
    instructions: {
      task: `Is this paragraph of ${ATLAS} operative text: does it constrain behavior, set a parameter, or define a process with steps?`,
      counts: "Requirements, limits, parameters, procedures. A stub that promises a future rule (\"specified in a future iteration\") counts: the absence is the finding.",
      doesNotCount: "Pure container intros (\"The documents herein…\"), pure definitions that constrain nothing, passing mentions. Contract addresses, role-holder assignments and descriptions of what a contract does are not rules.",
    },
  },
  peg: domainQuestion(
    "maintaining the USDS peg (stability parameters, the PSM, stabilizing collateral, asset-liability rules that serve peg defense)",
    "Financial-statement audits, marketing, compensation accounting.",
  ),
  alloc: domainQuestion(
    "managing the risk of USDS allocations (Risk Capital, exposure and concentration limits, collateral and vault parameters, liquidation, buffers, backstops, RWA counterparty risk)",
    "Financial-statement audits, marketing, compensation accounting that merely references a risk term.",
  ),
  sc: domainQuestion(
    "smart contract security (audits of code, governance security delays, circuit breakers, multisigs, admin keys, emergency spells and response, spell testing and insurance)",
    "Financial-statement audits. Governance procedure with no security character.",
  ),
};

export function triageState(c: RiskCandidate, docs: Record<string, AtlasNode>): unknown {
  return {
    about: candidateHeader(c, docs).filter((l): l is string => l !== null),
    paragraphText: capped(c.quote),
  };
}

export async function askTriage(c: RiskCandidate, docs: Record<string, AtlasNode>, model: string): Promise<RiskTriageProbabilities> {
  const run = await askJev({ state: triageState(c, docs), questions: TRIAGE_QUESTIONS, model, lane: "risk-triage", timeoutMs: 30_000 });
  const p = (id: keyof RiskTriageProbabilities) => {
    const v = noulOf(run, id);
    if (v === null) throw new Error(`jev answered no noul for ${id}`);
    return v;
  };
  return { isRule: p("isRule"), peg: p("peg"), alloc: p("alloc"), sc: p("sc") };
}

export function verdictAt(p: RiskTriageProbabilities, tau: { rule: number; domain: number }): RiskTriage {
  const domains = RISK_DOMAINS.filter((d) => p[d] >= tau.domain);
  return { inScope: domains.length > 0, domains, isRule: p.isRule >= tau.rule, p };
}

