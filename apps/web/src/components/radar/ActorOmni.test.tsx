// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActorOmni } from "./ActorOmni";
import {
  EMPTY_OMNI,
  FUTURE_ITERATION_ESSENCE,
  REQUIRED_OMNI_TITLES,
  type ActorOmni as ActorOmniData,
  type OmniDocRef,
} from "../../lib/omniDocs";

afterEach(cleanup);

function ref(id: string, title: string, docNo = "A.1", content = ""): OmniDocRef {
  return { id, docNo, title, content };
}

function omni(over: Partial<ActorOmniData>): ActorOmniData {
  return { ...EMPTY_OMNI, ...over };
}

const ROOT = REQUIRED_OMNI_TITLES.root;
const GOV = REQUIRED_OMNI_TITLES.govInfo;
const ECO = REQUIRED_OMNI_TITLES.ecosystemEmergency;
const AGENT = REQUIRED_OMNI_TITLES.agentEmergency;

describe("ActorOmni", () => {
  it("renders nothing when there is no root Omni Document", () => {
    const { container } = render(<ActorOmni omni={EMPTY_OMNI} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the directory Omni Documents and Governance Information rows", () => {
    const root = ref("omni", ROOT);
    const gov = ref("gov", GOV);
    const { container } = render(
      <ActorOmni
        omni={omni({
          root,
          required: { root, govInfo: gov, ecosystemEmergency: null, agentEmergency: null },
        })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists only the emergency-response Omni docs, with the essence of each summary", () => {
    const root = ref(
      "omni",
      ROOT,
      "A.6.1.1.1.3",
      "The documents herein define Spark’s strategic intent and operational processes relating to infrastructure inherited from Sky Core, activities unrelated to Sky Primitives, or activities spanning multiple Sky Primitives.",
    );
    const gov = ref(
      "gov",
      GOV,
      "A.6.1.1.1.3.1",
      "The documents herein specify Spark governance information that is unrelated to the use of the Root Edit Primitive. The governance process for updating the Spark Artifact is specified in the Root Edit Primitive above at [A.6.1.1.1.2.2.2 - Root Edit Primitive](f60887de-a4eb-4e4b-8aa6-e22cf724772a).",
    );
    const eco = ref(
      "eco",
      ECO,
      "A.6.1.1.1.3.1.4",
      "The documents herein specify Spark’s emergency response protocol in situations that impact the entire Sky Ecosystem. This protocol will be specified in a future iteration of the Spark Artifact.",
    );
    const agent = ref(
      "ag",
      AGENT,
      "A.6.1.1.1.3.1.5",
      "The documents herein specify Spark’s emergency response protocol in situations solely impacting Spark versus the broader Sky Ecosystem. This protocol will be specified in a future iteration of the Spark Artifact.",
    );
    render(
      <ActorOmni
        omni={omni({
          root,
          sections: [gov, ref("accords", "Ecosystem Accords", "A.6.1.1.1.3.2")],
          notes: [ref("del", "Delegation Framework")],
          required: {
            root,
            govInfo: gov,
            ecosystemEmergency: eco,
            agentEmergency: agent,
          },
        })}
      />,
    );
    expect(screen.getByTestId("actor-omni")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Omni" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ECO })).toHaveClass("text-tan");
    expect(screen.getByRole("link", { name: AGENT })).toHaveClass("text-tan");
    expect(screen.getByRole("link", { name: ECO })).not.toHaveClass("text-accent");
    expect(screen.getAllByText(new RegExp(`“${FUTURE_ITERATION_ESSENCE}”`))).toHaveLength(2);
    expect(screen.queryByRole("link", { name: ROOT })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: GOV })).not.toBeInTheDocument();
    expect(screen.queryByText("Ecosystem Accords")).not.toBeInTheDocument();
    expect(screen.queryByText("Delegation Framework")).not.toBeInTheDocument();
  });

  it("does not list extra Omni sections when required docs are missing", () => {
    const root = ref("omni", ROOT, "A.6.1.1.1.3");
    const { container } = render(
      <ActorOmni
        omni={omni({
          root,
          sections: [ref("accords", "Ecosystem Accords", "A.6.1.1.1.3.2")],
          required: { root: null, govInfo: null, ecosystemEmergency: null, agentEmergency: null },
        })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
