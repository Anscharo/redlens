// Ambient types so TypeScript consumers (embed-units.ts, scripts_tests)
// can import from graph-patterns.mjs without a rewrite of the JS module.
export function isICD(d: { title: string; content?: string }): boolean;
export function isICDLocation(d: { title: string; content?: string }): boolean;

export const ERG_MEMBERSHIP_UUID: string;
export const ALIGNED_DELEGATES_UUID: string;
export const RANKED_DELEGATE_UUIDS: { get(level: number): string };
export const SPELL_TEAM_UUID: string;
export const ACTIVE_ECOSYSTEM_ACTORS_UUID: string;

export function makeEntity(
  slug: string,
  name: string,
  entity_type: string,
  opts?: {
    subtype?: string | null;
    defining_doc_id?: string | null;
    is_active?: number;
    meta?: unknown;
  },
): {
  id: string;
  slug: string;
  name: string;
  entity_type: string;
  subtype: string | null;
  defining_doc_id: string | null;
  is_active: number;
  meta: string | null;
};
