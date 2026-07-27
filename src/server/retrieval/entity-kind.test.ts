import { describe, it, expect } from "bun:test";
import { entityKindLabel } from "./entity-kind.ts";

describe("entityKindLabel", () => {
  it("composes agent subtypes as '<Subtype> Agent'", () => {
    expect(entityKindLabel("agent", "prime")).toBe("Prime Agent");
    expect(entityKindLabel("agent", "operational_executor")).toBe("Operational Executor Agent");
    expect(entityKindLabel("agent", "core_executor")).toBe("Core Executor Agent");
  });

  it("composes ecosystem_actor subtypes as '<Subtype> Ecosystem Actor'", () => {
    expect(entityKindLabel("ecosystem_actor", "individual")).toBe("Individual Ecosystem Actor");
    expect(entityKindLabel("ecosystem_actor", "integration_partner")).toBe("Integration Partner Ecosystem Actor");
    expect(entityKindLabel("ecosystem_actor", null)).toBe("Ecosystem Actor");
  });

  it("title-cases kebab primitive slugs for instance/primitive/invocation", () => {
    expect(entityKindLabel("instance", "distribution-reward")).toBe("Distribution Reward Instance");
    expect(entityKindLabel("primitive", "agent-creation")).toBe("Agent Creation Primitive");
    expect(entityKindLabel("invocation", "integration-boost")).toBe("Integration Boost Invocation");
  });

  it("falls back to the bare type label when there is no subtype", () => {
    expect(entityKindLabel("facilitator_org", null)).toBe("Facilitator");
    expect(entityKindLabel("govops_org", null)).toBe("GovOps");
    expect(entityKindLabel("multisig", null)).toBe("Multisig");
  });

  it("falls back to the raw string for unmapped types/subtypes", () => {
    expect(entityKindLabel("mystery_type", null)).toBe("mystery_type");
    expect(entityKindLabel("agent", "mystery_subtype")).toBe("mystery_subtype Agent");
  });

  it("ignores a subtype on an entity_type outside the subtype-composing groups (agent/ecosystem_actor/slug types)", () => {
    // multisig has a subtype value in this hypothetical, but multisig isn't
    // agent, ecosystem_actor, or in SLUG_SUBTYPE_TYPES — the bare type label
    // wins, the subtype is silently dropped.
    expect(entityKindLabel("multisig", "some_subtype")).toBe("Multisig");
  });
});
