import { describe, it, expect } from "vitest";
import type { AtlasNode } from "@/types";
import {
  collectActorOmni,
  extraOmniSections,
  EMPTY_OMNI,
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
    });
    const agentEm = doc({
      id: "agent-em", doc_no: "A.6.1.1.1.3.1.3", title: REQUIRED_OMNI_TITLES.agentEmergency,
      parentId: gov.id, order: 2,
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
    expect(omni.root).toEqual({ id: "omni", docNo: "A.6.1.1.1.3", title: "Omni Documents" });
    expect(omni.sections.map((s) => s.id)).toEqual(["gov", "accords"]);
    expect(omni.required).toEqual({
      root: omni.root,
      govInfo: { id: "gov", docNo: "A.6.1.1.1.3.1", title: REQUIRED_OMNI_TITLES.govInfo },
      ecosystemEmergency: { id: "eco", docNo: "A.6.1.1.1.3.1.2", title: REQUIRED_OMNI_TITLES.ecosystemEmergency },
      agentEmergency: { id: "agent-em", docNo: "A.6.1.1.1.3.1.3", title: REQUIRED_OMNI_TITLES.agentEmergency },
    });
    expect(extraOmniSections(omni).map((s) => s.title)).toEqual(["Ecosystem Accords"]);
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
});
