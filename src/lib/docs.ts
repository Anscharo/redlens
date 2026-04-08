import type { AtlasNode } from "../types";

let cached: Promise<Record<string, AtlasNode>> | null = null;

export function loadDocs(): Promise<Record<string, AtlasNode>> {
  if (!cached) cached = fetch(`${import.meta.env.BASE_URL}docs.json`).then((r) => r.json());
  return cached;
}
