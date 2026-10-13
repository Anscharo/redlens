import type { AtlasNode, GraphEntity } from "@/types";
import type { InstanceMeta, InvocationMeta } from "@/lib/rewardsTypes";
import { instanceSignalParams, type InstanceParam } from "@/lib/radarRules";

export interface RadarInstance {
  id: string;
  slug: string;
  rawName: string;
  st: string;
  displayName: string;
  status: string | null;
  docId: string | null;
  docNo: string | null;
  primitiveTitle: string | null;
  primitiveDocId: string | null;
  primitiveCategory: string | null;
  primitiveCategoryDocId: string | null;
  isUnknownPrimitive: boolean;
  signalParams: InstanceParam[];
}

/** One ICD entity as the actor page draws it. `instanceOfMap` is `buildInstanceOfMap`'s. */
export function toRadarInstance(
  ent: GraphEntity,
  meta: InstanceMeta | InvocationMeta,
  docs: Record<string, AtlasNode>,
  instanceOfMap: ReadonlyMap<string, string>,
): RadarInstance {
  const signalParams = instanceSignalParams(meta);
  const instDoc = ent.did ? docs[ent.did] : null;
  const primitiveDocId = ent.did ? (instanceOfMap.get(ent.did) ?? null) : null;
  const primitiveDoc = primitiveDocId ? docs[primitiveDocId] : null;
  return {
    id: ent.id,
    slug: ent.slug,
    rawName: ent.name,
    st: ent.st ?? "",
    displayName: ent.name,
    status: meta.status,
    docId: ent.did,
    docNo: instDoc?.doc_no ?? null,
    primitiveTitle: primitiveDoc?.title ?? null,
    primitiveDocId,
    primitiveCategoryDocId: meta.primitive_category_doc_id ?? null,
    primitiveCategory: meta.primitive_category_doc_id ? (docs[meta.primitive_category_doc_id]?.title ?? null) : null,
    isUnknownPrimitive: meta.is_unknown_primitive ?? false,
    signalParams,
  };
}
