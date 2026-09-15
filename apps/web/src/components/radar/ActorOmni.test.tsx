// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActorOmni } from "./ActorOmni";
import { EMPTY_OMNI, type ActorOmni as ActorOmniData, type OmniDocRef } from "../../lib/omniDocs";

afterEach(cleanup);

function ref(id: string, title: string, docNo = "A.1"): OmniDocRef {
  return { id, docNo, title };
}

describe("ActorOmni", () => {
  it("renders nothing when there is no root Omni Document", () => {
    const { container } = render(<ActorOmni omni={EMPTY_OMNI} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the required omni docs and extra sections", () => {
    const root = ref("omni", "Omni Documents", "A.6.1.1.1.3");
    const gov = ref("gov", "Governance Information Unrelated To Root Edit Primitive");
    const omni: ActorOmniData = {
      root,
      sections: [gov, ref("accords", "Ecosystem Accords", "A.6.1.1.1.3.2")],
      required: {
        root,
        govInfo: gov,
        ecosystemEmergency: ref("eco", "Sky Ecosystem Emergency Response"),
        agentEmergency: null,
      },
    };
    render(<ActorOmni omni={omni} />);
    expect(screen.getByRole("heading", { name: "Omni Documents" })).toBeInTheDocument();
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Omni Documents" })).toHaveAttribute(
      "href",
      expect.stringContaining("omni"),
    );
    expect(screen.getByText("Governance information")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ecosystem Accords" })).toBeInTheDocument();
    expect(screen.getByText("A.6.1.1.1.3.2")).toBeInTheDocument();
  });
});
