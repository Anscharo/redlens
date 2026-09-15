// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActorOmni } from "./ActorOmni";
import { EMPTY_OMNI, type ActorOmni as ActorOmniData, type OmniDocRef } from "../../lib/omniDocs";

afterEach(cleanup);

function ref(id: string, title: string, docNo = "A.1", content = ""): OmniDocRef {
  return { id, docNo, title, content };
}

function omni(over: Partial<ActorOmniData>): ActorOmniData {
  return { ...EMPTY_OMNI, ...over };
}

describe("ActorOmni", () => {
  it("renders nothing when there is no root Omni Document", () => {
    const { container } = render(<ActorOmni omni={EMPTY_OMNI} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the required docs are only empty template stubs", () => {
    const root = ref("omni", "Omni Documents");
    const gov = ref("gov", "Governance Information Unrelated To Root Edit Primitive");
    const { container } = render(
      <ActorOmni
        omni={omni({
          root,
          sections: [gov],
          required: {
            root,
            govInfo: gov,
            ecosystemEmergency: ref("eco", "Sky Ecosystem Emergency Response", "A.1", "will be specified in a future iteration"),
            agentEmergency: ref("ag", "Agent-Specific Emergency Response", "A.1", "will be specified in a future iteration"),
          },
        })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("chips extra sections and skips listing required template titles", () => {
    const root = ref("omni", "Omni Documents", "A.6.1.1.1.3");
    const gov = ref("gov", "Governance Information Unrelated To Root Edit Primitive");
    render(
      <ActorOmni
        omni={omni({
          root,
          sections: [gov, ref("accords", "Ecosystem Accords", "A.6.1.1.1.3.2")],
          required: { root, govInfo: gov, ecosystemEmergency: null, agentEmergency: null },
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Omni" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ecosystem Accords" })).toHaveAttribute(
      "href",
      expect.stringContaining("accords"),
    );
    expect(screen.queryByText("Root")).not.toBeInTheDocument();
    expect(screen.queryByText("Governance information")).not.toBeInTheDocument();
    expect(screen.queryByText("missing")).not.toBeInTheDocument();
  });

  it("shows a specified emergency protocol excerpt, not the placeholder", () => {
    const root = ref("omni", "Omni Documents");
    render(
      <ActorOmni
        omni={omni({
          root,
          notes: [
            ref(
              "eco",
              "Sky Ecosystem Emergency Response",
              "A.1",
              "The Core Facilitator convenes an emergency call within 24 hours.",
            ),
          ],
          required: { root, govInfo: null, ecosystemEmergency: null, agentEmergency: null },
        })}
      />,
    );
    expect(screen.getByRole("link", { name: "Ecosystem emergency" })).toBeInTheDocument();
    expect(screen.getByText(/convenes an emergency call/)).toBeInTheDocument();
  });
});
