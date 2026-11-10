// The value a param's sentence states, from real atlas values: one address for
// an address key, the named thing ("Z is the <key>"), the value ("The <key> is
// Z"), and nothing for a sentence that defers, describes or garbles.
import { describe, expect, it } from "vitest";
import { paramGist } from "./paramGist.ts";

describe("paramGist", () => {
  it("states the one address an address, owner, role or admin key's sentence names", () => {
    expect(paramGist("Sentinel Role Address", "The Sentinel role is held by Soter Labs at `0xB597026150552bB3F6092aC685A2241C5FA77Ed0`.")).toBe("0xB597026150552bB3F6092aC685A2241C5FA77Ed0");
    expect(paramGist("Integration Partner Reward Address", "The reward address for the MarginFi Integration Boost is `AZtUUe9GvTFq9kfseu9jxTioSgdSfjgmZfGQBmhVpTj1 `on Solana.")).toBe("AZtUUe9GvTFq9kfseu9jxTioSgdSfjgmZfGQBmhVpTj1");
    expect(paramGist("Tracking Methodology", "Synthetic tagging of deposits from the LayerZero contract on Ethereum (`0x1e1D42781FC170EF9da004Fb735f56F0276d01B8`) and more.")).toBeNull();
  });
  it("states what the sentence names as the key", () => {
    expect(paramGist("Foundation", "The Spark Foundation is the Prime Foundation associated with Spark. Its mandate is to support Spark.")).toBe("The Spark Foundation");
    expect(paramGist("Development Company", "Phoenix Labs is a development company that provides services to the Spark Foundation.")).toBe("Phoenix Labs");
    expect(paramGist("Development Company", "Pattern Dev Co. is the development company that provides services to Pattern.")).toBe("Pattern Dev Co.");
  });
  it("states what the key's subject is, cut at its first comma", () => {
    expect(paramGist("Maximum Allocation", "The maximum allocation for this Instance is 20,000,000 USD.")).toBe("20,000,000 USD");
    expect(paramGist("CRR", "The CRR for this Instance, as specified in [A.3.2.1.1.1 - Capital Ratio Requirement](3828778e-0197-4ce9-a836-6770d04f2ea9), is 2%.")).toBe("2%");
    expect(paramGist("StarGuard Max Delay", "The Skybase StarGuard `maxDelay` is seven (7) days.")).toBe("Seven (7) days");
    expect(paramGist("Integration Boost Data Submission Responsible Actor", "The Data Submission Responsible Actor is the Core Council Risk Advisor..")).toBe("The Core Council Risk Advisor");
  });
  it("leaves a sentence that defers, describes or garbles", () => {
    expect(paramGist("Rate Limits", "The Rate Limits for this Instance are defined in [A.6.1 - Rate Limits](abc0b1fc-4922-40f1-8ea9-60fba89f0e5f).")).toBeNull();
    expect(paramGist("Integration Boost Savings Rate Adjustment Strategy", "The Integration Boost is calculated based on per block values for USDS in Aave.")).toBeNull();
    expect(paramGist("Integration Boost Data Submission Responsible Actor", "The Data Submission Responsible Actor is The Data Submission Responsible Actor is.")).toBeNull();
    expect(paramGist("Inflow Rate Limit", "The inflow rate limit parameters are:\n\n- maxAmount: N/A - swap only")).toBeNull();
  });
});
