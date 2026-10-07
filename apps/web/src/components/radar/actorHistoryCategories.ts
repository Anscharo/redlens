import type { ActorProfile } from "../../lib/actorIndex";
import type { AtlasNode } from "@/types";
import { descendantIds } from "../../lib/instanceDescendants";
import type { Category } from "./actorHistoryMerge";

// Which of an actor's docs count as relevant to its history, and why.

type CategoryLayer = [Category, Iterable<string | null | undefined>];

// Lowest priority first: a later layer overrides an earlier one for the same doc.
function categoryLayers(profile: ActorProfile, byParent: Map<string | null, AtlasNode[]>): CategoryLayer[] {
  // Invocation ICDs feed into history alongside instance ICDs — they're the
  // same kind of governance doc, just at a different lifecycle stage.
  const icds = [...profile.instances, ...profile.invocations];
  return [
    ["primitive", icds.map((i) => i.primitiveDocId)],
    ["reward", [profile.rewardsAgent?.dr?.primitiveId, profile.rewardsAgent?.ib?.primitiveId]],
    // Every doc nested under an instance/invocation root, so subtree edits (rate
    // limits, contract addresses, off-chain params) surface. Written before
    // param/instance/definition so those more-specific categories override a doc
    // that is both a descendant and, say, a param source.
    ["config", icds.flatMap((i) => (i.docId ? [...descendantIds(i.docId, byParent)] : []))],
    // Param-source docs next so the instance-root override wins if a param
    // points at its own config root (rare but possible).
    ["param", icds.flatMap((i) => i.signalParams.map((p) => p.srcDocId))],
    ["instance", icds.map((i) => i.docId)],
    ["definition", [profile.definingDoc?.id]],
  ];
}

export function buildDocCategoryMap(
  profile: ActorProfile,
  byParent: Map<string | null, AtlasNode[]>,
): Map<string, Category> {
  const map = new Map<string, Category>();
  for (const [category, ids] of categoryLayers(profile, byParent)) {
    for (const id of ids) if (id) map.set(id, category);
  }
  return map;
}
