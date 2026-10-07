import { ROUTES } from "@/lib/routes";
import type { AffectedDoc, Category, ChangeKind } from "./actorHistoryMerge";

// Copy and link helpers for the per-commit doc table in the Radar actor history.

export const CATEGORY_LABEL: Record<Category, string> = {
  definition: "agent definition",
  instance: "agent instance",
  param: "instance parameter",
  primitive: "primitive agent owns",
  reward: "rewards primitive",
  config: "instance config",
};

export const CATEGORY_TOOLTIP: Record<Category, string> = {
  definition: "The document that defines this agent's role, scope, and authorizations.",
  instance: "An active instance or invocation of this agent in the governance system.",
  param: "A document that is the source of a parameter for one of this agent's instances.",
  primitive: "A primitive that this agent is authorized to own and invoke.",
  reward: "The rewards primitive linked to this agent's compensation.",
  config: "A configuration document nested inside one of this agent's instances (e.g. rate limits, contract addresses, off-chain parameters).",
};

export const CHANGE_INDICATOR: Record<string, string> = {
  added: "+",
  modified: "~",
  removed: "−",
  moved: "→",
};

export function docHref(docId: string): string {
  return `${ROUTES.ATLAS}?id=${docId}&view=history`;
}

export function editTooltip(changeType: AffectedDoc["changeType"], changeKind?: ChangeKind): string {
  const base = `${changeType} doc`;
  if (!changeKind || changeKind === "semantic") return base;
  const detail = changeKind === "lint" ? "whitespace / formatting only" : "small letter-level edit";
  return `${base}  ·  ${changeKind} (${detail})`;
}
