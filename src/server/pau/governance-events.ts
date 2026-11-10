// The events of the contracts that carry governance to a PAU, catalogued
// beside the PAU's own admin events (admin-events.ts) so the same cursors read
// them. They are evidence of where a change came from (origin.ts), not
// configuration:
//   - a prime's StarGuard: the Sky spell plots a star spell, a keeper later
//     executes it in its own transaction;
//   - an L2 Executor (spark-gov-relay): a bridge message queues an action set,
//     anyone executes it;
//   - the Configurator: an operator changes a rate limit within BeamState's
//     bounds, or calls a controller action, without a spell;
//   - the LayerZero Governance Sender: a spell's SubProxy sends a call to
//     another chain, named by its LayerZero guid, which the receiving
//     program's LzReceive carries (svm-receipts.ts).

export const STAR_GUARD_EVENTS = [
  "event Plot(address indexed addr, bytes32 tag, uint256 deadline)",
  "event Exec(address indexed addr)",
  "event Drop(address indexed addr)",
];

export const EXECUTOR_EVENTS = [
  "event ActionsSetQueued(uint256 indexed id, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, bool[] withDelegatecalls, uint256 executionTime)",
  "event ActionsSetExecuted(uint256 indexed id, address indexed initiatorExecution, bytes[] returnedData)",
  "event ActionsSetCanceled(uint256 indexed id)",
];

export const CONFIGURATOR_EVENTS = [
  "event SetRateLimit(address indexed rateLimits, bytes32 indexed key, uint256 maxAmount, uint256 slope)",
  "event CallControllerAction(address indexed controller, bytes data)",
];

export const LZ_SENDER_EVENTS = ["event GovernanceCallSent(bytes32 indexed guid)"];

/** Event names that are evidence of origin, never a configuration change of their own; `LzReceive` is a Solana governance receipt (svm-receipts.ts). */
export const ORIGIN_EVENTS = new Set(["Plot", "Exec", "Drop", "ActionsSetQueued", "ActionsSetExecuted", "ActionsSetCanceled", "SetRateLimit", "CallControllerAction", "GovernanceCallSent", "LzReceive"]);
