// The Liquidity Layer page map, in short sentences. The chat's current-page
// section and the PAU tool descriptions both read these strings, so a model
// on the page and an MCP client meet one wording. This is Redline Portal's
// drawing of the page, not Atlas text.

export const PAU_LAYOUT = [
  "Map of a Prime's Liquidity Layer page. This is Redline Portal's drawing, not Atlas text. Do not cite it. A rule about who may act comes from an atlas document.",
  "The page holds, per chain: the contracts and who holds each role, the rate limits, the parameters (max slippage, max exchange rate, recipients), Configurator bounds on a Diamond, and the change history (spells and other setters).",
  "One deployment is one set of contracts on one chain. The page draws the same path twice: Monolithic controller, and Diamond PAU. PAU names only the Diamond design, a Parallelized Allocation Unit. The monolithic controller is the same Liquidity Layer. A dashed arrow exists only on some deployments. A box drawn with an outline exists only on a Diamond PAU.",
  "Admin (owner). The Prime's governance contract. Executive spells run it. Its arrow grants every role, and sets limits and parameters.",
  "Relayer (operator). The everyday key. It asks the Controller for a move. It holds no funds.",
  "Controller (control panel). The fixed menu of moves a relayer can ask for. It checks the rate limits, then draws them down. It executes the move through the ALM proxy.",
  "Rate limits (meter). How much each move can carry. They refill over time.",
  "ALM proxy (vault). It holds the funds. It acts only for its controller. It calls an allocation.",
  "Allocations (destinations). Lending markets, vaults, swaps and bridges.",
  "Freezer (emergency stop). It removes a relayer. It sets nothing and moves nothing. On a freezable proxy, and only on some deployments, it also removes that proxy's controller.",
  "A move goes Relayer, then Controller, then ALM proxy, then an allocation. Setting the rules is Admin, by a spell. Cutting off is the Freezer.",
].join("\n");

export const PAU_CLASSES = [
  "Every figure is one class. A fact's relation field says which.",
  "mirrors. The Atlas states the number and the contract holds the same number.",
  "differs. The Atlas states the number and the contract holds a different number, or the stated key is not set on the contract.",
  "pointed. The Atlas names the key, the role or the parameter. It does not hold the live reading. The live reading is the current maximum, the refill per day, the amount available, who holds the role now, the parameter's current value, and the transaction that set it. Cite set_at.url or the change row's url. Never cite an atlas document for a live reading.",
  "chain-only. A rate limit the Atlas does not name. name_source is derived or null. Say that the Atlas does not name it.",
].join("\n");

/** What redline_liquidity_changes returns, beside the rows. Chain evidence, not Atlas text. */
export const PAU_CHANGES_NOTE =
  "Configuration changes read from the chain, not Atlas text. A spell is named only where the chain proves one. Cite the row's url, never an atlas document. origin spell is an executive spell. origin operator is the Configurator, without a spell. origin relayed is an action set whose Ethereum spell is not proven. origin deployment is contract setup. queued lists steps that are scheduled and not yet run. An empty queued list is not proof that nothing is queued while a governance contract is still being read. A queued step on a shared executor names no prime, so an entity filter leaves it out.";
