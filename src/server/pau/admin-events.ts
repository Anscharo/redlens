// The governance events a PAU contract emits: role grants, rate-limit settings,
// per-pool parameters, diamond integrations. These change only by spell or
// admin action, so their history is the PAU's configuration history. Operational
// events (relayer swaps, rate-limit triggers, deposits) are deliberately absent:
// they are high volume and say nothing about configuration.
//
// Facet events are emitted by the diamond Controller (facets run by
// delegatecall), so they are listed under the controller, not the facet.
import { decodeEventLog, parseAbi, toEventSelector, type AbiEvent } from "viem";
import type { PauKind, PauRole } from "../../lib/pauRegistry.ts";
import { CONFIGURATOR_EVENTS, EXECUTOR_EVENTS, STAR_GUARD_EVENTS } from "./governance-events.ts";

const ROLE_EVENTS = [
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
];

const INTEGRATION_EVENTS = [
  "struct Wire { bytes4 callSelector; bytes4 delegateSelector; }",
  "struct Config { address facet; Wire[] wires; }",
  "event IntegrationSet(bytes32 indexed id, Config config)",
  "event IntegrationRemoved(bytes32 indexed id)",
];

const MONOLITH_CONTROLLER_EVENTS = [
  ...ROLE_EVENTS,
  "event RelayerRemoved(address indexed relayer)",
  "event MaxSlippageSet(address indexed pool, uint256 maxSlippage)",
  "event MaxExchangeRateSet(address indexed token, uint256 maxExchangeRate)",
  "event MintRecipientSet(uint32 indexed destinationDomain, bytes32 mintRecipient)",
  "event LayerZeroRecipientSet(uint32 indexed destinationEndpointId, bytes32 layerZeroRecipient)",
  "event CentrifugeRecipientSet(uint16 indexed centrifugeId, bytes32 recipient)",
  "event MerklDistributorSet(address indexed merklDistributor)",
  "event UniswapV3PoolLowerTickUpdated(address indexed pool, int24 lowerTick)",
  "event UniswapV3PoolUpperTickUpdated(address indexed pool, int24 upperTick)",
  "event UniswapV3PoolMaxTickDeltaSet(address indexed pool, uint24 maxTickDelta)",
  "event UniswapV3PoolTwapSecondsAgoUpdated(address indexed pool, uint32 twapSecondsAgo)",
];

const DIAMOND_CONTROLLER_EVENTS = [
  ...INTEGRATION_EVENTS,
  "event AaveMaxSlippageSet(address indexed aToken, uint256 maxSlippage)",
  "event CurveMaxSlippageSet(address indexed pool, uint256 maxSlippage)",
  "event OTCMaxSlippageSet(address indexed exchange, uint256 maxSlippage)",
  "event UniswapV3MaxSlippageSet(address indexed pool, uint256 maxSlippage)",
  "event UniswapV4MaxSlippageSet(bytes32 indexed poolId, uint256 maxSlippage)",
  "event ERC4626MaxExchangeRateSet(address indexed token, uint256 maxExchangeRate)",
  "event CCTPDomainParametersSet(uint32 indexed destinationDomain, bytes32 indexed mintRecipient, uint32 minFeeCapRate, uint32 maxFeeCapRate)",
  "event CentrifugeRecipientSet(uint16 indexed centrifugeId, bytes32 indexed recipient)",
  "event USDSVaultSet(address indexed vault)",
  "event OTCBufferSet(address indexed exchange, address indexed buffer)",
  "event OTCRechargeRateSet(address indexed exchange, uint256 normalizedRate)",
  "event MerklToggleOperator(address indexed distributor, address indexed operator)",
  "event EthenaSetDelegatedSigner(address indexed delegatedSigner)",
  "event EthenaRemoveDelegatedSigner(address indexed delegatedSigner)",
  "event UniswapV3LowerTickSet(address indexed pool, int24 lowerTick)",
  "event UniswapV3UpperTickSet(address indexed pool, int24 upperTick)",
  "event UniswapV3MaxTickDeltaSet(address indexed pool, uint24 maxTickDelta)",
  "event UniswapV3TWAPSecondsAgoSet(address indexed pool, uint32 twapSecondsAgo)",
  "event UniswapV4TickLimitsSet(bytes32 indexed poolId, int24 tickLowerMin, int24 tickUpperMax, uint24 maxTickSpacing)",
];

const ADMINISTERED_AGENT_EVENTS = ["Actor", "Admin", "Grantor", "Revoker"].flatMap((who) => [
  `event ${who}Added(address indexed account, address indexed caller)`,
  `event ${who}Removed(address indexed account, address indexed caller)`,
]);

const RATE_LIMIT_EVENTS = [
  ...ROLE_EVENTS,
  "event RateLimitDataSet(bytes32 indexed key, uint256 maxAmount, uint256 slope, uint256 lastAmount, uint256 lastUpdated)",
];

// BeamState: the defaults and step limits the Configurator (cBEAM) raises rate
// limits within, per registered RateLimits or for all (rateLimits_ = 0).
const BEAM_STATE_EVENTS = [
  "event AddRateLimits(address indexed rateLimits_)",
  "event DelRateLimits(address indexed rateLimits_)",
  "event AddInitRateLimits(bytes32 indexed key, address indexed rateLimits_, uint256 maxAmount, uint256 slope)",
  "event DelInitRateLimits(bytes32 indexed key, address indexed rateLimits_)",
  "event SetHop(address indexed rateLimits_, uint256 value)",
  "event SetMaxChange(address indexed rateLimits_, uint256 value)",
];

const events = (sigs: string[]) => parseAbi(sigs).filter((x): x is AbiEvent => x.type === "event");

// The contracts that carry governance to either generation (governance-events.ts).
// Shared contracts are read as diamond members (sync-events.ts), so the
// Executors and the Configurator listed under `shared` resolve here too.
const GOVERNANCE: Partial<Record<PauRole, AbiEvent[]>> = {
  starGuard: events(STAR_GUARD_EVENTS),
  executor: events(EXECUTOR_EVENTS),
  configurator: events(CONFIGURATOR_EVENTS),
};

/** Admin events per (generation, role). A role with none (relayer, freezer, facet) is not polled. */
const BY_ROLE: Record<PauKind, Partial<Record<PauRole, AbiEvent[]>>> = {
  monolithic: {
    ...GOVERNANCE,
    controller: events(MONOLITH_CONTROLLER_EVENTS),
    almProxy: events(ROLE_EVENTS),
    rateLimits: events(RATE_LIMIT_EVENTS),
  },
  diamond: {
    ...GOVERNANCE,
    controller: events(DIAMOND_CONTROLLER_EVENTS),
    almProxy: events([...ROLE_EVENTS, "event ControllerRemoved(address indexed controller)"]),
    rateLimits: events(RATE_LIMIT_EVENTS),
    accessControls: events(ROLE_EVENTS),
    administeredAgent: events(ADMINISTERED_AGENT_EVENTS),
    beacon: events([...INTEGRATION_EVENTS, ...ROLE_EVENTS]),
    beamState: events(BEAM_STATE_EVENTS),
  },
};

/** The admin events a contract in `role` emits, one entry per distinct topic0. */
export function adminTopics(kind: PauKind, role: PauRole): { topic0: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const e of BY_ROLE[kind][role] ?? []) seen.set(toEventSelector(e), e.name);
  return [...seen].map(([topic0, name]) => ({ topic0, name }));
}

const ALL = Object.values(BY_ROLE).flatMap((r) => Object.values(r).flat());

/**
 * The argument a parameter event is keyed by: its first ABI input (the pool,
 * token, domain or vault). Read from the ABI because stored args come back from
 * jsonb, which orders keys by length, not by the event's argument order.
 */
export const subjectKey = (event: string): string | null => ALL.find((e) => e.name === event)?.inputs[0]?.name ?? null;

/** JSON-safe copy: bigints as decimal strings, addresses lowercased, tuples kept as objects. */
export function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : v;
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]));
  return v;
}

/**
 * Decodes one admin log; null for a log no catalogued event matches. Two
 * events can share a topic0 and differ only in which arguments are indexed
 * (CentrifugeRecipientSet), so every candidate is tried.
 */
export function decodeAdminLog(topics: string[], data: string): { event: string; args: Record<string, unknown> } | null {
  const candidates = ALL.filter((e) => toEventSelector(e) === topics[0]);
  for (const abiEvent of candidates) {
    try {
      const d = decodeEventLog({ abi: [abiEvent], topics: topics as [`0x${string}`], data: data as `0x${string}` });
      return { event: d.eventName, args: jsonSafe(d.args) as Record<string, unknown> };
    } catch {
      // indexing differs; try the next candidate
    }
  }
  return null;
}
