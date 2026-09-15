import { describe, it, expect } from "vitest";
import type { AtlasNode } from "@/types";
import {
  collectActorOmni,
  extraOmniSections,
  omniEssence,
  requiredOmniDocs,
  EMPTY_OMNI,
  FUTURE_ITERATION_ESSENCE,
  REQUIRED_OMNI_TITLES,
} from "./omniDocs";

function doc(over: Partial<AtlasNode> & Pick<AtlasNode, "id" | "doc_no" | "title">): AtlasNode {
  return {
    type: "Core",
    depth: 3,
    parentId: null,
    content: "",
    order: 0,
    addressRefs: [],
    ...over,
  };
}

describe("collectActorOmni", () => {
  it("returns EMPTY_OMNI when there is no defining doc", () => {
    expect(collectActorOmni(null, {})).toEqual(EMPTY_OMNI);
  });

  it("returns EMPTY_OMNI when the defining doc has no Omni Documents child", () => {
    const root = doc({ id: "agent", doc_no: "A.6.1.1.9", title: "PrimeX" });
    expect(collectActorOmni(root, { [root.id]: root })).toEqual(EMPTY_OMNI);
  });

  it("collects the required subtree plus extra top-level sections", () => {
    const agent = doc({ id: "agent", doc_no: "A.6.1.1.1", title: "Spark" });
    const root = doc({
      id: "omni", doc_no: "A.6.1.1.1.3", title: REQUIRED_OMNI_TITLES.root,
      parentId: agent.id, order: 0,
    });
    const gov = doc({
      id: "gov", doc_no: "A.6.1.1.1.3.1", title: REQUIRED_OMNI_TITLES.govInfo,
      parentId: root.id, order: 0,
    });
    const forum = doc({
      id: "forum", doc_no: "A.6.1.1.1.3.1.1", title: "Sky Forum",
      parentId: gov.id, order: 0,
    });
    const eco = doc({
      id: "eco", doc_no: "A.6.1.1.1.3.1.2", title: REQUIRED_OMNI_TITLES.ecosystemEmergency,
      parentId: gov.id, order: 1,
      content: "This protocol will be specified in a future iteration of the Spark Artifact.",
    });
    const agentEm = doc({
      id: "agent-em", doc_no: "A.6.1.1.1.3.1.3", title: REQUIRED_OMNI_TITLES.agentEmergency,
      parentId: gov.id, order: 2,
      content: "This protocol will be specified in a future iteration of the Spark Artifact.",
    });
    const accords = doc({
      id: "accords", doc_no: "A.6.1.1.1.3.2", title: "Ecosystem Accords",
      parentId: root.id, order: 1,
    });
    const docs: Record<string, AtlasNode> = {
      [agent.id]: agent, [root.id]: root, [gov.id]: gov,
      [forum.id]: forum, [eco.id]: eco, [agentEm.id]: agentEm, [accords.id]: accords,
    };

    const omni = collectActorOmni(agent, docs);
    expect(omni.root).toEqual({
      id: "omni", docNo: "A.6.1.1.1.3", title: "Omni Documents", content: "",
    });
    expect(omni.sections.map((s) => s.id)).toEqual(["gov", "accords"]);
    expect(omni.notes).toEqual([]);
    expect(omni.required.ecosystemEmergency?.id).toBe("eco");
    expect(omni.required.agentEmergency?.id).toBe("agent-em");
    expect(extraOmniSections(omni).map((s) => s.title)).toEqual(["Ecosystem Accords"]);
    expect(requiredOmniDocs(omni).map((s) => s.title)).toEqual([
      REQUIRED_OMNI_TITLES.root,
      REQUIRED_OMNI_TITLES.govInfo,
      REQUIRED_OMNI_TITLES.ecosystemEmergency,
      REQUIRED_OMNI_TITLES.agentEmergency,
    ]);
  });

  it("still finds emergencies when parentId is flattened at the depth-6 cap", () => {
    const agent = doc({ id: "agent", doc_no: "A.6.1.1.1", title: "Spark" });
    const root = doc({
      id: "omni", doc_no: "A.6.1.1.1.3", title: REQUIRED_OMNI_TITLES.root,
      parentId: agent.id,
    });
    const gov = doc({
      id: "gov", doc_no: "A.6.1.1.1.3.1", title: REQUIRED_OMNI_TITLES.govInfo,
      parentId: root.id,
    });
    // 7-segment child: heading cap emits it as a sibling of Governance
    // Information (parentId = omni root), not as gov's child.
    const eco = doc({
      id: "eco", doc_no: "A.6.1.1.1.3.1.4", title: REQUIRED_OMNI_TITLES.ecosystemEmergency,
      parentId: root.id,
    });
    const omni = collectActorOmni(agent, {
      [agent.id]: agent, [root.id]: root, [gov.id]: gov, [eco.id]: eco,
    });
    expect(omni.sections.map((s) => s.id)).toEqual(["gov"]);
    expect(omni.required.ecosystemEmergency?.id).toBe("eco");
  });

  it("keeps required emergencies null when Governance Information is present but they are not", () => {
    const agent = doc({ id: "agent", doc_no: "A.6.1.1.5", title: "Obex" });
    const root = doc({
      id: "omni", doc_no: "A.6.1.1.5.3", title: REQUIRED_OMNI_TITLES.root,
      parentId: agent.id,
    });
    const gov = doc({
      id: "gov", doc_no: "A.6.1.1.5.3.1", title: REQUIRED_OMNI_TITLES.govInfo,
      parentId: root.id,
    });
    const omni = collectActorOmni(agent, { [agent.id]: agent, [root.id]: root, [gov.id]: gov });
    expect(omni.required.govInfo?.id).toBe("gov");
    expect(omni.required.ecosystemEmergency).toBeNull();
    expect(omni.required.agentEmergency).toBeNull();
  });

  it("puts a specified emergency and a delegation doc in notes, skipping forum and stubs", () => {
    const agent = doc({ id: "agent", doc_no: "A.6.1.1.1", title: "Spark" });
    const root = doc({
      id: "omni", doc_no: "A.6.1.1.1.3", title: REQUIRED_OMNI_TITLES.root, parentId: agent.id,
    });
    const gov = doc({
      id: "gov", doc_no: "A.6.1.1.1.3.1", title: REQUIRED_OMNI_TITLES.govInfo, parentId: root.id,
    });
    const forum = doc({
      id: "forum", doc_no: "A.6.1.1.1.3.1.1", title: "Sky Forum", parentId: gov.id, order: 0,
    });
    const eco = doc({
      id: "eco", doc_no: "A.6.1.1.1.3.1.2", title: REQUIRED_OMNI_TITLES.ecosystemEmergency,
      parentId: gov.id, order: 1,
      content: "This protocol will be specified in a future iteration of the Spark Artifact.",
    });
    const specified = doc({
      id: "agent-em", doc_no: "A.6.1.1.1.3.1.3", title: REQUIRED_OMNI_TITLES.agentEmergency,
      parentId: gov.id, order: 2,
      content: "The Core Facilitator convenes an emergency call within 24 hours.",
    });
    const delegates = doc({
      id: "del", doc_no: "A.6.1.1.1.3.1.4", title: "Delegation Framework",
      parentId: gov.id, order: 3,
      content: "The documents herein specify Spark’s governance delegation system.",
    });
    const omni = collectActorOmni(agent, {
      [agent.id]: agent, [root.id]: root, [gov.id]: gov,
      [forum.id]: forum, [eco.id]: eco, [specified.id]: specified, [delegates.id]: delegates,
    });
    expect(omni.notes.map((n) => n.title)).toEqual([
      REQUIRED_OMNI_TITLES.agentEmergency,
      "Delegation Framework",
    ]);
  });
});

describe("omniEssence", () => {
  it("extracts the future-iteration clause from emergency stubs", () => {
    expect(
      omniEssence(
        "The documents herein specify Spark’s emergency response protocol in situations that impact the entire Sky Ecosystem. This protocol will be specified in a future iteration of the Spark Artifact.",
      ),
    ).toBe(FUTURE_ITERATION_ESSENCE);
  });

  it("takes the relating-to remainder of the Omni Documents directory sentence", () => {
    expect(
      omniEssence(
        "The documents herein define Spark’s strategic intent and operational processes relating to infrastructure inherited from Sky Core, activities unrelated to Sky Primitives, or activities spanning multiple Sky Primitives.",
      ),
    ).toBe(
      "infrastructure inherited from Sky Core, activities unrelated to Sky Primitives, or activities spanning multiple Sky Primitives",
    );
  });

  it("prefers the non-directory sentence of governance information", () => {
    expect(
      omniEssence(
        "The documents herein specify Spark governance information that is unrelated to the use of the Root Edit Primitive. The governance process for updating the Spark Artifact is specified in the Root Edit Primitive above at [A.6.1.1.1.2.2.2 - Root Edit Primitive](f60887de-a4eb-4e4b-8aa6-e22cf724772a).",
      ),
    ).toBe(
      "The governance process for updating the Spark Artifact is specified in the Root Edit Primitive",
    );
  });

  it("keeps a specified emergency's operational sentence", () => {
    const text = "The Core Facilitator convenes an emergency call within 24 hours.";
    expect(omniEssence(text)).toBe("The Core Facilitator convenes an emergency call within 24 hours");
  });
});
