// Fixtures shared by the identity gate's test files. Real documents, so that a
// measure which changes its answer on them fails a test and not a preview.
import type { SwapNode } from "./identity.ts";

export function mapOf(nodes: SwapNode[]): Map<string, SwapNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

// The real fork case (Redline-Group:ozone-executor-agent-artifact): UUID
// a491d7d0 kept its doc number but was repurposed from "Operational GovOps"
// (Ozone) to "Sky Primitives", and the old GovOps content moved (expanded) to a
// brand-new UUID 384d29b0.
export const OZONE_OLD = "Operational GovOps for Operational Executor Agent Ozone is Soter Labs.";
export const SKY_PRIMITIVES = "The documents herein implement the Sky Primitives for Ozone See [A.2.2 - Sky Primitives](https://sky-atlas.io/#fcde2604).";
export const OZONE_MOVED = OZONE_OLD + " Soter Labs plays a crucial role in implementing Prime Agent strategies.";
export const OZONE_MOVED_TYPO = OZONE_OLD.replace("Operational", "Operatonal") + " Soter Labs plays a crucial role here."; // subword typo
export const OZONE_SUBST = OZONE_OLD.replace("Soter Labs", "Acme Corp"); // a real word substitution, not a typo

// A real repurposed UUID, from upstream next-gen-atlas 93f7f49 (2026-07-30),
// which reordered the steps of a procedure: 2c2b3e9a held the approval step and
// now holds the swap step. The first real multi-line swap this suite pins.
// Measured on the search vector (title + body): cosine 0.718.
export const STEP_OLD = [
  "The operator must approve the PSM to spend USDC. The approval is needed for the PSM to be able to execute a `swap` of USDC.",
  "",
  "```",
  "proxy.doCall(",
  "    address(usdc),",
  "    abi.encodeCall(usdc.approve, (address(psm), usdcAmount))",
  ");",
  "```",
].join("\n");
export const STEP_NEW = [
  "The operator must swap USDC to DAI through the PSM using `sellGemNoFee` (1:1, no fee), routed through the `_swapUSDCToDAI` helper. The PSM can only supply as much DAI as it currently holds, so the operation first computes the maximum USDC swappable in one call as the PSM's DAI balance divided by `psmTo18ConversionFactor`.",
  "",
  "```",
  "function _swapUSDCToDAI(IALMProxy proxy, IPSMLike psm, uint256 usdcAmount) internal {",
  "        proxy.doCall(",
  "            address(psm),",
  "            abi.encodeCall(psm.sellGemNoFee, (address(proxy), usdcAmount))",
  "        );",
  "    }",
  "```",
].join("\n");
export const STEP_COSINE = 0.718;
