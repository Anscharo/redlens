# Briefing writer comparison: Sonnet against Gemini 3.8 Flash

Measured 2026-10-01. Both models wrote briefings for the same 2,331 pilot documents (the documents the
retrieval eval's 179 queries compete over). Sonnet wrote through subagents; `google/gemini-3.8-flash`
wrote through OpenRouter with the worker's prompt. Each set was scored alone on the same pool:
683 units, 178 queries, `qwen/qwen3-embedding-8b`, one briefing vector per document, exact-document
hits in the top 10.

| Query shape | No briefings | Sonnet | Gemini | Gemini − Sonnet [95% interval] | Queries Gemini / Sonnet won |
|---|---|---|---|---|---|
| questions | 0.697 | 0.820 | 0.815 | −0.6 [−5.1, 3.9] | 8 / 9 |
| keywords | 0.624 | 0.708 | 0.753 | +4.5 [0.6, 8.4] | 11 / 3 |

By slice, Gemini − Sonnet in exact hits:

| Slice | Questions | Keywords |
|---|---|---|
| icd-disambiguation (n=40) | +5.0 [−7.5, 20.0], 5 / 3 | +17.5 [5.0, 30.0], 8 / 1 |
| icd-param (n=39) | 0.0 [−10.3, 10.3], 2 / 2 | +2.6 [−5.1, 10.3], 2 / 1 |
| kv-record (n=24) | −16.7 [−33.3, −4.2], 0 / 4 | −4.2 [−12.5, 0.0], 0 / 1 |

What the lists below show:

- Sonnet's wins on question queries are four key-value record documents and five instance documents.
  Its briefings there are longer and restate the value or the neighbouring documents.
- Gemini's wins are mostly instance disambiguation on keyword queries. Its briefings are shorter
  (median 113 characters against 160) and name the instance once, so less text competes with the name.
- Sonnet gave three questions in 153 rows; Gemini in 10.

The lists hold every query where exactly one writer put the target in the top 10, with both briefings
for the target. The same records, without the briefing text, are in `briefing-writer-comparison.json`.
Documents are named by title and UUID, never by doc number. The decision taken from this: the worker
writes with Gemini, and the 8,958 Sonnet rows already written stay.

Reproduce: `pnpm briefings:plan --eval-targets --force`, write the chunks with each model,
`pnpm briefings:merge --model=<name>`, then `bun scripts/eval/eval-retrieval.ts --backend openrouter
--reuse-db --policies kv_records_breadcrumbs --briefings none,s2docs --briefing-text both --pool covered
--briefing-file <pilot file>` once per writer and per `--query-style`. The Sonnet file must be cut to
the UUIDs in the Gemini file so both runs use one pool.

## Queries the writers split on

### Sonnet found it, Gemini did not — questions (9)

By slice: icd-disambiguation 3, icd-param 2, kv-record 4.

- **`dis-28`** (icd-disambiguation) — query: "contract for the asset Ethereum Mainnet - Morpho Grove x Steakhouse High Yield Vault USDC issues". Found with no briefings: no.
  - Target: Token Address [Core] `dcdff78c-809f-4ec8-80a2-36c124ca9ae8`
    - Sonnet: Records the vault token contract address of the Morpho Grove x Steakhouse High Yield Vault USDC Instance on Ethereum Mainnet. Questions: What is the token address of the Morpho Grove x Steakhouse High Yield Vault USDC Instance? Where is the vault token contract of the Grove x Steakhouse High Yield Vault USDC Instance?
    - Gemini: Defines the smart contract address of the grove-bbqUSDC token for the Morpho Grove x Steakhouse High Yield Vault USDC Instance. Questions: What is the token address for the Morpho Grove x Steakhouse High Yield Vault USDC Instance? Where is the grove-bbqUSDC contract address recorded?

- **`dis-32`** (icd-disambiguation) — query: "what token contract backs Avalanche - Aave v3 USDC Vault". Found with no briefings: no.
  - Target: Underlying Asset Address [Core] `494409b0-468f-4abb-b634-9f26d02f2bbe`
    - Sonnet: Gives the contract address of the underlying USDC asset for Spark's Avalanche Aave v3 USDC Vault Instance. It sits beside the token address in the instance's contract address list. Questions: What is the underlying asset address for the Avalanche Aave v3 USDC vault instance? Which USDC contract does Spark's Avalanche Aave allocation use?
    - Gemini: Provides the underlying asset contract address for USDC in the Avalanche Aave v3 USDC Vault instance. Questions: What is the underlying asset contract address for the Avalanche Aave v3 USDC Vault? What contract address is recorded for USDC in the Avalanche Aave v3 instance parameters?

- **`dis-37`** (icd-disambiguation) — query: "how are transfer limits identified for Ethereum Mainnet - Curve rlUSD/USDC for Swaps". Found with no briefings: no.
  - Target: Rate Limit IDs [Core] `d319be68-9f32-47be-a74c-cf9c79821027`
    - Sonnet: States that the RateLimitID values for the Curve rlUSD/USDC for Swaps conduit inflow and outflow are not set yet. They will be given in a future iteration of the Spark Artifact. Questions: What are the rate limit IDs for the Curve rlUSD/USDC for Swaps instance? Have the RateLimitIDs for the Curve rlUSD/USDC swaps conduit been specified?
    - Gemini: Specifies that RateLimitID values for the Curve rlUSD/USDC conduit's inflow and outflow will be designated in a future Spark Artifact iteration. Questions: What are the Rate Limit IDs for the Curve rlUSD/USDC for Swaps Instance? When will RateLimitIDs be assigned to the Curve rlUSD/USDC swap conduit?

- **`param-7`** (icd-param) — query: "what is the cap on how much can leave Ethereum Mainnet - SparkLend USDG". Found with no briefings: no.
  - Target: Outflow Rate Limits [Core] `6045e7e1-1341-4fb2-8868-927a3414c8b8`
    - Sonnet: Outflow rate limits of the SparkLend USDG Instance: both maxAmount and slope are Unlimited. So outflow from SparkLend is not rate limited for this instance. Questions: What are the outflow rate limits for the SparkLend USDG instance? Is USDG outflow from SparkLend rate limited?
    - Gemini: Defines the outflow rate limits for the SparkLend USDG instance as unlimited for both maxAmount and slope. Questions: What are the outflow rate limits for the SparkLend USDG instance? Is outflow rate-limited for the SparkLend USDG conduit?

- **`param-14`** (icd-param) — query: "how quickly does Ethereum Mainnet - Curve rlUSD/USDC for Swaps replenish its allowance". Found with no briefings: no.
  - Target: Swap Rate Limits [Core] `ff055884-4518-41ae-a320-dd7293147a37`
    - Sonnet: Swap rate limits for the Curve rlUSD/USDC for Swaps Instance. The maxAmount is 5,000,000, the slope is 25,000,000 per day and the maximum slippage is 0.1%. Questions: What are the swap rate limits for the Curve rlUSD/USDC for Swaps instance? What is the maximum slippage allowed on the Curve rlUSD/USDC swaps?
    - Gemini: Establishes swap rate limits for Curve rlUSD/USDC with maxAmount of 5,000,000, slope of 25,000,000 per day, and max slippage of 0.1%. Questions: What is the maximum slippage allowed for the Curve rlUSD/USDC for Swaps Instance? What are the swap rate limits and slope for the Curve rlUSD/USDC conduit?

- **`kv-5`** (kv-record) — query: "what does Spark Ethereum Mainnet specify". Found with no briefings: yes.
  - Target: Ethereum Mainnet [Core] `834b9f4a-a39f-4b1f-95d9-d841fabfa7a2`
    - Sonnet: Lists the ALM Contract addresses for the Spark Liquidity Layer on Ethereum Mainnet. Its eight children cover the MainnetController address and version, the Freezer and Relayer multisigs, the ALM Proxy, the Rate Limits contract, and the Freezable proxy address and version. Questions: What are the ALM Contract addresses for the Spark Liquidity Layer on Ethereum Mainnet? Where is the ALM Controller MainnetController address for Spark documented?
    - Gemini: Contains ALM contract addresses and versions for the Spark Liquidity Layer on Ethereum Mainnet. Questions: Where are the ALM contract addresses for the Spark Liquidity Layer on Ethereum Mainnet? Which document lists Ethereum Mainnet ALM contract parameters for Spark?
  - Target: ALM Controller (MainnetController) Contract Address [Core] `3546c2d3-7b7c-4446-aa16-ff357c1a7a0f`
    - Sonnet: Gives the deployed address of the ALM Controller (MainnetController) contract for the Spark Liquidity Layer on Ethereum Mainnet. It is the mainnet controller, as opposed to the ForeignController used on other chains. Questions: What is the address of the Spark Liquidity Layer MainnetController contract on Ethereum Mainnet? Where is the ALM_CONTROLLER MainnetController deployed?
    - Gemini: Records the Ethereum Mainnet deployment address of the ALM Controller contract (MainnetController) within the Spark Liquidity Layer architecture. Questions: What is the contract address of the MainnetController for Ethereum Mainnet? Where is the ALM Controller contract deployed on Ethereum Mainnet?
  - Target: ALM Controller (MainnetController) Contract Version [Core] `d7b0b6a0-0bac-4169-a006-4a375cba4baa`
    - Sonnet: States the version number of the ALM Controller (MainnetController) contract used by the Spark Liquidity Layer on Ethereum Mainnet. It records the version separately from the controller's address. Questions: Which version of the MainnetController is the Spark Liquidity Layer using on Ethereum Mainnet? What is the ALM_CONTROLLER MainnetController contract version?
    - Gemini: Specifies the version number of the ALM Controller (MainnetController) deployed on Ethereum Mainnet under the Spark Liquidity Layer. Questions: What version of the MainnetController is deployed on Ethereum Mainnet? What is the contract version of the ALM Controller on Ethereum Mainnet?
  - Target: ALM Freezer Multisig (Mainnet) Address [Core] `8d6c5c86-4b70-4115-b712-65106416aa77`
    - Sonnet: Says which Multisig holds the Freezer Role for the Spark Liquidity Layer on Ethereum Mainnet. The body only points to an address reference and gives no address text itself. Questions: Which multisig has the Freezer Role for the Spark Liquidity Layer on Ethereum Mainnet? Who can freeze the ALM proxy on Ethereum Mainnet?
    - Gemini: Cross-references the multisig assigned the Freezer role for ALM operations on Ethereum Mainnet within the Spark Liquidity Layer. Questions: Where is the ALM Freezer multisig address specified for Ethereum Mainnet? Which multisig holds the ALM Freezer role on Ethereum Mainnet?
  - Target: ALM Relayer Multisig (Mainnet) Address [Core] `f8958f39-6893-471a-bfd0-f72cb0aa0e4c`
    - Sonnet: Says which Multisigs hold the Relayer Role for the Spark Liquidity Layer on Ethereum Mainnet. It names more than one relayer address by reference, unlike the single relayer on the newer chains. Questions: Which multisigs have the Relayer Role for the Spark Liquidity Layer on Ethereum Mainnet? Who are the ALM relayers on Ethereum Mainnet?
    - Gemini: Cross-references the multisigs designated with the Relayer role for ALM operations on Ethereum Mainnet. Questions: Where can the ALM Relayer multisig addresses for Ethereum Mainnet be found? Which document specifies the addresses of multisigs holding the Relayer role on Ethereum Mainnet?
  - Target: ALM Proxy (Mainnet) Contract [Core] `a29a6751-4809-446c-a659-0dd93ca40379`
    - Sonnet: Gives the address of the ALM_PROXY contract for the Spark Liquidity Layer on Ethereum Mainnet. This is the proxy for the mainnet deployment of the layer. Questions: What is the ALM_PROXY contract address on Ethereum Mainnet for the Spark Liquidity Layer? Where is the Spark ALM Proxy deployed on Ethereum Mainnet?
    - Gemini: Provides the Ethereum Mainnet contract address for the ALM Proxy component of the Spark Liquidity Layer. Questions: What is the contract address for the ALM Proxy on Ethereum Mainnet? Where is the ALM_PROXY deployed on Ethereum Mainnet?
  - Target: ALM Rate Limits (Mainnet) Contract Address [Core] `3d7c06c5-18ab-4c30-82f1-4de153e2bc76`
    - Sonnet: Gives the address of the ALM_RATE_LIMITS contract used by the Spark Liquidity Layer on Ethereum Mainnet. This contract is listed among the mainnet ALM contracts. Questions: What is the ALM_RATE_LIMITS contract address on Ethereum Mainnet for the Spark Liquidity Layer? Where is the Spark rate limits contract on Ethereum Mainnet?
    - Gemini: Defines the Ethereum Mainnet deployment address for the ALM Rate Limits contract under the Spark Liquidity Layer. Questions: What is the address of the ALM Rate Limits contract on Ethereum Mainnet? Where is the ALM_RATE_LIMITS contract located on Ethereum Mainnet?
  - Target: ALM Proxy Freezable (Mainnet) Contract Address [Core] `a937f2e1-5f17-4c60-b007-fef5a7f00f5b`
    - Sonnet: Gives the address of the ALM_PROXY_FREEZABLE contract for the Spark Liquidity Layer on Ethereum Mainnet. This freezable proxy is listed only for mainnet and Base among the chains in this set. Questions: What is the ALM_PROXY_FREEZABLE contract address on Ethereum Mainnet? Where is the freezable ALM proxy deployed on Ethereum Mainnet?
    - Gemini: Gives the deployed contract address for the freezable ALM Proxy on Ethereum Mainnet. Questions: What is the contract address of the ALM Proxy Freezable on Ethereum Mainnet? Where is the ALM_PROXY_FREEZABLE deployed on Ethereum Mainnet?
  - Target: ALM Proxy Freezable (Mainnet) Contract Version [Core] `5879057d-df2d-4f23-8927-9c6e5160edd2`
    - Sonnet: States the version of the ALM_PROXY_FREEZABLE contract for the Spark Liquidity Layer on Ethereum Mainnet. Questions: Which version is the ALM_PROXY_FREEZABLE contract on Ethereum Mainnet? What version of the freezable ALM proxy does Spark use on Ethereum Mainnet?
    - Gemini: Records the version number of the ALM Proxy Freezable contract deployed on Ethereum Mainnet. Questions: What version is the ALM Proxy Freezable contract on Ethereum Mainnet? What is the contract version of ALM_PROXY_FREEZABLE on Ethereum Mainnet?

- **`kv-17`** (kv-record) — query: "is Keel Primitive Hub Document live yet". Found with no briefings: no.
  - Target: Global Activation Status [Core] `c6ee2c59-96cd-464c-9c38-7b177739ab25`
    - Sonnet: Records the Global Activation Status of the Agent Creation Primitive for Keel as Completed. It sits in Keel's Primitive Hub Document for that primitive. Questions: What is Keel's global activation status for the Agent Creation Primitive? Is the Agent Creation Primitive completed for Keel?
    - Gemini: States the Completed global activation status for the Agent Creation Primitive under Keel. Questions: What is the global activation status of the Keel Agent Creation Primitive? Is Keel's Agent Creation Primitive currently active or completed?

- **`kv-22`** (kv-record) — query: "which chain does Grove Instance Identifiers run on". Found with no briefings: no.
  - Target: Network [Core] `2c0d8ede-45bc-4e75-8931-5ddfccf24a02`
    - Sonnet: Network identifier of the Centrifuge JTRSY Instance of Grove's Allocation System Primitive. The value is Ethereum Mainnet. Questions: Which network does Grove's Centrifuge JTRSY Instance run on? Is the Centrifuge JTRSY Instance on Ethereum Mainnet?
    - Gemini: Specifies Ethereum Mainnet as the operating blockchain network for the Centrifuge JTRSY allocation instance. Questions: On which network does the Centrifuge JTRSY Allocation System Primitive instance operate? What is the network identifier for the Centrifuge JTRSY conduit?

- **`kv-23`** (kv-record) — query: "which chain does Keel Instance Identifiers run on". Found with no briefings: no.
  - Target: Network [Core] `32e1e642-91bd-4f67-b271-771f32da87d9`
    - Sonnet: Instance identifier naming the blockchain network on which the Kamino USDS Instance of the Allocation System Primitive runs, under Keel. The value is Solana. Questions: Which network does the Kamino USDS instance run on? Is the Keel Kamino USDS allocation instance on Solana?
    - Gemini: Specifies Solana as the blockchain network for the Kamino USDS Instance under Keel's Allocation System Primitive. Questions: Which blockchain network does the Kamino USDS Instance operate on? What is the network identifier for the Solana Kamino USDS Instance?

### Sonnet found it, Gemini did not — keywords (3)

By slice: icd-disambiguation 1, icd-param 1, kv-record 1.

- **`dis-28`** (icd-disambiguation) — query: "contract asset ethereum mainnet - morpho grove x steakhouse high yield vault usdc issues". Found with no briefings: no.
  - Target: Token Address [Core] `dcdff78c-809f-4ec8-80a2-36c124ca9ae8`
    - Sonnet: Records the vault token contract address of the Morpho Grove x Steakhouse High Yield Vault USDC Instance on Ethereum Mainnet. Questions: What is the token address of the Morpho Grove x Steakhouse High Yield Vault USDC Instance? Where is the vault token contract of the Grove x Steakhouse High Yield Vault USDC Instance?
    - Gemini: Defines the smart contract address of the grove-bbqUSDC token for the Morpho Grove x Steakhouse High Yield Vault USDC Instance. Questions: What is the token address for the Morpho Grove x Steakhouse High Yield Vault USDC Instance? Where is the grove-bbqUSDC contract address recorded?

- **`param-14`** (icd-param) — query: "ethereum mainnet - curve rlusd/usdc swaps replenish allowance". Found with no briefings: no.
  - Target: Swap Rate Limits [Core] `ff055884-4518-41ae-a320-dd7293147a37`
    - Sonnet: Swap rate limits for the Curve rlUSD/USDC for Swaps Instance. The maxAmount is 5,000,000, the slope is 25,000,000 per day and the maximum slippage is 0.1%. Questions: What are the swap rate limits for the Curve rlUSD/USDC for Swaps instance? What is the maximum slippage allowed on the Curve rlUSD/USDC swaps?
    - Gemini: Establishes swap rate limits for Curve rlUSD/USDC with maxAmount of 5,000,000, slope of 25,000,000 per day, and max slippage of 0.1%. Questions: What is the maximum slippage allowed for the Curve rlUSD/USDC for Swaps Instance? What are the swap rate limits and slope for the Curve rlUSD/USDC conduit?

- **`kv-17`** (kv-record) — query: "keel primitive hub document live yet". Found with no briefings: no.
  - Target: Global Activation Status [Core] `c6ee2c59-96cd-464c-9c38-7b177739ab25`
    - Sonnet: Records the Global Activation Status of the Agent Creation Primitive for Keel as Completed. It sits in Keel's Primitive Hub Document for that primitive. Questions: What is Keel's global activation status for the Agent Creation Primitive? Is the Agent Creation Primitive completed for Keel?
    - Gemini: States the Completed global activation status for the Agent Creation Primitive under Keel. Questions: What is the global activation status of the Keel Agent Creation Primitive? Is Keel's Agent Creation Primitive currently active or completed?

### Gemini found it, Sonnet did not — questions (8)

By slice: icd-disambiguation 5, icd-param 2, hub 1.

- **`dis-6`** (icd-disambiguation) — query: "what asset does Ethereum Mainnet - SparkLend USDS use". Found with no briefings: no.
  - Target: Token [Core] `65988a53-f492-49b6-b693-6e98f82b2c29`
    - Sonnet: Names the token of the SparkLend USDS Instance as spUSDS. Questions: What is the token of the SparkLend USDS Instance? Which token represents the SparkLend USDS position, spUSDS?
    - Gemini: Identifies the receipt/protocol token symbol as spUSDS for the SparkLend USDS instance on Ethereum Mainnet. Questions: What is the token symbol for the SparkLend USDS instance on Ethereum Mainnet? Which token represents deposits in the Ethereum Mainnet SparkLend USDS instance?

- **`dis-8`** (icd-disambiguation) — query: "what asset does Ethereum Mainnet - Morpho USDT use". Found with no briefings: no.
  - Target: Token [Core] `46ea2f39-26c6-4ac4-9ee7-baf921d8e86e`
    - Sonnet: Names the token of the Ethereum Mainnet Morpho USDT Instance. The value is sparkUSDT. Questions: What is the token of the Morpho USDT instance? Which token represents the Spark position in the Morpho USDT instance?
    - Gemini: Designates sparkUSDT as the receipt token for the Ethereum Mainnet Morpho USDT instance. Questions: What token represents positions in the Ethereum Mainnet Morpho USDT instance? What is the token symbol for the Morpho USDT vault on Ethereum Mainnet?

- **`dis-30`** (icd-disambiguation) — query: "what token contract backs Ethereum Mainnet - SparkLend USDS". Found with no briefings: no.
  - Target: Underlying Asset Address [Core] `aeb1bcc7-1214-4544-b686-687d1bb2fa70`
    - Sonnet: Gives the underlying asset contract address for the SparkLend USDS Instance, which is the asset the instance supplies. Questions: What is the underlying asset address of the SparkLend USDS Instance? Which contract is the underlying USDS asset for SparkLend USDS?
    - Gemini: Provides the underlying asset (USDS) contract address for the SparkLend USDS instance on Ethereum Mainnet. Questions: What is the underlying asset contract address for SparkLend USDS on Ethereum Mainnet? Where is the USDS token contract deployed for the SparkLend Ethereum Mainnet instance?

- **`dis-34`** (icd-disambiguation) — query: "what token contract backs Ethereum Mainnet - Grove x Steakhouse USDC Morpho Vault v2". Found with no briefings: no.
  - Target: Underlying Asset Address [Core] `76adcd24-8473-4e8e-a42c-0c7583e13936`
    - Sonnet: Gives the address of the underlying asset, USDC, for the Grove x Steakhouse USDC Morpho Vault v2 instance. Questions: What is the underlying asset address for the Grove x Steakhouse USDC Morpho Vault v2 instance? Which USDC contract address does the Grove x Steakhouse USDC Morpho Vault v2 instance use?
    - Gemini: Provides the Ethereum Mainnet contract address of the underlying asset (USDC) for the Grove x Steakhouse USDC Morpho Vault v2 instance. Questions: What is the underlying asset contract address for the Grove x Steakhouse USDC Morpho Vault v2? What is the USDC token contract address used in the Grove x Steakhouse USDC Morpho Vault v2 instance?

- **`dis-38`** (icd-disambiguation) — query: "how are transfer limits identified for Ethereum Mainnet - Uniswap v4 rlUSD/USDS Pool". Found with no briefings: no.
  - Target: Rate Limit IDs [Core] `a469565c-8521-4e00-822c-9539530fa320`
    - Sonnet: States that the RateLimitID values for the Uniswap v4 rlUSD/USDS Pool Instance conduit's inflow and outflow are not yet set and will come in a future iteration of the Spark Artifact. Questions: Has the RateLimitID for the Spark Uniswap v4 rlUSD/USDS pool conduit been specified yet? Which Spark rate limit IDs are still to be defined for the Uniswap v4 rlUSD/USDS instance?
    - Gemini: States that specific RateLimitIDs for the Uniswap v4 rlUSD/USDS conduit will be specified in a future iteration of the Spark Artifact. Questions: What are the RateLimitIDs for the Uniswap v4 rlUSD/USDS pool instance on Ethereum Mainnet? When will the RateLimitIDs for the Uniswap v4 rlUSD/USDS conduit inflow and outflow be defined?

- **`param-10`** (icd-param) — query: "how are transfer limits identified for Ethereum Mainnet - SparkLend ETH". Found with no briefings: no.
  - Target: Outflow Rate Limit ID [Core] `27e77ee3-b59b-4c8b-a729-741627952fb3`
    - Sonnet: Gives the outflow RateLimitID of the SparkLend ETH Instance conduit, a 32-byte hex identifier. It is the key for the outflow rate limit of this instance. Questions: What is the outflow RateLimitID for the SparkLend ETH instance? Which rate limit ID governs outflow from the Spark ETH conduit?
    - Gemini: Specifies the exact byte identifier for outflow rate limiting in the SparkLend ETH conduit on Ethereum Mainnet. Questions: What is the outflow RateLimitID for the SparkLend ETH Instance? What byte identifier governs outflow rate limits for SparkLend ETH?

- **`param-11`** (icd-param) — query: "what token contract backs Ethereum Mainnet - Curve sUSDS/USDT Pool". Found with no briefings: no.
  - Target: Underlying Asset Address [Core] `2957563b-3948-40b3-a247-15c6ddd41b03`
    - Sonnet: The second underlying asset address of the Curve sUSDS/USDT Pool Instance, given as 0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD. It is the other of the pool's two underlying asset addresses. Questions: What is the second underlying asset address of the Curve sUSDS/USDT pool instance? Which address is the other underlying asset of the Spark Curve sUSDS/USDT instance besides USDT?
    - Gemini: Specifies the contract address for the second underlying asset (sUSDS) in the Curve sUSDS/USDT Pool instance. Questions: What is the contract address for the underlying sUSDS token in the Curve sUSDS/USDT pool? Where is the non-USDT underlying asset contract deployed for the Curve sUSDS/USDT pool?

- **`hub-13`** (hub) — query: "what does the Spark Allocation System Primitive hub keep track of". Found with no briefings: no.
  - Target: Primitive Hub Document [Core] `845ef31b-7b6e-4407-87ad-a5a4c8bce049`
    - Sonnet: Hub document for Spark's usage of the Spark Liquidity Layer, which implements the Allocation System Primitive. It organizes the activation status, instance directories and data repository. Questions: Where is Spark's base information for the Spark Liquidity Layer organized? What documents make up the hub for Spark's Allocation System Primitive?
    - Gemini: Primitive hub organizing base directories and activation status for the Spark Liquidity Layer, Spark's Allocation System Primitive implementation. Questions: Where is the primitive hub for the Spark Liquidity Layer? Which hub document organizes Spark's Allocation System Primitive?
  - Target: Global Activation Status [Core] `f7a32d78-dabc-406e-a822-0a337a03b3e2`
    - Sonnet: Gives the Global Activation Status of Spark's Allocation System Primitive, which is Active. It sits in the Primitive Hub Document for the Spark Liquidity Layer. Questions: Is Spark's Allocation System Primitive globally Active? What is the Global Activation Status of the Spark Liquidity Layer?
    - Gemini: Defines the Global Activation Status of the Spark Liquidity Layer Allocation System Primitive as Active. Questions: What is the global activation status of the Spark Liquidity Layer? Is the Allocation System Primitive active for Spark?
  - Target: Active Instances Directory [Core] `20e0bc23-8a73-4ea3-b626-56f6286aded9`
    - Sonnet: Directory of Spark's Allocation System Primitive Instances with Active status. Its children list the Ethereum Mainnet, Base, Arbitrum, Avalanche, Robinhood Chain and X Layer Instances. Questions: Which chains are listed in the directory of Active Spark Allocation System Instances? Where is the directory of Active Spark Liquidity Layer Instances?
    - Gemini: Directory listing all active instances of Spark's Allocation System Primitive across various chains including Ethereum Mainnet, Base, and Arbitrum. Questions: Where is the Active Instances Directory for the Spark Liquidity Layer? Which directory lists active Allocation System Primitive instances for Spark?
  - Target: Completed Instances Directory [Core] `1df4d054-4443-4c64-b34b-c9fce456276b`
    - Sonnet: Directory of Spark's Allocation System Primitive Instances with Completed status. Its children list the Blackrock, Centrifuge and Ethereum Mainnet Instances. Questions: Which Spark Allocation System Instances are listed as Completed? Where is the directory of Completed Spark Liquidity Layer Instances?
    - Gemini: Directory listing completed instances of Spark's Allocation System Primitive, including Blackrock, Centrifuge, and Ethereum Mainnet. Questions: Where is the directory of completed instances for Spark's Allocation System Primitive? Which directory catalogs completed Spark Liquidity Layer instances?
  - Target: In Progress Invocations Directory [Core] `73a22cb8-06cd-4324-b0fe-f37bf538f7a9`
    - Sonnet: Directory of prospective Instances of Spark's Allocation System Primitive whose Invocation is in progress. Successful ones move to the Active Instances Directory; failed ones are archived in the Hub Data Repository. Questions: What happens to failed Allocation System Primitive Invocations for Spark? Where are in-progress Allocation System Invocations listed for Spark?
    - Gemini: Directory listing prospective Allocation System Primitive instances whose invocations are currently in progress for Spark. Questions: Where is the In Progress Invocations Directory for the Spark Liquidity Layer? How are pending invocations tracked in the Spark Allocation System primitive hub?
  - Target: Hub Data Repository [Core] `143d1560-f068-4f83-9b50-c5e80fc9ec21`
    - Sonnet: Data Repository for the Primitive Hub Document of Spark's Allocation System Primitive. Failed Invocations are archived here, through its child for archived Invocations and Instances. Questions: Where are failed Allocation System Primitive Invocations archived for Spark? What is the Hub Data Repository for Spark's Allocation System Primitive?
    - Gemini: Houses the hub data repository for Spark's Allocation System Primitive, storing archived invocations and instances. Questions: Where is the Hub Data Repository for the Spark Liquidity Layer? Where are archived Allocation System Primitive invocations kept for Spark?

### Gemini found it, Sonnet did not — keywords (11)

By slice: icd-disambiguation 8, icd-param 2, control 1.

- **`dis-6`** (icd-disambiguation) — query: "asset ethereum mainnet - sparklend usds use". Found with no briefings: no.
  - Target: Token [Core] `65988a53-f492-49b6-b693-6e98f82b2c29`
    - Sonnet: Names the token of the SparkLend USDS Instance as spUSDS. Questions: What is the token of the SparkLend USDS Instance? Which token represents the SparkLend USDS position, spUSDS?
    - Gemini: Identifies the receipt/protocol token symbol as spUSDS for the SparkLend USDS instance on Ethereum Mainnet. Questions: What is the token symbol for the SparkLend USDS instance on Ethereum Mainnet? Which token represents deposits in the Ethereum Mainnet SparkLend USDS instance?

- **`dis-24`** (icd-disambiguation) — query: "contract asset ethereum mainnet - sparklend usds issues". Found with no briefings: no.
  - Target: Token Address [Core] `a8171359-d11e-4014-bd9b-ef19712e556d`
    - Sonnet: Gives the token contract address for the SparkLend USDS Instance on Ethereum Mainnet, as listed in its contract addresses. Questions: What is the token contract address of the SparkLend USDS Instance? What is the spUSDS token address on Ethereum Mainnet?
    - Gemini: States the contract address of the spUSDS token for the SparkLend USDS instance on Ethereum Mainnet. Questions: What is the spUSDS token address on Ethereum Mainnet? Where is the token contract located for the Ethereum Mainnet SparkLend USDS instance?

- **`dis-29`** (icd-disambiguation) — query: "contract asset base - grove x steakhouse usdc morpho vault v2 issues". Found with no briefings: no.
  - Target: Token Address [Core] `9a233643-f07d-49d6-ab84-3d9fc7281c1c`
    - Sonnet: Gives the address of the vault token contract for the Grove x Steakhouse USDC Morpho Vault V2 Instance on Base. It is distinct from the underlying USDC asset address listed beside it. Questions: What is the token contract address of the Grove x Steakhouse USDC Morpho Vault V2 Instance? What is the grove-steakUSDC vault address on Base?
    - Gemini: Specifies the on-chain vault token address for the Grove x Steakhouse USDC Morpho Vault V2 instance on Base. Questions: What is the token contract address for the Grove x Steakhouse USDC Morpho Vault V2 on Base? Where is the grove-steakUSDC vault deployed on Base?

- **`dis-30`** (icd-disambiguation) — query: "token contract backs ethereum mainnet - sparklend usds". Found with no briefings: no.
  - Target: Underlying Asset Address [Core] `aeb1bcc7-1214-4544-b686-687d1bb2fa70`
    - Sonnet: Gives the underlying asset contract address for the SparkLend USDS Instance, which is the asset the instance supplies. Questions: What is the underlying asset address of the SparkLend USDS Instance? Which contract is the underlying USDS asset for SparkLend USDS?
    - Gemini: Provides the underlying asset (USDS) contract address for the SparkLend USDS instance on Ethereum Mainnet. Questions: What is the underlying asset contract address for SparkLend USDS on Ethereum Mainnet? Where is the USDS token contract deployed for the SparkLend Ethereum Mainnet instance?

- **`dis-33`** (icd-disambiguation) — query: "token contract backs ethereum mainnet - centrifuge jtrsy". Found with no briefings: no.
  - Target: Underlying Asset Address [Core] `fbe40152-f7e6-4a4e-87ed-4e419687e40d`
    - Sonnet: Underlying asset contract address of the Centrifuge JTRSY Instance of Grove's Allocation System Primitive, given as a 0x address beginning A0b869. Questions: What is the underlying asset address of Grove's Centrifuge JTRSY Instance? Which contract address is the underlying asset for the JTRSY Instance?
    - Gemini: Specifies the contract address for the underlying asset (USDC) associated with the Centrifuge JTRSY instance. Questions: What is the underlying asset contract address for Centrifuge JTRSY? What is the contract address of the underlying asset allocated to Centrifuge JTRSY?

- **`dis-34`** (icd-disambiguation) — query: "token contract backs ethereum mainnet - grove x steakhouse usdc morpho vault v2". Found with no briefings: no.
  - Target: Underlying Asset Address [Core] `76adcd24-8473-4e8e-a42c-0c7583e13936`
    - Sonnet: Gives the address of the underlying asset, USDC, for the Grove x Steakhouse USDC Morpho Vault v2 instance. Questions: What is the underlying asset address for the Grove x Steakhouse USDC Morpho Vault v2 instance? Which USDC contract address does the Grove x Steakhouse USDC Morpho Vault v2 instance use?
    - Gemini: Provides the Ethereum Mainnet contract address of the underlying asset (USDC) for the Grove x Steakhouse USDC Morpho Vault v2 instance. Questions: What is the underlying asset contract address for the Grove x Steakhouse USDC Morpho Vault v2? What is the USDC token contract address used in the Grove x Steakhouse USDC Morpho Vault v2 instance?

- **`dis-35`** (icd-disambiguation) — query: "token contract backs base - grove x steakhouse usdc morpho vault v2". Found with no briefings: no.
  - Target: Underlying Asset Address [Core] `a911bdd4-e5e8-47c7-81e6-f4b7600dc1c4`
    - Sonnet: Gives the address of the underlying asset contract for the Grove x Steakhouse USDC Morpho Vault V2 Instance on Base, meaning the USDC that the vault holds. Questions: What is the underlying asset address for the Grove x Steakhouse USDC Morpho Vault V2 Instance? Which USDC contract on Base does the Grove Steakhouse Morpho vault use?
    - Gemini: Records the contract address of the underlying USDC asset for the Grove x Steakhouse USDC Morpho Vault V2 instance on Base. Questions: What is the underlying asset contract address for the Base Grove x Steakhouse USDC Morpho Vault V2? What contract address is recorded for USDC in the Grove x Steakhouse Morpho Vault V2 on Base?

- **`dis-38`** (icd-disambiguation) — query: "transfer limits identified ethereum mainnet - uniswap v4 rlusd/usds pool". Found with no briefings: no.
  - Target: Rate Limit IDs [Core] `a469565c-8521-4e00-822c-9539530fa320`
    - Sonnet: States that the RateLimitID values for the Uniswap v4 rlUSD/USDS Pool Instance conduit's inflow and outflow are not yet set and will come in a future iteration of the Spark Artifact. Questions: Has the RateLimitID for the Spark Uniswap v4 rlUSD/USDS pool conduit been specified yet? Which Spark rate limit IDs are still to be defined for the Uniswap v4 rlUSD/USDS instance?
    - Gemini: States that specific RateLimitIDs for the Uniswap v4 rlUSD/USDS conduit will be specified in a future iteration of the Spark Artifact. Questions: What are the RateLimitIDs for the Uniswap v4 rlUSD/USDS pool instance on Ethereum Mainnet? When will the RateLimitIDs for the Uniswap v4 rlUSD/USDS conduit inflow and outflow be defined?

- **`param-0`** (icd-param) — query: "chain ethereum mainnet - spark blue chip usdt vault". Found with no briefings: no.
  - Target: Network [Core] `80f7fecc-cfbf-4f86-878e-23298f9d8f44`
    - Sonnet: Instance identifier naming the network of the Spark Blue Chip USDT Vault Instance. Its value is Ethereum Mainnet. Questions: Which network does the Spark Blue Chip USDT Vault instance run on? What is the Network identifier of the Spark Blue Chip USDT Vault Instance Configuration Document?
    - Gemini: Establishes Ethereum Mainnet as the operating blockchain network for the Spark Blue Chip USDT Vault Instance. Questions: Which network hosts the Spark Blue Chip USDT Vault Instance? What is the network identifier for the Morpho Spark Blue Chip USDT Vault?

- **`param-8`** (icd-param) — query: "ethereum mainnet - spark blue chip usdt vault recover outgoing allowance". Found with no briefings: no.
  - Target: Outflow Rate Limits [Core] `779c6c99-f620-4bd0-b261-7d36b6d503b7`
    - Sonnet: Sets the outflow rate limit for the Spark Blue Chip USDT Vault conduit: both maxAmount and slope are unlimited. It is the outflow half of the instance's Rate Limits, opposite to the capped inflow. Questions: What is the outflow rate limit for the Spark Blue Chip USDT Vault? Is outflow from the Morpho Spark Blue Chip USDT Vault capped or unlimited?
    - Gemini: Specifies the outflow rate limits (maxAmount and slope) for the Spark Blue Chip USDT Vault Morpho instance on Ethereum Mainnet. Questions: What are the outflow rate limits for the Spark Blue Chip USDT Vault? Is there an outflow maxAmount limit on the Ethereum Mainnet Spark Blue Chip USDT Vault conduit?

- **`ctrl-33`** (control) — query: "core council’s broad discretionary capacity". Found with no briefings: no.
  - Target: Core Council’s Broad Discretionary Capacity [Core] `f18229fe-fbc3-4dc8-ad84-4bca2915f6c4`
    - Sonnet: General Provision granting the Core Council broad discretionary power during the Atlas's early stage. The Core Facilitator may infer the Spirit of the Atlas where guidance is missing, and the Council may supersede unsuitable provisions by a Sky Forum post confirmed by Core GovOps and the Core Council Risk Advisor. The power is temporary. Questions: What discretionary power does the Core Council have over Atlas provisions? How can the Core Council supersede an Atlas provision it finds unsuitable? Is the Core Council's discretionary power permanent?
    - Gemini: Grants the Core Council temporary broad discretionary capacity to supersede Atlas provisions and infer Atlas intent via the Core Facilitator. Questions: Under what conditions may the Core Council supersede provisions of the Atlas? What discretionary power does the Core Facilitator hold when the Atlas lacks clear guidance? How is an Atlas provision officially superseded by the Core Council on the Sky Forum?
