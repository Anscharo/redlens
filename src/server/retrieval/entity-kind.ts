// Human-readable "kind" label for an entity's (entity_type, subtype) pair —
// e.g. ("agent", "prime") → "Prime Agent". Used by chat prefetch so the model
// sees "Spark — Prime Agent" instead of raw entity_type/subtype codes.
const TYPE_LABEL: Record<string, string> = {
  agent: "Agent",
  facilitator_org: "Facilitator",
  govops_org: "GovOps",
  delegate_org: "Delegate",
  development_company: "Development Company",
  foundation: "Foundation",
  composite_party: "Composite Party",
  governance_body: "Governance Body",
  operational_party: "Operational Party",
  ecosystem_actor: "Ecosystem Actor",
  multisig: "Multisig",
  bridge: "Bridge",
  src_member: "SRC Member",
  instance: "Instance",
  primitive: "Primitive",
  invocation: "Invocation",
};

// Subtype labels for entity_types whose subtype reads as an adjective in
// front of the type ("Prime Agent", "Individual Ecosystem Actor").
const AGENT_SUBTYPE_LABEL: Record<string, string> = {
  prime: "Prime",
  operational_executor: "Operational Executor",
  core_executor: "Core Executor",
};

const ACTOR_SUBTYPE_LABEL: Record<string, string> = {
  individual: "Individual",
  integration_partner: "Integration Partner",
  bridge_validator: "Bridge Validator",
};

// entity_types whose subtype is a kebab-case primitive slug ("distribution-reward")
// rather than a vocabulary word — title-case it instead of looking it up.
const SLUG_SUBTYPE_TYPES = new Set(["instance", "primitive", "invocation"]);

function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function entityKindLabel(entity_type: string, subtype: string | null): string {
  const type = TYPE_LABEL[entity_type] ?? entity_type;
  if (!subtype) return type;
  if (entity_type === "agent") return `${AGENT_SUBTYPE_LABEL[subtype] ?? subtype} ${type}`;
  if (entity_type === "ecosystem_actor") return `${ACTOR_SUBTYPE_LABEL[subtype] ?? subtype} ${type}`;
  if (SLUG_SUBTYPE_TYPES.has(entity_type)) return `${titleCaseSlug(subtype)} ${type}`;
  return type;
}
