# Sky Atlas — suspected defects

Sweep of all 11,529 documents (18 files, 3.7 MB) at atlas commit `d64eca48`, 2026-09-15.
Two LLM passes over every document (language: Sonnet; factual: Opus) plus three deterministic scans.

**355 findings** — 182 high confidence, 172 medium, 1 low.

| Category | Findings |
|---|---|
| Numeric / formula | 20 |
| Wrong entity or address | 25 |
| Governance logic | 5 |
| Contradiction | 74 |
| Structural | 43 |
| Broken cross-reference | 30 |
| Stale / dated | 10 |
| Unfilled placeholder | 12 |
| Copy-paste residue | 8 |
| Wrong word | 8 |
| Typo / spelling | 22 |
| Grammar | 53 |
| Broken markdown | 32 |
| Naming inconsistency | 12 |
| Duplication | 1 |

---

## Numeric / formula (20)

### `A.3.2.2.1.1.1.1.1.2` — High
A.3 · `c9bd4928-d054-4e89-9a98-720c439b0db3`

> LGD = min(1 - \frac{(1 - LP) * (1 - S)}{LT}, 0) ... Here $min$ is the mathematical minimum function that returns the lower of the two specified parameters.

**Issue.** min(x, 0) can never exceed 0, so as written Loss Given Default is always <= 0 (e.g. LP=10%, S=1%, LT=80% gives -0.11375; LP=10%, S=25%, LT=70% gives 0), which makes every downstream capital requirement zero or negative; the chunk's own reference implementation does lgd = max(0.0, min(1 - recovery, 1.0)).

**Suggested.** LGD = max(0, min(1 - (1-LP)*(1-S)/LT, 1)) — i.e. floor at 0 (and cap at 1), not min against 0.

### `A.3.2.2.1.2.4.2.2.2` — High
A.3 · `c06bbc44-09c0-43f9-b443-39c2802a4a78`

> The Effective Age is calculated as specified in [A.3.2.2.1.2.2.4.3 - Effective Age](a8db99b2-f072-4132-9ee2-c8ebcc2b3609) except that the Effective Age cannot exceed one (1) year.

**Issue.** Unit mismatch: the referenced Effective Age is measured in months (A.3.2.2.1.2.2.4.3.1 'The contract age $CA$ is the average age, in months'; A.3.2.2.1.2.2.4.2 states Maximum Age in months), but the Legal Recourse Asset formula Exposure = Equivalent Loss * Effective Age + Raw Exposure * (1 - Effective Age) uses it as a 0-1 weight and caps it in years — with a cap of one year = 12 months the weight (1 - Effective Age) becomes -11 and the exposure goes negative.

**Suggested.** State the cap in the same unit and normalise, e.g. 'Effective Age expressed in years, capped at 1' (equivalently min(AGEeff_months, 12)/12).

### `A.6.1.1.1.2.6.1.2.1.2.2.1.2` — High
A.6.1.1.1 · `8deac2a8-c728-4d0c-9f05-6fcf3965bdc9`

> The Prime Relayer Multisig currently has a 1/2 signing requirement.

**Issue.** The stated 1-of-2 threshold violates the multisig's own Modification rule (A.6.1.1.1.2.6.1.2.1.2.2.1.5, 19d05632-97ef-4717-a47d-c0de16631fac), which requires 'at least two (2) signers and at least a majority of signers are required to execute transactions' — a majority of 2 signers is 2, not 1.

**Suggested.** Either state a 2/2 requirement, or correct the Modification rule if a 1-of-N relayer multisig is intended.

### `A.6.1.1.1.2.6.1.2.1.2.2.2.2` — High
A.6.1.1.1 · `d397fcef-85da-4c07-b675-14ec66d4cff9`

> The Core Operator Relayer Multisig currently has a 2/5 signing requirement.

**Issue.** 2-of-5 (40%) contradicts the multisig's own Modification rule (A.6.1.1.1.2.6.1.2.1.2.2.2.5, 31c59017-769f-4a5b-88f7-8bef200dcc71) requiring 'at least two-thirds of signers are required to execute transactions' — two-thirds of the 5 listed signers is 4.

**Suggested.** Either raise the threshold to 4/5, or correct the Modification rule to match the intended 2/5 operating configuration.

### `A.6.1.1.1.2.6.1.3.2.1.1.2.4.1` — High
A.6.1.1.1 · `97aa974e-5b7d-43fb-be88-947454d69a53`

> The inflow rate limits are: - `maxAmount`: 100,000,00 USDC - `slope`: 50,000,00 USDC per day

**Issue.** Both figures are malformed eight-digit numbers grouped 3+3+2 (`100,000,00`, `50,000,00`), so neither is a readable thousands-separated value and the intended magnitude is ambiguous by a factor of ten.

**Suggested.** Almost certainly `maxAmount`: 10,000,000 USDC and `slope`: 5,000,000 USDC per day (or 100,000,000 / 50,000,000) — needs author to confirm the decade.

### `A.6.1.1.2.2.6.1.2.1.2.2.2.2` — High
A.6.1.1.2 · `8f0b88bf-0fcd-4103-a4c2-e03b61a2e8a7`

> The Prime Secondary Relayer Multisig currently has a 1/2 signing requirement.

**Issue.** The stated 1-of-2 threshold is not a majority of its 2 signers, contradicting A.6.1.1.2.2.6.1.2.1.2.2.2.5 (eecf9254-7939-492a-a4c8-938bbb19c7a0), which requires that 'at least a majority of signers are required to execute transactions'; the sibling Primary (4/7) and Core Operator (2/3) multisigs both satisfy their own clauses.

**Suggested.** Either state a 2/2 requirement, or amend the Modification clause so the majority constraint does not apply to this multisig — unclear, needs author

### `A.6.1.1.2.2.6.1.3.7.1.1.2.5.1` — High
A.6.1.1.2 · `689ed5dc-1843-4a75-bc7a-a4147caa062e`

> Total USDG exposure may not exceed 100 million USDS.

**Issue.** Unit mismatch: an exposure cap on USDG is stated in USDS, while every other figure for this Instance (deposit rate limits, transferAssets limits, max exchange rate) is denominated in USDG.

**Suggested.** Should probably read 'may not exceed 100 million USDG' (or state the USD-equivalent basis explicitly).

### `A.6.1.1.3.2.6.1.2.1.2.2.1.2` — High
A.6.1.1.3 · `90059aef-0d59-4174-9076-e894ce9cf730`

> The Prime Relayer Multisig currently has a 1/2 signing requirement.

**Issue.** The stated 1-of-2 threshold violates the Modification rule for the same multisig in A.6.1.1.3.2.6.1.2.1.2.2.1.5 (8e1357dc-80a7-4716-becf-9a50ef7ae3a0), which requires 'at least two (2) signers and at least a majority of signers are required to execute transactions' — a majority of 2 signers is 2, not 1.

**Suggested.** Either state a 2/2 signing requirement, or amend the Modification clause to permit a non-majority threshold — unclear which, needs author.

### `A.1.5.4.0.4.1` — Medium
A.1 · `8dfd71fc-7ded-4217-8b6a-2bef00f75b55`

> evidence is deemed at least 51% more likely than not to be valid ... should the overall weight of the evidence demonstrate a 51% or greater chance that the AC committed a misaligned act

**Issue.** The same 51% threshold is stated two incompatible ways in adjacent sentences: '51% more likely than not' compounds a percentage onto an already >50% baseline (roughly 75.5%, or simply meaningless), whereas the next sentence states the intended form, '51% or greater chance'.

**Suggested.** State the first threshold as 'at least a 51% chance of being valid', matching the second sentence.

### `A.2.11.1.3.2.1.1.4` — Medium
A.2 · `022c6cf1-9fba-4c3d-8f15-aa2c616d27c6`

> | Capital Allocation | High | Time-Sensitive | 3/5 |

**Issue.** The recommended standard threshold for a Capital Allocation Multisig is 3/5 (five signers), but High Impact Classification is defined as $1M-$10M exposure and A.2.11.1.3.2.1.1.2.3.2 mandates that Multisigs with custodial control of assets worth $1,000,000 or more have no fewer than seven (7) signers - the other two rows classified High (Treasury - Large, Protocol Parameters) are both 4/7, so only this row breaches the rule.

**Suggested.** Change the Capital Allocation standard threshold to a 7-signer configuration (e.g. 4/7), or state explicitly that the 7-signer High-Value Asset requirement does not apply to Capital Allocation Multisigs.

### `A.2.8.2.2.2.1.2.1` — Medium
A.2 · `9d7a2d3f-3079-4d3b-be89-e06966aec07c`

> 3,000,000,000 GROVE tokens are allocated to the Grove Foundation, with an option to further increase this allocation by 5% (500,000,000 tokens).

**Issue.** 5% of 'this allocation' (3,000,000,000) is 150,000,000, not 500,000,000; 500,000,000 is 5% of the 10,000,000,000 total supply stated in A.2.8.2.2.2.1.1, so the percentage and the parenthetical figure use different bases.

**Suggested.** Say 'by 5% of the total token supply (500,000,000 tokens)' (or correct the figure to 150,000,000)

### `A.3.2.2.1.1.1.5.2.6` — Medium
A.3 · `70013695-3823-407a-9603-b38795ba9899`

> The final step is to multiply the adjusted Aggregate RWA ... by an 8% capital ratio to arrive at Instance Financial RRC.

**Issue.** The same framework's lending-market path states the capital ratio as 8.75% (A.3.2.2.1.1.1.1.1.5.1: 'The Capital Ratio $CR$ is the capital ratio without additional buffers. It is set to `8.75%`', and A.3.2.2.1.1.1.1.1.5.3 repeats 8.75% for ECR); the Real World Asset path uses 8% for the same role without saying why they differ.

**Suggested.** State one capital ratio for Instance Financial RRC, or say explicitly that the RWA/Basel path deliberately uses 8% while the lending-market model uses 8.75%.

### `A.3.5.2` — Medium
A.3 · `ddb90fee-2851-4bf0-b924-f1d73e30ce7a`

> - burn (the percentage of the kicker.kbump to be moved to the underlying flapper): 55% (WAD * 1)

**Issue.** The parenthetical fixed-point value contradicts the stated percentage: WAD * 1 is 1.0, i.e. 100%, not 55% (55% would be 0.55 * WAD); the 55% figure is the one consistent with the adjacent '55% of Splitter allocation is set to accumulate SKY'.

**Suggested.** Either drop the parenthetical or write it as the correct fixed-point value for 55% (e.g. 'WAD * 0.55' / 0.55e18).

### `A.4.4.1.3.8.5.1` — Medium
A.4 · `13c51e11-8ea3-4d4e-b631-2e99c559a914`

> - `str` - 0 basis points

**Issue.** An initial `str` of 0 basis points is below the `str` BEAM `min` of 200 basis points declared in A.4.4.1.3.8.2.1 (516eccc7-dd7f-4782-84d5-55121bc1ae44), so the value set by the BEAM at deployment violates the BEAM's own stated minimum for that parameter.

**Suggested.** unclear — needs author: either the initial `str` must be at least 200 bps, or the document should note that the deployment Executive Vote sets `str` directly rather than through the BEAM bounds

### `A.6.1.1.1.3.2.1.1.3.2.2` — Medium
A.6.1.1.1 · `93b851d7-9825-4022-a583-51a4bbdf4f9c`

> - Borrow cap     - `gap`: 10,000 wstETH     - `ttl`: 12 hours     - `max`: 1 wstETH

**Issue.** The borrow-cap target gap (10,000 wstETH) is 10,000x the absolute maximum the borrow cap may be raised to (1 wstETH), so the automator's target can never be reached - while A.6.1.1.1.3.2.1.1.2.1.8 (5d721ab3) lists wstETH with Borrowing: Yes and Borrow Cap: Set by cap automator.

**Suggested.** unclear - needs author: `max` looks like a unit/decimal slip (compare WETH's `max`: Unlimited), or the wstETH borrow cap is deliberately disabled and should be stated as such.

### `A.6.1.1.2.2.6.1.2.1.1.3.1.2.3` — Medium
A.6.1.1.2 · `a3b52620-db3f-40fa-80d5-a7eacf52090c`

> - `maxAmount`: Unlimited - `slope`: Unlimited

**Issue.** `slope` is a per-day refill rate stated numerically in every other rate-limit document in this chunk; the one other 'Unlimited' limit (A.6.1.1.2.2.6.1.2.1.1.3.1.1.5, b43ee2cd-06b9-4615-bcb4-ac44e2b8c693) expresses the same condition as maxAmount 'Unlimited' with `slope`: 0, so 'slope: Unlimited' is an inconsistent/invalid value for the same concept.

**Suggested.** `slope`: 0 (matching the unlimited-limit convention used for LIMIT_USDC_TO_CCTP_ETH)

### `A.6.1.1.2.2.6.1.3.1.1.3.2.5.1` — Medium
A.6.1.1.2 · `96e8ca2f-4e71-4ab0-ba0f-1958ea8e637b`

> Total ACRDX exposure may not exceed 50.97 million USDS and should be reduced to zero over time.

**Issue.** Unit mismatch: the Centrifuge ACRDX Instance's Asset Supplied By Grove Liquidity Layer is USDC (A.6.1.1.2.2.6.1.3.1.1.3.2.1.3) and its deposit rate limits are denominated in USDC (20,000,000 USDC), but the exposure cap for the same Instance is denominated in USDS.

**Suggested.** State the cap in USDC to match the Instance's supplied asset and rate limits, or state the conversion basis if USDS is deliberate.

### `A.6.1.1.3.2.6.1.2.1.1.3.1.1.1` — Medium
A.6.1.1.3 · `568f6fae-4680-4090-8eee-fe0b8e920155`

> The maximum amount of USDS that can be minted within the Keel Liquidity Layer (`LIMIT_USDS_MINT`) is specified in the document herein. - `maxAmount`: 10,000 USDS - `slope`: 10,000 USDS per day

**Issue.** A 10,000 USDS mint cap is four orders of magnitude below every other USDS limit in the same Ethereum Mainnet rate-limit table and below the limits that consume minted USDS — LIMIT_USDS_TO_USDC (100,000,000 USDS) and LIMIT_LAYERZERO_TRANSFER to Solana (100,000,000 USDS) — which are therefore unreachable, indicating a dropped-magnitude figure.

**Suggested.** Probably 100,000,000 USDS maxAmount / 50,000,000 USDS per day to match the sibling limits — unclear, needs author.

### `A.6.1.1.3.2.6.1.2.1.1.3.1.2.1` — Medium
A.6.1.1.3 · `28831fcf-2e28-4760-a4cd-27ae538edd9a`

> The maximum amount of sUSDS that can be deposited (`LIMIT_4626_DEPOSIT`) is specified in the document herein. - `maxAmount`: 100,000,000 USDS - `slope`: 50,000,000 USDS per day

**Issue.** Unit mismatch within the same document: the limit is stated as an amount of sUSDS but the figures are denominated in USDS, which is a different token with a different (non-1:1, accruing) value, so the cap is ambiguous.

**Suggested.** State both the asset and the figures in the same unit — either 'amount of USDS that can be deposited into sUSDS' with USDS figures, or sUSDS figures.

### `A.6.1.1.3.2.6.1.2.1.1.3.2.1.2` — Medium
A.6.1.1.3 · `5f86844e-579b-425c-8f7b-e6521cfe55b9`

> The maximum amount of USDS that can be swapped for USDC by the Keel Liquidity Layer on Solana ... - `maxAmount`: 100,000,000 USDS - `slope`: 50,000,000 USDS per day

**Issue.** This is the only Solana rate limit at 100,000,000/50,000,000 — every other Solana limit in the same table is 25,000,000/10,000,000 — and it exceeds the USDS Reserve cap in A.6.1.1.3.2.6.1.2.1.1.3.2.1.1 (d9e9085a-cc04-41b9-8708-fe41fc2ef0f3), which limits USDS leaving the Reserve in aggregate to 25,000,000; the values duplicate the Ethereum Mainnet swap limit exactly, suggesting a copy-paste.

**Suggested.** Probably `maxAmount`: 25,000,000 USDS / `slope`: 10,000,000 USDS per day, consistent with the other Solana limits.


## Wrong entity or address (25)

### `A.6.1.1.1.2.6.1.2.1.1.1.2.8.3` — High
A.6.1.1.1 · `ed5c698b-cca9-43b8-965f-1dacd3ec46b3`

> The address of the Multisig that has the Freezer Role is: `0x8a25A24EDE9482C4Fc0738F99611BE58F1c839AB`.

**Issue.** 0x8a25A24EDE9482C4Fc0738F99611BE58F1c839AB is defined elsewhere in this chunk as the Prime Relayer Multisig (A.6.1.1.1.2.6.1.2.1.2.2.1.1, 67bf2799-8d57-44be-82e4-827912ff30df), i.e. a RELAYER_ROLE holder — the same address cannot also be the X Layer FREEZER_ROLE holder, whose role is to remove a compromised Relayer.

**Suggested.** Looks like the X Layer Freezer and Relayer addresses are swapped; the Freezer address should probably be 0x90D8c80C028B4C09C0d8dcAab9bbB057F0513431 (the Freezer Multisig).

### `A.6.1.1.1.2.6.1.2.1.1.1.2.8.4` — High
A.6.1.1.1 · `7248a5ae-a45e-46a1-9cee-a8cb0b391ff8`

> The address of the Multisig that has the Relayer Role is: `0x90D8c80C028B4C09C0d8dcAab9bbB057F0513431`.

**Issue.** 0x90D8c80C028B4C09C0d8dcAab9bbB057F0513431 is defined elsewhere in this chunk as the Freezer Multisig (A.6.1.1.1.2.6.1.2.1.2.2.3.1, 51777bdd-df5f-4a6e-93f5-8163d981f595); granting it the RELAYER_ROLE on X Layer makes the emergency Freezer its own Relayer, and pairs with the mirror-image error in A.6.1.1.1.2.6.1.2.1.1.1.2.8.3.

**Suggested.** Looks like the X Layer Freezer and Relayer addresses are swapped; the Relayer address should probably be 0x8a25A24EDE9482C4Fc0738F99611BE58F1c839AB (the Prime Relayer Multisig).

### `A.6.1.1.1.2.6.1.3.1.6.2.2` — High
A.6.1.1.1 · `14fe988d-d2a9-4c95-b0d3-63fe58ab40d5`

> The documents herein define the parameters of the Spark Savings v2 ETH Instance of the Allocation System Primitive.

**Issue.** This Parameters document sits under A.6.1.1.1.2.6.1.3.1.6.2 'Ethereum Mainnet - Spark Savings v2 USDC Instance Configuration Document' (and its own subdocuments give USDC, spUSDC and the USDC token address), but names the ETH Instance; it is the only Parameters doc in the chunk whose body does not match its parent instance.

**Suggested.** Should read 'the parameters of the Spark Savings v2 USDC Instance of the Allocation System Primitive.'

### `A.6.1.1.2.2.6.1.3.1.15.1.2.2.1` — High
A.6.1.1.2 · `60a0bddf-ade3-4be9-8142-06880cec308d`

> ###### A.6.1.1.2.2.6.1.3.1.15.1.2.2.1 - Token Address `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`

**Issue.** In the 'USDC To USDG Via Paxos' Instance the Token to Receive is USDG, but the Token Address given is 0xA0b86991...eB48 — the same USDC address the very next document gives as the Underlying Asset Address, while this chunk records USDG at 0xe343167631d89B6Ffc58B88d6b7fB0228795491D (A.6.1.1.2.2.6.1.3.1.7.8.2.2.2).

**Suggested.** Token Address should be the USDG token address 0xe343167631d89B6Ffc58B88d6b7fB0228795491D

### `A.6.1.1.2.2.6.1.3.1.4.1.3.1.1` — High
A.6.1.1.2 · `ba1c514f-026a-4ecd-bb9a-c736cca59728`

> - These addesses will be specified in a future iteration of the Spark Artifact.

**Issue.** This document sits inside the Grove Artifact and defers to 'the Spark Artifact', naming the wrong Agent artifact; every one of the 18 other deferral sentences in these chunks says 'the Grove Artifact'.

**Suggested.** Change 'Spark Artifact' to 'Grove Artifact'.

### `A.6.1.1.2.2.6.1.3.1.4.3.2.2.1` — High
A.6.1.1.2 · `9008b149-de3d-429d-824f-48524063d657`

> `0x4c9EDD5852cd905f086C759E8383e09bff1E68B3`

**Issue.** The Token Address of the Ethena PT-USDe Instance is the same address that the same chunk declares as the USDe Token Address (A.6.1.1.2.2.6.1.3.1.4.1.2.2.1) and as the USDe Underlying Asset Address of the sUSDe Instance (A.6.1.1.2.2.6.1.3.1.4.2.2.2.2), so one address is labelled as two different tokens (USDe and PT-USDe).

**Suggested.** Replace with the actual Pendle PT-USDe token address; 0x4c9EDD5852cd905f086C759E8383e09bff1E68B3 is the USDe token.

### `A.6.1.1.2.2.6.1.3.1.4.4.2.2.1` — High
A.6.1.1.2 · `3b108b97-6f88-4d96-a55a-38c39191281e`

> `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`

**Issue.** The Token Address of the Ethena PT-sUSDe Instance is given as 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48, which is byte-identical to that same Instance's own Underlying Asset Address (A.6.1.1.2.2.6.1.3.1.4.4.2.2.2) and to the USDC underlying address used by ten other Instances in this chunk, so the PT-sUSDe token is recorded as being the underlying USDC contract.

**Suggested.** Replace with the actual Pendle PT-sUSDe token address; it must differ from the USDC underlying address 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48.

### `A.6.1.1.3.2.6.1.2.2.1.1.2.1.2.6.2` — High
A.6.1.1.3 · `d239ba22-9a09-49f1-9fdc-a1d306ffe697`

> Bridge USDS / sUSDS Using SkyBridge (LayerZero OFT) Token Bridge ... This document defines the process for an operator to bridge USDS or sUSDS using the OP Token Bridge.

**Issue.** The title names SkyBridge / LayerZero OFT but the body names the OP Token Bridge — two different, incompatible bridging systems for the same document.

**Suggested.** Body should read 'using the SkyBridge (LayerZero OFT) Token Bridge' to match the title (or the title corrected if OP Token Bridge is meant).

### `A.6.1.1.3.2.6.1.2.2.2.3.4` — High
A.6.1.1.3 · `1bc17a00-a5b7-4390-bec5-46674053222b`

> A.6.1.1.3.2.6.1.2.2.2.3.4 - AtomicSwap Action ... ```solidity mainnetController.swapUSDCToUSDS(usdc.balanceOf(address(proxy))) ``` For more detailed instructions ... see [A.6.1.1.3.2.6.1.2.2.1.1.2.1.2.5.2 - Swap USDC To USDS]

**Issue.** This is a Solana emergency-protocol document (parent 6cc9260a, 'Emergency Protocol ... on Solana'), but its action is a Solidity call on the Ethereum Mainnet Controller and cites the mainnet swap procedure; the Solana AtomicSwap action is defined separately at 2f6f0f93 with borrow/repay instructions.

**Suggested.** Should specify the Solana AtomicSwap (borrow/repay) instruction sequence on the SvmAlmController, not a mainnetController Solidity call — or the document belongs in the Mainnet emergency branch.

### `A.2.2.6.2.1.2.2` — Medium
A.2 · `823cad54-4438-4ec3-9e13-d2624795fabd`

> The Operational Facilitator reviews the proposal. This review encompasses two aspects. First, the Operational Executor reviews the proposal for alignment with the Atlas.

**Issue.** The alignment review is attributed to the Operational Executor, but the document's own first sentence and A.2.2.6.2.2.2 clause (2) ('the Operational Facilitator must review each proposal for alignment and conformance') assign that review to the Operational Facilitator — two different actors for the same act in the same paragraph.

**Suggested.** Should read 'First, the Operational Facilitator reviews the proposal for alignment with the Atlas.'

### `A.5.3.1.1.1` — Medium
A.5 · `eaf8cf29-90fd-4b9b-b0a8-02ce8386908c`

> The remaining SKY in the `0x14D98650d46BF7679BBD05D4f615A1547C87Bf68` multisig that is not used to fund the MerkleDistributor will be burned by calling the `burn` function on the multisig.

**Issue.** `burn` is an ERC-20 function on the SKY token contract, not a function of the multisig wallet the same sentence identifies as an Accessibility Facilitator multisig at that address; as written the action is attributed to the wrong contract.

**Suggested.** Say the multisig will call the `burn` function on the SKY token contract to burn its remaining balance.

### `A.6.1.1.1.2.6.1.2.1.1.3.7.2` — Medium
A.6.1.1.1 · `bb47f741-e64b-440c-822c-3937fe94e87e`

> The maximum amount of USDG that can be sent to the Robinhood Chain ALM Proxy is specified in the document herein. - `maxAmount` (USDG): 50,000,000 - `slope` (USDG/ day): 250,000,000 - Recipient: `0xf752cF318dfF2C01575c98741AA52e7a34d873Fd`

**Issue.** The limit is described as USDG sent TO the Robinhood Chain ALM Proxy, but the stated Recipient 0xf752cF318dfF2C01575c98741AA52e7a34d873Fd is not the Robinhood Chain ALM_PROXY address, which A.6.1.1.1.2.6.1.2.1.1.1.2.7.5 (d19eab7d-e0b8-4be2-b672-40d7773c6119) gives as 0xfD2fD4B046136B540A56C11c75ac679AE7d1dB24.

**Suggested.** Either correct the Recipient to the ALM Proxy address, or reword the description to say what this recipient actually is.

### `A.6.1.1.1.2.6.1.3.1.3.1.3.1.5.3` — Medium
A.6.1.1.1 · `1c4f95da-5479-4c47-bc8b-4e7875cf8139`

> shares = abi.decode(             proxy.doCall(                 [Instance_Morpho_Fluid_Vault_Address_Placeholder],,                 abi.encodeCall(IERC4626([Instance_Fluid_USDS_Vault_Address_Placeholder]).deposit, (amount, address(proxy)))

**Issue.** Inside the Fluid sUSDS ERC4626 Vault Instance, the doCall target is a Morpho-named placeholder while the encoded call in the same statement uses the Fluid placeholder — the two cannot both be the vault being deposited into.

**Suggested.** Both should be `[Instance_Fluid_USDS_Vault_Address_Placeholder]`.

### `A.6.1.1.1.2.6.1.3.1.3.1.3.2.4.3` — Medium
A.6.1.1.1 · `ca253911-1755-481f-ae63-1d4027d1a690`

> shares = abi.decode(             proxy.doCall(                 [Instance_Morpho_Fluid_Vault_Address_Placeholder],,                 abi.encodeCall(IERC4626(token).withdraw, (amount, address(proxy), address(proxy)))

**Issue.** Same defect in the Fluid instance's withdraw path: the doCall target names a Morpho vault placeholder, whereas every surrounding document in this Fluid sUSDS instance uses `[Instance_Fluid_USDS_Vault_Address_Placeholder]`.

**Suggested.** Should be `[Instance_Fluid_USDS_Vault_Address_Placeholder]`.

### `A.6.1.1.1.2.6.1.3.1.3.1.3.2.5.1` — Medium
A.6.1.1.1 · `13e8ea29-273a-45ce-9a61-10256fb7caf0`

> using `abi.encodeCall` with the address of the ERC-4626 `token` vault(`[Instance_Morpho_USDS_Vault_Address_Placeholder]`), the `shares` to `redeem`

**Issue.** This step belongs to the Fluid sUSDS ERC4626 Vault Instance (A.6.1.1.1.2.6.1.3.1.3.1) and names a Morpho vault placeholder, while the code block in the immediately following document A...3.2.5.3 uses `[Instance_Fluid_USDS_Vault_Address_Placeholder]` for the same call.

**Suggested.** Should be `[Instance_Fluid_USDS_Vault_Address_Placeholder]`.

### `A.6.1.1.1.2.6.1.3.1.6.4.4.1.3` — Medium
A.6.1.1.1 · `2ece6e1d-b07a-4df5-9aa6-616756f64815`

> `0x9Ad87668d49ab69EEa0AF091de970EF52b0D5178`

**Issue.** The Spark Savings v2 spPYUSD Instance's Setter is given as 0x9Ad8...5178, which is the address listed as the Morpho USDC Instance's Allocator Role Address (A.6.1.1.1.2.6.1.3.1.5.1.2.2.3), while all three sibling Spark Savings v2 instances (ETH A...6.1.4.1.3, USDC A...6.2.4.1.3, USDT A...6.3.4.1.3) list Setter 0x2E1b01adABB8D4981863394bEa23a1263CBaeDfC and share identical Vault Implementation, Default admin and Taker addresses.

**Suggested.** Almost certainly should be `0x2E1b01adABB8D4981863394bEa23a1263CBaeDfC` like the other Spark Savings v2 instances — otherwise unclear, needs author.

### `A.6.1.1.1.2.6.1.3.1.7.1.2.1.4` — Medium
A.6.1.1.1 · `d148fb40-413f-4ef7-a852-e26f613c8cd0`

> spUSDC

**Issue.** The Arkis Instance declares its Token as `spUSDC` with Token Address 0x377C3bd93f2a2984E1E7bE6A5C22c525eD4A4815, but `spUSDC` is already the Token of the Spark Savings v2 USDC Instance (A.6.1.1.1.2.6.1.3.1.6.2.2.1.4) whose Token Address is 0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d — one ticker is bound to two different contracts in the same artifact.

**Suggested.** unclear — needs author (the Arkis instance's receipt token appears to have been copied from Spark Savings v2 USDC).

### `A.6.1.1.1.2.6.1.3.2.2.1.2.4.1` — Medium
A.6.1.1.1 · `29114e51-9590-4585-b494-b78417f35910`

> The inflow rate limits are: - `maxAmount`: 0 - `slope`: 5,000,000 USDS per day

**Issue.** The asset supplied for this Instance is sUSDS (A.6.1.1.1.2.6.1.3.2.2.1.2.1.3) and the matching outflow limit is denominated in fsUSDS, but the inflow slope is denominated in USDS — a third token that is neither the deposited asset nor the vault share.

**Suggested.** `slope`: 5,000,000 sUSDS per day

### `A.6.1.1.1.2.6.1.3.3.1.1.2.4.1` — Medium
A.6.1.1.1 · `6c0b965a-f912-454e-9214-1fb23974ad2c`

> The inflow rate limits are: - `maxAmount`: 0 - `slope`: 5,000,000 USDS per day

**Issue.** Same defect on the Arbitrum Fluid sUSDS Instance: the asset supplied is sUSDS (A.6.1.1.1.2.6.1.3.3.1.1.2.1.3) and the outflow limit is in fsUSDS, but the inflow slope is denominated in USDS.

**Suggested.** `slope`: 5,000,000 sUSDS per day

### `A.6.1.1.1.2.6.1.4.3.4.2.3.1.3` — Medium
A.6.1.1.1 · `938f26c5-6028-420d-86bf-f41f5d7aeb7e`

> make a call to the `susde` contract, invoking the `cooldownAssets` function with the specified amount of sUSDe. ... abi.encodeCall(susde.cooldownAssets, (usdeAmount))

**Issue.** The prose says the amount passed is sUSDe, but the code passes `usdeAmount` to `cooldownAssets`; the sibling document A.6.1.1.1.2.6.1.4.3.4.2.3.2 (24171b90-4967-4c15-ac77-789d42b0fc80) establishes that the sUSDe-share-denominated call is the separate `cooldownShares`/`cooldownSharesSUSDe` path, so assets and shares are being conflated.

**Suggested.** 'with the specified amount of USDe' (assets), leaving sUSDe for the cooldownShares variant.

### `A.6.1.1.2.2.6.1.3.2.1.1.2.2.1` — Medium
A.6.1.1.2 · `f9f790ea-f67a-4e6d-ac63-cd84faf208fe`

> ###### A.6.1.1.2.2.6.1.3.2.1.1.2.2.1 - Token Address `0xFE6920eB6C421f1179cA8c8d4170530CDBdfd77A`

**Issue.** The Avalanche Centrifuge JTRSY Instance gives 0xFE6920eB...d77A as the JTRSY Token Address, but the same address is declared as the 'Centrifuge ERC-7540 Vault Address' for the Ethereum Mainnet JTRSY Instance (A.6.1.1.2.2.6.1.3.1.14.1.2.2.2, uuid c519baf9-b02c-4c07-a113-ac73738a217c), whose JTRSY token is 0x8c213ee79581Ff4984583C6a801e5263418C4b86 — a vault address appears to have been recorded as the token address.

**Suggested.** unclear — needs author: supply the Avalanche JTRSY share-token address, or relabel this field as the vault address

### `A.6.1.1.2.2.6.1.3.4.1.1.2.1.3` — Medium
A.6.1.1.2 · `c3aa0280-f998-4510-a1fd-45bb47c62f4b`

> A.6.1.1.2.2.6.1.3.4.1.1.2.1.3 - Asset Supplied By Grove Liquidity Layer [Core] ... USDC

**Issue.** The Plasma Aave v3 USDT0 Instance states the asset supplied is USDC, but the same Instance's Token is USDT0 (A.6.1.1.2.2.6.1.3.4.1.1.2.1.4) and both its inflow and outflow rate limits are denominated in USDT0 (20,000,000 USDT0 / 20,000,000 USDT0 per day) - every sibling Instance denominates its rate limits in the asset supplied.

**Suggested.** Asset Supplied By Grove Liquidity Layer should most likely read 'USDT0' (or the rate limits should be restated in USDC).

### `A.6.1.1.2.2.6.1.3.7.2.1.2.2.1` — Medium
A.6.1.1.2 · `82df3c6c-85a2-4ba2-917f-f3ea230b610d`

> A.6.1.1.2.2.6.1.3.7.2.1.2.2.1 - Token Address [Core] ... `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`

**Issue.** For the 'USDG To USDC Via Paxos' Instance the Token Address is identical to that Instance's Underlying Asset Address (A.6.1.1.2.2.6.1.3.7.2.1.2.2.2) and to the USDG underlying address used by the sibling Morpho Instance (A.6.1.1.2.2.6.1.3.7.1.1.2.2.2), yet the Instance's 'Token to Receive' is USDC - so the USDC address appears to have been replaced by the USDG address.

**Suggested.** Token Address should be the USDC contract address on Robinhood Chain, not 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 (USDG).

### `A.6.1.1.3.2.6.1.2.2.1.1.2.1.2.4` — Medium
A.6.1.1.3 · `ff9638aa-a4d5-4a5e-a2bb-9b924b9987f9`

> ERC-7540 is a standard interface for vaults representing and managing multiple underlying assets within a single vault.

**Issue.** Contradicted by this document's own children, which describe ERC-7540 purely as a two-step asynchronous request/claim flow over a single underlying asset ('Shares will not be received immediately; they must be claimed in a separate step'); 'multiple underlying assets in a single vault' describes a multi-asset vault standard, not ERC-7540.

**Suggested.** Should read that ERC-7540 extends ERC-4626 with asynchronous (request-then-claim) deposits and redemptions.

### `A.6.1.1.4.2.5.2.2.3.1.2` — Medium
A.6.1.1.4 · `b70f1003-1159-4d5b-b362-c37aa11403d3`

> The reward address for the Morpho Integration Boost is `0xa7843f843d29ca33ba48d9d1335b774eecc328dc`.

**Issue.** This is byte-for-byte the same address given as the Curve Integration Boost reward address in A.6.1.1.4.2.5.2.2.2.1.2 (fa241343-8f00-454b-9b95-726cbcbb7b9d), so two distinct Integration Partners are recorded with an identical, partner-specific 'Integration Partner Reward Address' — every other Instance in the chunk has a unique address.

**Suggested.** unclear — needs author; one of the two partner reward addresses is almost certainly a copy-paste of the other


## Governance logic (5)

### `A.1.10.2.3.2.2.1.4.1.1.1` — Medium
A.1 · `01b44f43-c6e1-4b24-b715-296a5122fb35`

> Unreasonable delay in submitting the Report, or failure to thoroughly and accurately complete it (including omission of relevant facts), as determined by the Core Council, constitutes a separate Prime Spell Security Incident

**Issue.** A.1.10.2.3.2.2.1.3.3 (b3cd3112) gives the Core Facilitator and Core GovOps 'full discretion to determine whether a Prime Spell Security Incident has occurred and to impose appropriate penalties', but this document (and the escalation multiplier in A.1.10.2.3.2.2.1.4.2.3.2) assign that determination to the Core Council instead.

**Suggested.** Use one determining authority consistently (e.g. 'as determined by the Core Facilitator and Core GovOps') or state that the Core Council acts through them

### `A.1.6.4.3.3.1` — Medium
A.1 · `21d0b626-cd84-4237-8cab-d68f697c276d`

> If an RD fails to timely respond to the test messages, the Core Facilitator must remove them from RD status.

**Issue.** Its parent A.1.6.4.3.3 states the consequence of failing the emergency-communications requirement is that the RD 'become[s] completely ineligible to receive RD income' (with rank transfer only for Level 3), and RD status itself is not the Core Facilitator's to revoke: Level 1 and Level 2 Ranked Delegates are 'selected directly by Sky Governance' (A.1.6.4.1.1.3, A.1.6.4.1.2.3) and Level 3 rank is mechanically the ADs with the greatest delegated Voting Power (A.1.6.4.1.3.3).

**Suggested.** Align the subdocument with its parent: the Core Facilitator renders the RD ineligible for RD income (and, for a Level 3 RD, transfers the rank), rather than 'removing them from RD status'.

### `A.1.9.1.3.2` — Medium
A.1 · `3efb0238-aaae-4351-9ec9-31902f3a1394`

> This emergency contact mechanism is selected and validated by the Protocol Security Workstream Lead.

**Issue.** Vests selection of the mechanism in the Protocol Security Workstream Lead, while its own subdocument A.1.9.1.3.2.3 vests it elsewhere: 'The Core Facilitator may recommend changing the approved emergency contact mechanism ... in consultation with the Protocol Security Workstream Lead. The Core Facilitator's recommendation is subject to a poll through the Operational Weekly Cycle' — i.e. the PSWL is only consulted and Sky Governance decides.

**Suggested.** 'This emergency contact mechanism is validated by the Protocol Security Workstream Lead and approved through the process in A.1.9.1.3.2.3', or amend A.1.9.1.3.2.3 to give the PSWL the selection authority.

### `A.2.9.1.1.1.4.2.2.6` — Medium
A.2 · `10662753-b167-4043-b952-225cc9dd9e49`

> Decisions related to claim payouts require a quorum of three (3) experts from the Resilience Technical Committee with a simple majority (>50%).

**Issue.** The quorum is unsatisfiable as the Atlas stands: the Active Data list of current Resilience Technical Committee members (A.2.9.1.1.1.2.3.0.6.1) contains a single entry ('Gallagher'), so no three-expert quorum can be formed and no claim payout decision can be taken.

**Suggested.** Either populate the member list to at least three members, or state the quorum as a proportion of appointed members; unclear — needs author.

### `A.6.1.1.1.2.6.1.2.1.2.2.2.3` — Medium
A.6.1.1.1 · `1563f1ee-0097-4bb3-a03a-01162d00788b`

> - Operational GovOps Soter Labs: 2 signers - Spark Assets Foundation (SAF): 2 signers - Phoenix Labs (PL): 1 signer ... execution requires meeting the 2/5 threshold.

**Issue.** The multisig is stated to be 'jointly controlled by Operational GovOps Soter Labs and the Spark Assets Foundation' (A.6.1.1.1.2.6.1.2.1.2.2.2, 8286092a-69f2-46af-a989-c694a1756753), but with a 2-of-5 threshold Soter Labs' 2 signers alone (or SAF's 2 alone) meet it, so neither party's participation is actually required — joint control is unsatisfiable as configured.

**Suggested.** Raise the threshold (e.g. 3/5, which forces at least two parties) or drop the 'jointly controlled' characterisation.


## Contradiction (74)

### `A.1.10.2.4.11.2.3` — High
A.1 · `77583ed9-933e-477b-85be-1458e83586d3`

> the Governance Point must merge it into the master branch of the executive-votes GitHub repository.

**Issue.** Names the target as the 'master' branch, while A.1.10.2.4.8.5.2 and A.1.10.2.4.11.1.5 say the same executive-votes repository merges into the 'main' branch, and the proposals.json URL in A.1.10.2.4.11.2.1 itself is on blob/main.

**Suggested.** merge it into the main branch of the executive-votes GitHub repository

### `A.1.10.2.4.12.4.2` — High
A.1 · `66a80a93-fcfa-48d5-819e-99489288fa83`

> A Spell is classified as failing validation when: 1. One or more issues are identified during validation, or 2. Reported issues remain unresolved

**Issue.** Criterion 1 makes any Spell with an identified issue fail, yet the adjacent A.1.10.2.4.12.4.1 says a Spell passes when 'All reported issues have been resolved to the satisfaction of the Spell validator' — a Spell with identified-then-resolved issues satisfies both the pass and fail definitions.

**Suggested.** Failing criterion 1 should read 'One or more issues are identified during validation and remain unresolved' (or drop criterion 1, leaving only the unresolved-issues criterion).

### `A.1.11.2.3` — High
A.1 · `94856ced-5c37-42e0-a756-0fa2ccd73180`

> If the Facilitator rejects an Atlas Edit Weekly Cycle Proposal for misalignment, the Ranked Delegate who triggered the poll loses their AD buffer.

**Issue.** States the triggering Ranked Delegate forfeits their entire AD Buffer on a misalignment rejection, while the Action Tenet A.1.11.2.1.3.0.4.2 (bba7fb85) and Scenario A.1.11.2.1.3.0.4.2.1.1 (1ebcda5d) in the same chunk both say a rejection for misalignment costs only 'an amount of USDS from their AD Buffer equal to the Triggering Threshold'.

**Suggested.** ...the Ranked Delegate who triggered the Proposal loses an amount of USDS from their AD Buffer equal to the Triggering Threshold.

### `A.1.2.2.2.25` — High
A.1 · `fe9164c5-423c-41e8-b8a8-34f8a5d8d6b7`

> Navigation Hub Documents must be located at the .0.0 position of an Immutable or Primary Document.

**Issue.** Two different Supporting Document types are both mandated to occupy the identical reserved slot: A.1.2.2.2.21 (Definition Directory) says 'Definition Directory Documents must always be located at the .0.0 position of their Target Document', so a document needing both is unsatisfiable; the collision also extends to their children (Definitions vs Focus Hubs both at .0.0.X per A.1.2.2.2.26).

**Suggested.** Assign one of the two types a different reserved position (e.g. move Definition Directory to the free .0.2 slot), or state explicitly which takes precedence.

### `A.2.2.6.2.1.1.2` — High
A.2 · `2a466974-af55-4d3f-84a5-7ac840ffb620`

> Core GovOps validates the Agent’s inputs.

**Issue.** Root Edit Primitive inputs are assigned to Core GovOps here, but A.2.2.1.1.15 (d5ee3f2c) says 'Operational GovOps reviews the inputs to the Root Edit Primitive', and both A.2.2.1.1.13 and A.2.2.6.1.1.1.4 state that once the Executor Accord Primitive is Invoked (which precedes Root Edit in the mandated order) 'Core GovOps will no longer perform validation of the Agent's Primitive inputs'.

**Suggested.** Should read 'Operational GovOps validates the Agent's inputs.'

### `A.3.3.2.3.1` — High
A.3 · `104c90df-9236-41bc-a6ee-a6db3e8ef097`

> Prime Agents must maintain a Demand Absorption Buffer (DAB), a subset of ASC consisting of USDS that is for sale for at most 1.001 USD per USDS.

**Issue.** The DAB cannot be 'a subset of ASC' and consist of USDS: A.3.3.1.1 defines Actively Stabilizing Collateral as 'non-USDS assets', A.3.3.1.3.1 excludes USDS from the Agent Collateral Portfolio entirely, and A.3.3.2.2.1 defines ASC exhaustively as Resting + Latent ASC, neither of which can contain USDS - so a DAB equal to 25% of required ASC (A.3.3.2.3) is unsatisfiable as an ASC subset.

**Suggested.** The DAB should be stated as a separate requirement held alongside (not inside) Actively Stabilizing Collateral, or A.3.3.1.1's 'non-USDS' definition of ASC should be corrected.

### `A.3.5.2.2.1.2` — High
A.3 · `fc9cece1-84bf-4133-a2ef-ef2182a23a35`

> The `kbump` parameter is the amount of funds transferred from the Surplus Buffer to the Splitter every `splitter.hop` interval when the Surplus Buffer is greater than `kbump`.

**Issue.** The transfer condition names the lot-size parameter `kbump` (6,000 USDS, a positive amount) instead of the threshold `khump` (-200,000,000 USDS); this contradicts A.3.5.2.2.1.1, which defines `khump` as 'the minimum value of the Surplus Buffer for funds to be transferred', and A.3.5.2.2, which states transfers occur 'even when the Surplus Buffer is negative' - impossible if the gate were a positive kbump.

**Suggested.** '...when the Surplus Buffer is greater than `khump`.'

### `A.3.7.1.1.4` — High
A.3 · `a38e05bf-0820-4916-a71c-cff4f54e45df`

> ...will specifically use the Chronicle v3 oracle solution, until at least January 1st 2026. ... Other oracle solutions, including diversified oracles, will only be considered until January 1st, 2026, and only if there are unresolvable security con...

**Issue.** The two sentences cannot both hold: the first mandates exclusive use of Chronicle v3 until at least 2026-01-01, while the second confines consideration of alternatives to the window ending on that same date; as written the escape hatch for unresolvable Chronicle security concerns expired before it could ever be used (and is dead as of 2026-09-15).

**Suggested.** 'Other oracle solutions ... will only be considered after January 1st, 2026, and only if there are unresolvable security concerns with the Chronicle v3 oracles.'

### `A.4.4.1.3.8.5.1` — High
A.4 · `13c51e11-8ea3-4d4e-b631-2e99c559a914`

> The initial parameters set by the stUSDS BEAM in the Executive Vote deploying stUSDS and the stUSDS BEAM are: - `str` - 0 basis points - `duty` - 2,000 basis points

**Issue.** The initial `str` is given as 0 basis points, but A.4.4.1.3.8.6.1.1 (Initial Supply Rate, c4523493-97ba-4f57-ae2f-d407ab6e0f98) states the initial `str` 'must be set extraordinarily high to a value of approximately 40%' (4,000 bps) to incentivize deposits — the two initial values cannot both hold.

**Suggested.** State the initial `str` as approximately 4,000 basis points (40%), or reconcile A.4.4.1.3.8.6.1.1 to the 0 bps deployment value

### `A.6.1.1.1.2.6.1.1.2.4.1` — High
A.6.1.1.1 · `830b9c54-37df-41f1-9ae1-e114bc47636c`

> The Avalanche Instances Directory of the Aave Protocol with `Completed` Status are stored herein

**Issue.** This document sits inside A.6.1.1.1.2.6.1.1.2 - Active Instances Directory (and under A.6.1.1.1.2.6.1.1.2.4 - Avalanche, which says 'Instance status of `Active`'), but declares `Completed` Status; its child also points to A.6.1.1.1.2.6.1.3.4.1.1, i.e. the Active-instance configuration subtree (.3.*), not the Completed one (.4.*) used by every entry under A.6.1.1.1.2.6.1.1.3.

**Suggested.** Should read '... of the Aave Protocol with `Active` Status are stored herein.'

### `A.6.1.1.1.2.6.1.3.1.3.1.3.2.4` — High
A.6.1.1.1 · `91ec656f-417c-4357-b8ab-9c7a2404bc13`

> The operator must call the `withdraw` ERC-4626 function to withdraw a required amount of underlying assets from an ERC-4626 vault and receive the corresponding vault shares.

**Issue.** An ERC-4626 withdrawal burns the caller's shares and returns underlying assets; its own child document A.6.1.1.1.2.6.1.3.1.3.1.3.2.4.3 says the decoded value is 'the number of token `shares` burned in the withdrawal', so the vault cannot also pay out shares.

**Suggested.** Should read '...withdraw a required amount of underlying assets from an ERC-4626 vault, burning the corresponding vault shares.'

### `A.6.1.1.1.2.6.1.4.3.5.1.2.3` — High
A.6.1.1.1 · `8e52e9d6-6cb0-44e9-9068-21257c1cde34`

> - `USTB_DEPOSIT`: `0x43415eB6ff9DB7E26A15b704e7A3eDCe97d31C4e` - `USTB_REDEEM`: `0x43415eB6ff9DB7E26A15b704e7A3eDCe97d31C4e` - `USTB_REDEEM` (instant liquidity): `0x4c21B7577C8FE8b0B0669165ee7C8f67fa1454Cf`

**Issue.** The identifier `USTB_REDEEM` is bound to two different values in the same list, and `USTB_DEPOSIT` and `USTB_REDEEM` are given the identical value — which is also the USTB token address stated in A.6.1.1.1.2.6.1.4.3.5.1.2.2.1 (818944d2-c16f-4bd8-af85-09c3a31eccd3), not a distinct rate-limit key.

**Suggested.** Give each rate limit a distinct RateLimitID and rename the third entry (e.g. `USTB_REDEEM_INSTANT`); the deposit/redeem entries should not both be the token address.

### `A.6.1.1.2.2.6.1.3.1.12.3.2.4.1` — High
A.6.1.1.2 · `805c6feb-74c9-4e43-90c8-446dd937a618`

> - AUSD: `maxAmount`: 5,000,000 AUSD, `slope`: 5,000,000 AUSD per day - USDC: `maxAmount`: 5,000,000 USDC, `slope`: 5,000,000 USDC per day

**Issue.** This Instance declares deposit RateLimitIDs 0x71efb11b...a187 (USDC) and 0x89c0cb8c...1541 (AUSD) at 5,000,000 maxAmount/slope, but the Uniswap v3 AUSD/USDC LP Instance (A.6.1.1.2.2.6.1.3.1.12.2.2.4.1, uuid 2a16ab46-2924-4c7d-8c47-26f8119fcf62) states the byte-identical RateLimitIDs at 25,000,000 maxAmount and 25,000,000/day slope — one on-chain rate-limit key cannot hold two values.

**Suggested.** unclear — needs author: either the two Instances must share one stated value, or the Diamond PAU Instance must be given its own distinct RateLimitIDs

### `A.6.1.1.2.2.6.1.3.1.4.4.2.3` — High
A.6.1.1.2 · `3af5241e-5b72-4466-9e69-dccb8a8d203b`

> The specific `RateLimitID`(s) for this conduit’s inflow and outflow will be specified in a future iteration of the Grove Artifact.

**Issue.** This document states the RateLimitIDs are not yet specified, but its own two child documents specify them concretely (A.6.1.1.2.2.6.1.3.1.4.4.2.3.1 inflow 0x098ad67d..., A.6.1.1.2.2.6.1.3.1.4.4.2.3.2 outflow 0x027191d7...); both cannot be true.

**Suggested.** Use the wording of the sibling instances: 'The specific RateLimitID(s) for this conduit's inflow and outflow are defined in the subdocuments herein.'

### `A.6.1.1.3.2.2.2.2.1.2.1.1.2` — High
A.6.1.1.3 · `d4c3c15b-7cdc-4c57-9bf0-53bbfd95e52c`

> The post must include cryptographic proof that the author controls an account holding the required percentage of the total KEEL token supply specified in [A.6.1.1.3.2.2.2.2.1.2.1.1 - Root Edit Proposal Submission](98f59541-8896-4e64-8e99-2b25e7791bf0).

**Issue.** The threshold basis is restated incorrectly: the referenced document requires holding at least 1% of the CIRCULATING token supply, not of the total supply - two different denominators for the same submission threshold.

**Suggested.** Should read 'the required percentage of the circulating KEEL token supply'.

### `A.6.1.1.3.2.2.2.2.1.2.1.1.2` — High
A.6.1.1.3 · `(transitionary measure, Keel)`

> cryptographic proof that the author controls an account holding the required percentage of the total KEEL token supply

**Issue.** Cites 'total KEEL token supply' but the rule it links (A.6.1.1.3.2.2.2.2.1.2.1.1) sets the threshold at 1% of the CIRCULATING token supply.

**Suggested.** circulating KEEL token supply

### `A.6.1.1.3.2.6.1.2.1.1.3.2.2.2` — High
A.6.1.1.3 · `06081a43-075d-48c1-a26d-6578c1aa2fd3`

> USDC For USDS Swap Maximum ... The maximum amount of USDC that can be swapped for USDC by the Keel Liquidity Layer on Solana is specified in the document herein.

**Issue.** The body names USDC on both sides of the swap, contradicting the document title 'USDC For USDS Swap Maximum'; every sibling swap document (USDC For USDT, USDC For USDG, USDC For PYUSD, USDT For USDC) correctly names the destination asset in its body.

**Suggested.** The maximum amount of USDC that can be swapped for USDS by the Keel Liquidity Layer on Solana.

### `A.6.1.1.3.2.6.1.2.2.1.2.1.2.3.2.1` — High
A.6.1.1.3 · `(withdrawERC4626, Keel)`

> holds at least the amount of the underlying asset specified for withdrawal

**Issue.** Same withdrawERC4626 precondition defect the agents found in Obex and Pattern: the precondition requires the ALM Proxy to hold the UNDERLYING ASSET, but the operation burns vault SHARES and sends the asset to the Proxy. Corpus-wide scan shows the identical wording in exactly 3 artifacts (Keel, Obex, Pattern); Keel's copy was not separately reported by an agent.

**Suggested.** holds at least the amount of vault shares required for the withdrawal

### `A.6.1.1.4.2.2.2.2.1.2.1.1.2` — High
A.6.1.1.4 · `f88fc097-7e41-41d7-aac9-992a9a11919f`

> The post must include cryptographic proof that the author controls an account holding the required percentage of the total SKYBASE token supply specified in [A.6.1.1.4.2.2.2.2.1.2.1.1 - Root Edit Proposal Submission]

**Issue.** This transitionary measure says the eligibility percentage is of the 'total' SKYBASE supply, but the document it explicitly cites (A.6.1.1.4.2.2.2.2.1.2.1.1, and its exception A.6.1.1.4.2.2.2.2.1.2.1.1.1) sets the threshold at 1% of the 'circulating' token supply — two different denominators for the same requirement.

**Suggested.** Change 'total SKYBASE token supply' to 'circulating SKYBASE token supply' to match A.6.1.1.4.2.2.2.2.1.2.1.1.

### `A.6.1.1.4.2.2.2.2.1.2.1.1.2` — High
A.6.1.1.4 · `(transitionary measure, Skybase)`

> the required percentage of the total SKYBASE token supply

**Issue.** Cites 'total SKYBASE token supply' but the linked rule sets 1% of the CIRCULATING token supply.

**Suggested.** circulating SKYBASE token supply

### `A.6.1.1.5.2.2.2.2.1.2.1.1.2` — High
A.6.1.1.5 · `(transitionary measure, Obex)`

> the required percentage of the total OBEX token supply

**Issue.** Cites 'total OBEX token supply' but the linked rule sets 1% of the CIRCULATING token supply.

**Suggested.** circulating OBEX token supply

### `A.6.1.1.5.2.6.1.2.2.1.2.1.2.3.2.1` — High
A.6.1.1.5 · `d545d2f1-5973-4a93-889c-9d558ff79be7`

> The operation will only succeed if the ALM Proxy holds at least the amount of the underlying asset specified for withdrawal; otherwise, the transaction will revert. ... The withdrawn assets will be sent to the ALM Proxy.

**Issue.** The stated precondition for withdrawERC4626 (ALM Proxy must already hold the underlying asset) contradicts the operation itself, which burns vault SHARES held by the Proxy and then sends the underlying asset to the Proxy; the sibling redeemERC4626 doc correctly states the precondition in shares.

**Suggested.** Precondition should be that the ALM Proxy holds at least the number of vault shares needed to cover the requested withdrawal amount (copy-paste from depositERC4626).

### `A.6.1.1.6.2.2.2.2.1.2.1.1.1` — High
A.6.1.1.6 · `351f7eac-691a-4bcb-868e-5ca56787d53a`

> The post must include cryptographic proof that the author controls an account holding the required percentage of the total PATTERN token supply specified in [A.6.1.1.6.2.2.2.2.1.2.1.1 - Root Edit Proposal Submission](a6261165-8c88-432f-a3c1-79465599d706).

**Issue.** The transitionary measure states the threshold is a percentage of TOTAL PATTERN supply, but the document it explicitly cites sets it as 'at least 1% of the circulating token supply' (and the vote doc A.6.1.1.6.2.2.2.2.1.2.1.4 likewise uses circulating supply), so the two state different bases for the same threshold.

**Suggested.** Change 'total PATTERN token supply' to 'circulating PATTERN token supply' to match A.6.1.1.6.2.2.2.2.1.2.1.1.

### `A.6.1.1.6.2.2.2.2.1.2.1.1.2` — High
A.6.1.1.6 · `(transitionary measure, Pattern)`

> the required percentage of the total PATTERN token supply

**Issue.** Cites 'total PATTERN token supply' but the linked rule sets 1% of the CIRCULATING token supply.

**Suggested.** circulating PATTERN token supply

### `A.6.1.1.6.2.6.1.2.2.1.2.1.2.3.2.1` — High
A.6.1.1.6 · `40875283-48ec-48f0-8b61-e45d33f976ab`

> providing the vault token address and the amount of the underlying asset to withdraw. The operation will only succeed if the ALM Proxy holds at least the amount of the underlying asset specified for withdrawal; otherwise, the transaction will revert.

**Issue.** The stated precondition for withdrawERC4626 is that the ALM Proxy already holds the underlying asset it is withdrawing, which contradicts the same document's next bullet ('burning the necessary number of vault shares held by the ALM Proxy') and the sibling redeemERC4626 doc (037d3def), which correctly conditions on the Proxy holding enough shares; it appears copied from the depositERC4626 doc (04ac423a).

**Suggested.** Should read that the operation only succeeds if the ALM Proxy holds enough vault shares to cover the requested underlying-asset withdrawal.

### `A.6.1.1.7.2.2.2.2.1.2.1.1.2` — High
A.6.1.1.7 · `(transitionary measure, Osero)`

> the required percentage of the total OSERO token supply

**Issue.** Cites 'total OSERO token supply' but the linked rule sets 1% of the CIRCULATING token supply.

**Suggested.** circulating OSERO token supply

### `A.6.1.1.8.2.2.2.2.1.2.1.1.1` — High
A.6.1.1.8 · `0048952f-30e2-484a-975a-62cc9e84c715`

> The post must include cryptographic proof that the author controls an account holding the required percentage of the total Launch Agent 7 token supply specified in [A.6.1.1.8.2.2.2.2.1.2.1.1 - Root Edit Proposal Submission]

**Issue.** It cites the submission threshold as a percentage of TOTAL supply, but the document it references (A.6.1.1.8.2.2.2.2.1.2.1.1) sets the threshold at 1% of the CIRCULATING token supply — two different bases, so the two documents state different proposal thresholds.

**Suggested.** Change 'total Launch Agent 7 token supply' to 'circulating Launch Agent 7 token supply' to match A.6.1.1.8.2.2.2.2.1.2.1.1 (or fix the basis in both).

### `A.6.1.1.8.2.2.2.2.1.2.1.1.1` — High
A.6.1.1.8 · `(transitionary measure, Launch Agent 7)`

> the required percentage of the total Launch Agent 7 token supply

**Issue.** Cites 'total Launch Agent 7 token supply' but the linked rule (A.6.1.1.8.2.2.2.2.1.2.1.1) sets 1% of the CIRCULATING token supply. Sixth and final instance of this template-propagated defect.

**Suggested.** circulating Launch Agent 7 token supply

### `A.1.10.2.4.12.3.2.1` — Medium
A.1 · `fb60b182-3ac9-4593-b9c7-8e1eaaeaa099`

> Spell Validators Must Check Deployed Spell License [...] While the Spell should use the correct license to pass validation, this is not considered a strict requirement.

**Issue.** The title states the check as a 'Must', but the document sits under A.1.10.2.4.12.3.2 'Recommended Spell Validation Checks' (defined in A.1.10.2.4.12.3 as 'not mandatory') and its own body says it is not a strict requirement.

**Suggested.** Retitle to 'Spell Validators Should Check Deployed Spell License'.

### `A.1.10.2.4.12.3.2.2` — Medium
A.1 · `83f53a73-7e2f-4dc9-a371-e19238924bf3`

> Spell Validators Must Check Compiler Version [...] While the Spell should use the correct version to pass validation, this is not considered a strict requirement.

**Issue.** The title states the check as a 'Must', but the document sits under A.1.10.2.4.12.3.2 'Recommended Spell Validation Checks' (defined in A.1.10.2.4.12.3 as 'not mandatory') and its own body says it is not a strict requirement.

**Suggested.** Retitle to 'Spell Validators Should Check Compiler Version'.

### `A.1.10.2.4.8.2.6` — Medium
A.1 · `3de17a79-145a-4ec5-b43d-d8c371ee598e`

> The "Authorization" link may lead to an Atlas document, a Governance Poll or a Forum Post, while the "Proposal" link is usually a Forum Post.

**Issue.** A.1.10.2.4.5.1.1 (4140df92) classifies forum posts as 'weak comment type' provenance that 'must not be used to authorize Executive actions', yet this document permits a Forum Post as the Authorization link (and A.1.10.2.3.2.1.3.1 makes the Core Facilitator's forum reply the Derived Action's Authority URL).

**Suggested.** Either narrow the Authorization link to Atlas documents / Governance Polls, or carve out in A.1.10.2.4.5.1.1 which forum posts (e.g. by a party holding Atlas authority) count as sufficient provenance

### `A.1.2.2.1.3` — Medium
A.1 · `e87b6850-3792-495d-9460-0ac069a217e6`

> Supporting Documents always have Document Identifiers that contain at least one 0.

**Issue.** Contradicted by A.1.2.2.2.30 (Needed Research), whose Type Category is 'Supporting Document' but whose identifiers are 'NR-' plus an incremented number; the actual instances NR-1, NR-2 and NR-3 contain no 0 and do not begin with the capital A that A.1.2.1.1 requires of all Document Identifiers.

**Suggested.** Add the Needed Research exception to this rule (and to A.1.2.1.1), as A.1.2.2.2.30 itself does for the Supporting Root derivation.

### `A.1.2.2.2.6` — Medium
A.1 · `1c19b404-d396-4148-9cd8-4657ad37e896`

> Core Documents follow the Document Identifier Rules of Primary Documents. Core Documents have Document Identifiers that are 4 layers or deeper in the Document Tree, and cannot contain 0's [zeros].

**Issue.** This absolute rule (repeated in A.1.2.2.1.2) is violated by 59 documents typed [Core] in the A.0 Atlas Preamble subtree — e.g. A.0.1.1.1 Organizational Alignment [Core] (4f6fda1e-7450-4065-8095-e93cb10b3a2a) — whose identifiers all contain the 0 of the A.0 prefix; by the stated rule every one of them would instead be a Supporting Document (A.1.2.2.1.3).

**Suggested.** Carve out the A.0 Preamble subtree from the no-zeros rule, or state that the rule applies only to digits after the Scope/Preamble root segment.

### `A.1.6.10` — Medium
A.1 · `d5d4cc4a-8877-4931-861f-056793387b92`

> ADs must strictly adhere to all onboarding procedures and usage instructions associated with this emergency contact mechanism. ADs that fail to do so will be considered in misalignment and will be derecognized.

**Issue.** Mandates automatic derecognition for what is by description an administrative/procedural failure, contradicting the Graduated Response Framework, which states that 'Breaches of Aligned Delegate requirements are categorized into two (2) tiers' (A.1.6.6.1), puts 'minor communication lapses, and similar administrative failures' in Tier 1 (a public notice, not derecognition — A.1.6.6.1.1), reserves immediate derecognition for the seven enumerated Tier 2 integrity breaches (A.1.6.6.1.2), none of which covers this, and which A.1.5.9.2.1 says 'should be applied' to AD breaches.

**Suggested.** Route the failure through the Graduated Response Framework (Tier 1 notice, escalating to Tier 2), or state explicitly why this requirement is carved out of A.1.6.6.1 the way A.1.6.1.4.1 carves out the Probationary Period.

### `A.1.6.8` — Medium
A.1 · `7b0da718-62c1-4718-8d9d-47faa1647c6f`

> The Core Facilitator must initiate a formal adjudication pursuant to [A.1.5.9 - Adjudication Process](560e1024-0897-4f1e-ae71-3ba31e29ed57) where there is an allegation concerning AD breach of operational security.

**Issue.** This makes adjudication mandatory on any allegation, which cannot both hold with A.1.6.6.0.3.2 ('Where an allegation fails to meet this threshold, the Core Facilitator may decline to initiate adjudication') and A.1.6.6.0.4.1 / A.1.5.8.0.4.1 ('the Core Facilitator must decide whether to initiate a formal adjudication process') in the same Article.

**Suggested.** 'must initiate a formal adjudication ... where there is a credible-evidence-supported allegation concerning AD breach of operational security' (i.e. subject the mandate to the A.1.6.6.0.3.2 credible-evidence threshold).

### `A.1.9.1.3.1` — Medium
A.1 · `45a7ccff-09fa-4d95-b3d8-e3f34f7917cf`

> Where an Emergency Response Group Member is a team, the two (2) team members responsible for incident response are required to join the Signal Group.

**Issue.** Fixes Signal Group membership at exactly two per team, contradicting A.1.9.1.2.3 ('A team may assign more than two (2) of its team members ... at the discretion of Core GovOps') and A.1.9.1.2.3.1, which expressly permits Soter Labs to assign more than two members to 'the permissioned Emergency Response Communication Channels defined in A.1.9.1.3' — of which this Signal Group is one.

**Suggested.** 'the team members responsible for incident response are required to join the Signal Group' (drop the hard count of two so the A.1.9.1.2.3 / A.1.9.1.2.3.1 exceptions can apply).

### `A.2.2.1.2.4.1.2` — Medium
A.2 · `7b25b220-92f9-4936-8296-31c0f3d8ddbc`

> the Agent must Activate and Invoke (1) the Agent Token Primitive, then (2) the Executor Accord Primitive, and finally (3) the Root Edit Primitive ... assuming that these Primitives were not already Globally Activated during the "Pre Transformation" S

**Issue.** The conditional is unsatisfiable: A.2.2.5.1.1.1.2 and A.2.2.5.2.1.1.2 both make Core GovOps validation of the Agent Creation and Transformation Primitives conditional on all six Primitives (Agent Creation, Prime/Executor Transformation, Agent Token, Executor Accord, Root Edit, Ecosystem Upkeep Fee) already being Activated — i.e. before the Pre Root Edit stage begins — while A.2.2.1.2.4.1.1 mandates only the Ecosystem Upkeep Fee Primitive during the Pre Transformation stage.

**Suggested.** unclear — needs author: either drop the six-primitive activation precondition from the Agent Creation/Transformation validation docs, or state that Agent Token, Executor Accord and Root Edit are only Invoked (not Activated) during the Pre Root Edit stage.

### `A.2.2.10.1.1.1.2.1.2.1` — Medium
A.2 · `8b5f1ffd-9dfd-4aa0-8fc2-638a79d9fadb`

> `maxAmount` sets a hard cap on the level of allocation to an Instance at any given time.

**Issue.** Describes maxAmount as a cap on the level of allocation to the Instance, while its own parent A.2.2.10.1.1.1.2.1.2 states rate limits 'do not act as a limit on the total amount that may be allocated to that Instance', and the RateLimits code in A.2.2.10.1.1.1.2.5.3.1 shows maxAmount only caps the refillable allowance (currentRateLimit), not cumulative allocation.

**Suggested.** '`maxAmount` sets a hard cap on the rate limit's available allowance at any given time' — a ceiling on the refilling allowance, not on the Instance's total allocation

### `A.2.2.10.1.1.1.2.4.1.3` — Medium
A.2 · `92a74fe1-3115-4cd7-bbf8-4e16fb4b0aa8`

> It already holds that value on the `RateLimits` contract and has no default at all. A rate limit that is already unlimited is locked the same way whether or not it was ever registered. Registering a default other than the unlimited value removes that lock.

**Issue.** The middle sentence says a currently-unlimited rate limit is locked 'whether or not it was ever registered', which contradicts both the enumerated second case (locked only if it 'has no default at all') and the closing sentence ('Registering a default other than the unlimited value removes that lock') — a rate limit that is unlimited but carries a finite registered default is locked by one sentence and unlocked by the other two.

**Suggested.** Narrow the sentence to the case it is clarifying, e.g. 'A rate limit that is already unlimited is locked the same way whether or not the unlimited value was ever registered as its default.'

### `A.2.2.10.1.1.1.2.5.2.5.3.3` — Medium
A.2 · `3986fe17-e84d-407a-9192-61e6b842426a`

> The maximum tick deviation is the only governance-configured control on the swap's execution quality; the minimum amount received has no equivalent governance floor beyond being non-zero.

**Issue.** Contradicts A.2.2.10.1.1.1.2.1.6, which defines `maxSlippage` as the configured maximum 'deviation from expected output when executing trades or liquidity operations in a pool', and the two sibling Uniswap v3 operations (A.2.2.10.1.1.1.2.5.2.5.1.3 and A.2.2.10.1.1.1.2.5.2.5.2.3), which both require the specified minimums to 'satisfy the configured maximum slippage for the pool'.

**Suggested.** unclear — needs author: either state that swaps are also bounded by the pool's configured maxSlippage, or amend A.2.2.10.1.1.1.2.1.6 so `maxSlippage` is scoped to liquidity operations only

### `A.2.2.2` — Medium
A.2 · `bdbb8ac9-d87e-4052-9e69-8267f38a54cf`

> All Sky Primitive Process Definitions are structured according to a common data schema ... At present, only the Distribution Reward Primitive and the Integration Boost Primitive specifications are structured using this schema.

**Issue.** The same document asserts that all Sky Primitive Process Definitions are structured according to the schema and then that only two Primitive specifications currently are; both cannot be true.

**Suggested.** The opening sentence should say Process Definitions 'must be' / 'will be' structured according to the common schema, reconciling it with the 'at present, only two' statement.

### `A.2.2.5.4.1.1.3` — Medium
A.2 · `309e17ed-c75a-48f5-859f-70a5cb29a1f8`

> The Agent Artifact is officially upgraded to reflect an Agent Token Primitive Instance, with a Status of `Active`.

**Issue.** A.2.2.1.3.2.3 defines `Completed` as the status for 'an Instance designed for a single Invocation [that] has achieved its intended outcome and requires no further management', and A.2.2.5.4.1.2.1 says exactly that of the Agent Token Primitive ('deployed solely to create a one-off Token ... no further management process is needed post-deployment'); A.2.2.1.2.4.2.1.1 likewise groups Agent Token with the primitives whose status becomes `Completed`. The sibling one-shot primitives (A.2.2.5.1.1.1.3, A.2.2.5.2.1.1.3) are set to `Completed`.

**Suggested.** Status should be `Completed`, matching the Agent Creation and Prime Transformation Primitive Instances.

### `A.2.2.9.1.2.4.1.1` — Medium
A.2 · `27229032-ddb6-41a5-a5d5-6168ccc3142f`

> The Distribution Reward Calculation includes the calculation of the Fees for Unrewarded USDS Balances, the Fees for Rewarded USDS Balances, and the Prime Agent Management Fee.

**Issue.** None of these three components exists anywhere in the Distribution Reward Primitive: A.2.2.9.1.2.1.2 and A.2.2.9.1.2.1.3.2 define the Distribution Reward solely as average monthly balance x 0.2% annual rate / 12, and this process's own Process Flow (A.2.2.9.1.2.4.1.1.2) calculates only eligible USDS/sUSDS balances; 'Unrewarded USDS balances' is the Integration Boost's calculation base (A.2.2.9.2.2.1.1).

**Suggested.** Describe the calculation as eligible USDS and sUSDS balances times the Distribution Reward rate divided by twelve, or move these fee components to the Primitive that actually defines them.

### `A.2.2.9.2.2.1.2.3` — Medium
A.2 · `a26ea73f-ab67-4e02-93cd-b43d22a6e63c`

> Data is calculated on a weekly basis from Monday to Sunday for payment the following Monday. Failure to submit data on time will result in a delay of payment of the Integration Boost until the following week.

**Issue.** This fixes Integration Boost payment to a weekly Monday schedule, but A.2.2.9.2.2.1.3.1 states the Cadence at which the Integration Boost is calculated and distributed may be weekly, biweekly or monthly, and A.2.2.9.2.2.4.1.1.1.1.1 triggers the calculation 'at the end of each occurrence of the Cadence' - the two payment timings cannot both hold for a biweekly or monthly Instance.

**Suggested.** State that data is submitted weekly but payment occurs at the end of each occurrence of the Instance's configured Cadence.

### `A.2.8.1.1.1.2` — Medium
A.2 · `cf7e0654-f9a6-45e4-9984-14387067cb17`

> The Core Facilitator is isolated from the parties to maintain impartiality. The Core Facilitator exclusively reviews the information prepared by Core GovOps and delivers a decision to Core GovOps, which communicates it to the parties.

**Issue.** 'Exclusively reviews the information prepared by Core GovOps' conflicts with A.2.8.1.1.2.3.2, which says 'The Core Facilitator reviews the analysis prepared by Core GovOps along with the arguments presented by the parties and reaches a decision'.

**Suggested.** Either drop 'exclusively' here, or in A.2.8.1.1.2.3.2 say the parties' arguments reach the Facilitator only through the Core GovOps analysis

### `A.2.8.2.1.2.9.1` — Medium
A.2 · `7d16afc8-0eb4-40db-81aa-915a7f052859`

> Spark and Grove will share 50% of all revenue and expenses associated with Spark's Allocation System investments in USDe and sUSDe.

**Issue.** Within the same Accord, A.2.8.2.1.2.1 caps the revenue share at 'up to 40% maximum with JRC rental' and A.2.8.2.1.2.1.1 limits it to 'the spread earned on USDS debt', yet this arrangement is a 50% share of a broader revenue base and is explicitly paired with a Junior Risk Capital Rental from Grove (A.2.8.2.1.2.9.2).

**Suggested.** State that the USDe/sUSDe share is an agreed exception to the 40% JRC-rental cap and to the USDS-spread-only base, or align the figures

### `A.2.8.2.2` — Medium
A.2 · `aa3b8e65-0ded-48c2-9c40-812debf99f32`

> The subdocuments herein record the terms of agreement between Sky, Grove, and Spark as agreed in Ecosystem Accord 2.

**Issue.** This names three parties to Ecosystem Accord 2, but its own subdocument A.2.8.2.2.1.1 states 'The parties to Ecosystem Accord 2 are Sky, Spark, Grove, and Moonbow' and a Moonbow Details document (A.2.8.2.2.1.1.4) is provided.

**Suggested.** Add Moonbow to the parent sentence: 'between Sky, Grove, Spark, and Moonbow'

### `A.2.8.2.2.2.2.4` — Medium
A.2 · `23b21d6f-ad66-42ff-9e9f-c5bd5da6e8d4`

> This grant will cover the difference between the borrowing Base Rate and SOFR, as specified in [A.3.3.2.2.4.1.3 - Secured Overnight Financing Rate](2edd1333-6ca6-4c10-9d71-80b85d4a4265).

**Issue.** A grant covering the full Base Rate minus SOFR leaves the Prime paying SOFR flat for the whole subsidised period, which contradicts A.2.8.2.2.2.2.2's subsidy formula `SOFR + ((Base_Rate - SOFR) * T/24)` under which the rate paid ramps from SOFR up to the Base Rate over the same 24 months.

**Suggested.** State that the grant covers only the un-ramped portion, i.e. (Base_Rate - SOFR) * (1 - T/24), or reconcile the two documents

### `A.2.8.2.6.2.2.2` — Medium
A.2 · `20eeeaf4-38bc-4440-be1c-a1ee67ee3491`

> The Initial Allocation is distributed in USDS to the Osero SubProxy.

**Issue.** Osero's Initial Allocation is 10,500,000 USDS (A.2.8.2.6.2.2.1) but only 10,000,000 goes to the Osero SubProxy (A.2.8.2.6.2.2.2.2); the remaining 500,000 is transferred to the Osero Foundation (A.2.8.2.6.2.2.2.1), so the distribution statement is not true of the whole allocation. The parallel Skybase document (A.2.8.2.7.2.2.2) correctly itemises its 10m/5m split.

**Suggested.** Should read that 10,000,000 USDS is distributed to the Osero SubProxy and 500,000 USDS to the Osero Foundation.

### `A.2.9.1.1.1.4.2.2.7` — Medium
A.2 · `99079da7-e8e9-4660-96a6-269625d821cc`

> The recommendations of the Resilience Technical Committee are non-binding and will not give rise to any right or claim to the beneficiaries nor give rise to any obligation or responsibility.

**Issue.** Contradicts A.2.9.1.1.1.3.3.1, which makes 'the payout of a claim ... subject to the approval of the Resilience Technical Committee (at their sole and absolute discretion)' (i.e. a binding gate), and A.2.9.1.1.1.4.2.2.5, which states the same recommendations 'are definitive, and are not subject to appeal' — a recommendation cannot simultaneously be definitive/approval-conferring and non-binding.

**Suggested.** Unclear — needs author; either the RTC decision is a binding approval (fix 4.2.2.7) or it is advisory only (fix 3.3.1 and 4.2.2.5).

### `A.4.3.2.1` — Medium
A.4 · `caba97e4-4d4d-4aa9-9ed4-f0d1c8b1c552`

> SKY token rewards are not currently available to USDS users.

**Issue.** A.4.1.2.2.4.1 (8189e776-d631-44a0-81e5-3b2d5d88ef54) states in the present tense that 'USDS users may be able to earn SKY Rewards' and that the emission funding was replaced by an implemented solution funding those rewards from SKY held by the Sky Protocol; that describes a live mechanism the same chunk says is not available.

**Suggested.** unclear — needs author: either mark the SKY Rewards funding solution in A.4.1.2.2.4.1 as historical/inactive, or drop the 'not currently available' statement

### `A.4.6.1.1` — Medium
A.4 · `e6807f67-0d3c-4b6a-a3df-6da987147b72`

> These include the DssBlow2 contract for adding Dai and USDS to the Surplus Buffer, and the Pause Proxy contract for non-stablecoins.

**Issue.** This parent document classifies the Pause Proxy as the destination for non-stablecoins only, but its own subdocument A.4.6.1.1.1.2 (Transfer Of Other Stablecoins) directs stablecoins other than Dai or USDS to be 'sent to the Pause Proxy contract without conversion', so the stated taxonomy contradicts the rule beneath it.

**Suggested.** Say the Pause Proxy receives non-stablecoins and any stablecoin other than Dai or USDS that is not converted, rather than 'for non-stablecoins'.

### `A.5.2.1.3.1` — Medium
A.5 · `65625a56-0d3e-45b3-958d-0517fd861bd2`

> The Accessibility communication channel budget is: - 0 USDS per month, implemented with DssVest. It is a monthly recurring budget.

**Issue.** The budget funding this Section is set to 0 USDS per month, which cannot fund the obligation in A.5.2.1.1 that 'Sky must support the accessibility of the Sky Ecosystem by paying Ecosystem Actors to maintain accounts and channels on external platforms', and a DssVest stream of zero per month is not a payable stream.

**Suggested.** State the real recurring amount, or mark the budget as discontinued/unfunded and reconcile the 'must pay Ecosystem Actors' obligation in A.5.2.1.1 — unclear, needs author.

### `A.6.1.1.1.2.6.1.3.1.2.1.3.2.6` — Medium
A.6.1.1.1 · `5fb6e805-a394-4cfd-a788-bdb9bb4ff1c9`

> The operator must call the `withdraw` function to withdraw a required amount of `underlying` asset from Aave `pool` address and receive the corresponding `aTokens`.

**Issue.** Aave withdrawal burns aTokens and returns underlying; the sibling docs say the ALM Proxy must already hold sufficient aTokens (A...3.2.2) and that the decoded return is 'the amount of underlying assets that were successfully withdrawn' (A...3.2.6.3), and the deposit doc (A...3.1.7) is the one where aTokens are received.

**Suggested.** Should read '...withdraw a required amount of `underlying` asset from the Aave `pool`, burning the corresponding `aTokens`.'

### `A.6.1.1.1.3.1.3.2` — Medium
A.6.1.1.1 · `7fcbb9da-7559-4a18-ab68-f0840a3fe921`

> SPK holders may assign ("delegate") the full voting power of their wallet to an Active Delegate at any time (see [A.6.1.1.1.3.1.3.8 - Registry of Delegates](f49a1e26-f774-4fbd-b7f8-156639e077f2)).

**Issue.** "at any time" is contradicted by its own subdocuments: A.6.1.1.1.3.1.3.2.2 (99c40e7d) states voting power "including delegations" cannot be altered for the duration of an active proposal, and A.6.1.1.1.3.1.3.2.3 (375d4774) permits revoking or moving a delegation only "whenever no proposal is live".

**Suggested.** Qualify the parent rule (e.g. "at any time, effective from the next snapshot block") or align the subdocuments with it.

### `A.6.1.1.1.3.1.3.3.3` — Medium
A.6.1.1.1 · `46e9d0bb-e251-4f07-8327-804456f2e68a`

> The Delegate must cast a vote (For / Against) on 100% of governance proposals within the designated voting window

**Issue.** A mandatory 100% For/Against participation rate cannot coexist with A.6.1.1.1.3.1.3.5.2 (ca90a844), which sets the compliance floor at a voting percentage of 85%, nor with A.6.1.1.1.3.1.3.3.4 (16eb44b8), which permits Abstain for disclosed conflicts.

**Suggested.** unclear - needs author: state the duty at the same level as enforcement (e.g. ">= 85%, excluding disclosed-conflict abstentions") or raise the non-performance threshold to 100%.

### `A.6.1.1.1.3.2.1.1.1.3` — Medium
A.6.1.1.1 · `9006fd8d-bd13-48fc-bf2f-04f47579b3b0`

> All markets except Dai use this IRM. The IRM for Dai is independent of utilization and is defined as a spread over the Sky Savings Rate set forth in [A.3.1.2.2 - Sky Savings Rate](2674cccb-d779-4868-b83f-8cb86648c88a).

**Issue.** Contradicted by A.6.1.1.1.3.2.1.1.2.1.2 - Dai Risk Parameters (7d8ed55b), which gives Dai an Optimal Utilization of 80%, Slope 1 of SSR + 1.25% and Slope 2 of 15%; a rate that differs between optimal and 100% utilization is by definition utilization-dependent.

**Suggested.** unclear - needs author: either Dai's Optimal Utilization/Slope 2 entries are stale, or the claim that Dai's IRM is utilization-independent is wrong.

### `A.6.1.1.1.3.2.1.1.3.2.6` — Medium
A.6.1.1.1 · `07f1853e-ec34-44ae-b137-708a81cd3195`

> - Supply cap     - `gap`: 150 million USDC     - `ttl`: 12 hours     - `max`: 0 (no cap)

**Issue.** "0 (no cap)" makes 0 mean unlimited, contradicting A.6.1.1.1.3.2.1.1.3.1.3 (35323a90), which defines `max` as the maximum the cap can be increased to, and contradicting the sibling sDai entry (21bdfe50) where `max`: 0 sDAI means zero because sDai is not borrowable; WETH writes unlimited as "Unlimited".

**Suggested.** Write "Unlimited" (as the WETH entry does) rather than 0 for an uncapped max, so the same value does not carry two opposite meanings in one sibling set.

### `A.6.1.1.2.2.2.2.2.1.2.1.4` — Medium
A.6.1.1.2 · `f6dd56ae-ee72-4109-be99-eaf69c92c3be`

> The cut-off time for submitting the proposal in a Forum post is Wednesday 16:00 UTC. ... Proposals that do not require Core Council Risk Advisor approval may instead follow the later end-of-Friday submission deadline.

**Issue.** The same document states the forum-post submission cut-off flatly as Wednesday 16:00 UTC (with post-cut-off inclusion left to Operational Facilitator discretion) and then gives a different, later end-of-Friday deadline for a subset of proposals, so two conflicting deadlines govern the same act.

**Suggested.** unclear — needs author: either state Wednesday 16:00 UTC as the deadline only for risk-increasing proposals, or drop the end-of-Friday sentence.

### `A.6.1.1.2.2.3.2.2.1.2.1.3` — Medium
A.6.1.1.2 · `75305e17-8f4b-46cc-8bb5-39fd3680a8e0`

> Operational GovOps reviews Grove’s calculation of the rebate before executing a return of surplus to token holders. In the event of any issues, Operational GovOps cannot execute the distribution.

**Issue.** This Upkeep Rebate routine protocol describes the rebate as being paid out via a 'return of surplus to token holders' executed by Operational GovOps, but the sibling document A.6.1.1.2.2.3.2.2.1.2.1.2 (de9ff4be-acd3-4d10-a66a-4f18d81d73c1) states the rebate is realized by Grove deducting it from the Ecosystem Upkeep fees it pays — there is no distribution for Operational GovOps to execute or withhold.

**Suggested.** Describe the review as gating the deduction Grove applies to its Ecosystem Upkeep fee payment, not a surplus distribution to token holders

### `A.6.1.1.2.2.6.1.3.1.12.3.2.4.3` — Medium
A.6.1.1.2 · `d2527702-e69e-484e-9e39-3244c5836ceb`

> - AUSD: `maxAmount`: 5,000,000 AUSD, `slope`: 5,000,000 AUSD per day - USDC: `maxAmount`: 5,000,000 USDC, `slope`: 5,000,000 USDC per day - `maxSlippage`: 0.1%

**Issue.** The swap RateLimitIDs named here (0x6e850dcb...a0da USDC, 0x7dd93dac...8402 AUSD) are byte-identical to the ones the Uniswap v3 AUSD/USDC Swaps Instance lists (A.6.1.1.2.2.6.1.3.1.12.1.2.4.3, uuid e21c0b53-fc2a-46d1-b820-f9a5471c7efb), yet that document states a slope of 100,000,000 per day against this document's 5,000,000 per day for the same keys.

**Suggested.** unclear — needs author: reconcile the two stated slopes for the shared swap rate-limit keys

### `A.6.1.1.2.3.1.4.2` — Medium
A.6.1.1.2 · `b742c40b-2185-4468-8d86-6825f2cc90ae`

> GROVE holders may assign (“delegate”) the full voting power of their wallet to an Active Delegate at any time

**Issue.** 'at any time' contradicts its own subdocuments: A.6.1.1.2.3.1.4.2.2 says voting power including delegations cannot be altered for the duration of an active proposal, and A.6.1.1.2.3.1.4.2.3 says delegation may be moved only 'whenever no proposal is live'.

**Suggested.** Should read that holders may delegate at any time when no proposal is live, with changes taking effect at the next snapshot-block.

### `A.6.1.1.3.2.3.2.2.1.2.1.3` — Medium
A.6.1.1.3 · `77ad2a49-8fa6-499b-bd26-b9fdef57fded`

> Operational GovOps reviews Keel's calculation of the rebate before executing a return of surplus to token holders. In the event of any issues, Operational GovOps cannot execute the distribution. If Operational GovOps does not execute the distribution, Operational GovOps must post an explanation...

**Issue.** This Upkeep Rebate routine step conditions the rebate on 'executing a return of surplus to token holders' / a 'distribution', but the immediately preceding step in the same protocol (A.6.1.1.3.2.3.2.2.1.2.1.2, 20ccbfff-9058-47e5-a2d5-893d5bf783b6) states the rebate is realised by Keel deducting it from the Ecosystem Upkeep fees it pays — there is no distribution to withhold in this primitive.

**Suggested.** Describe the review as gating the deduction of the rebate from the Ecosystem Upkeep fee payment, not a surplus distribution to token holders — or state which distribution is meant; needs author.

### `A.6.1.1.3.2.6.1.2.2.1.1.2.1.2.3.2.1` — Medium
A.6.1.1.3 · `37c09b7c-6aa0-4c3c-861e-984de4e3ba4d`

> call the `withdrawERC4626` function ... providing the vault token address and the amount of the underlying asset to withdraw. The operation will only succeed if the ALM Proxy holds at least the amount of the underlying asset specified for withdrawal; otherwise, the transaction will revert.

**Issue.** A withdrawal from a vault cannot require the ALM Proxy to already hold the underlying amount it is withdrawing; the sibling redeem doc (a6474ee7) correctly states the precondition is holding enough vault SHARES, so this sentence is a copy-paste of the deposit precondition.

**Suggested.** Should read 'only succeed if the ALM Proxy holds at least the number of vault shares needed to cover the specified withdrawal amount'.

### `A.6.1.1.3.2.6.1.2.2.2.3.2.2` — Medium
A.6.1.1.3 · `2ed41eef-989b-4253-8de7-5e368da0242a`

> Reallocation Freeze ... A complete freeze prevents any movement of funds within the Controller until the Default Admin Role subsequently lifts this status. Integrations, Reserves and Permissions cannot be configured during this period.

**Issue.** The Reallocation Freeze is described as a complete freeze with exactly the same scope as the sibling Full Freeze (4f8c8aa3: 'complete freeze ... Integrations, Reserves nor Permissions cannot be managed ... funds cannot be moved'), so the two documented freeze levels are indistinguishable despite being presented as different options (and their enum values ControllerStatus::PushPullFrozen / ::Frozen look swapped relative to the names).

**Suggested.** Reallocation Freeze should describe only the narrower scope it names (block reallocation/fund movement while leaving other Controller actions available), and the status enum values should be checked for a swap.

### `A.6.1.1.3.3.2` — Medium
A.6.1.1.3 · `41ad175e-48c8-4caf-8cb7-638f90ff0ad6`

> In the short term prior to Keel's implementation of the Allocation System Primitive, Keel may invest idle funds in low-risk decentralized finance opportunities, including providing liquidity to established lending protocols on Solana.

**Issue.** The transitionary framing 'prior to Keel's implementation of the Allocation System Primitive' is contradicted within the same artifact: A.6.1.1.3.2.6.1.3 already lists nine Active Instances of the Allocation System Primitive, all of them lending deployments on Solana (Kamino USDS/USDC/USDT/USDG/PYUSD, Drift USDS/USDC/USDT/PYUSD) with live rate limits.

**Suggested.** Either retire this transitionary clause or restate it to cover only funds outside the now-active Allocation System Primitive Instances.

### `A.6.1.1.4.2.1.3.1.4` — Medium
A.6.1.1.4 · `09e544ef-8565-49d2-8dd6-e1b0aa53cb21`

> Because the Executor Transformation Primitive is deployed solely for the one-time transformation of the Agent, no further Instances of the Primitive can be Invoked.

**Issue.** This boilerplate presupposes the Primitive has already been deployed once, but Skybase's Executor Transformation Primitive has Global Activation Status `Inactive` (A.6.1.1.4.2.1.3.1.1) with no Instance in either its Active or Completed containers — so 'no further Instances' would mean zero Instances can ever exist; every other Primitive using this sentence (Agent Creation, Prime Transformation, Agent Token, Root Edit) is `Completed`/`Active` with an Instance recorded.

**Suggested.** Use the standard in-progress-Directory wording for an un-Invoked Primitive, or state that the Primitive is inapplicable because Skybase is a Prime Agent (A.6.1.1.4.2.1.2.3.1.1.1).

### `A.6.1.1.4.2.1.4.2.1.1.6` — Medium
A.6.1.1.4 · `f56670f9-5a43-4b47-b94a-99026f8d87c0`

> Token emissions beyond the Genesis Supply are permanently disabled; this cannot be reverted by Skybase Governance. Sky Governance retains the ability to revert where Skybase is in violation of Risk Capital requirements and emissions are required by the Risk Framework.

**Issue.** Emissions are declared 'permanently disabled' and then, in the next sentence, revertible by Sky Governance — a rule and its stated exception that cannot both hold as written.

**Suggested.** State that emissions are disabled and may only be re-enabled by Sky Governance under the Risk Framework, dropping 'permanently'.

### `A.6.1.1.4.2.3.2.2.1.2.1.3` — Medium
A.6.1.1.4 · `911e4409-146c-49e6-9f5c-5abdc58d97d3`

> Operational GovOps reviews Skybase's calculation of the rebate before executing a return of surplus to token holders. In the event of any issues, Operational GovOps cannot execute the distribution.

**Issue.** The immediately preceding document in the same Instance (A.6.1.1.4.2.3.2.2.1.2.1.2) specifies that the rebate is realised by deducting it from the Ecosystem Upkeep fees Skybase pays, so there is no 'return of surplus to token holders' and no 'distribution' for Operational GovOps to withhold — the two documents describe incompatible mechanisms for the same rebate.

**Suggested.** Describe the GovOps control as withholding/blocking the fee deduction, or reconcile with whichever mechanism is intended — unclear, needs author.

### `A.6.1.1.5.2.2.2.2.1.2.1.1.1` — Medium
A.6.1.1.5 · `e0020160-9ee8-4f35-90f1-ba375d625689`

> The post must include cryptographic proof that the author controls an account holding the required percentage of the total OBEX token supply specified in [A.6.1.1.5.2.2.2.2.1.2.1.1 - Root Edit Proposal Submission]

**Issue.** The referenced document sets the submission threshold at 1% of the CIRCULATING token supply, but this transitionary measure requires proof against the TOTAL OBEX supply; the two denominators differ (Genesis Supply is 10 billion OBEX), so the same threshold yields two different amounts.

**Suggested.** Say 'the required percentage of the circulating OBEX token supply' to match A.6.1.1.5.2.2.2.2.1.2.1.1.

### `A.6.1.1.5.2.3.2.2.1.2.1.3` — Medium
A.6.1.1.5 · `a8afed5e-3721-40a3-847c-3589a5dfce95`

> Operational GovOps reviews Obex's calculation of the rebate before executing a return of surplus to token holders. In the event of any issues, Operational GovOps cannot execute the distribution.

**Issue.** The immediately preceding step of the same Routine Protocol (A.6.1.1.5.2.3.2.2.1.2.1.2) states the rebate is realised by Obex deducting it from the Ecosystem Upkeep fees it pays, so there is no 'return of surplus to token holders' / 'distribution' for Operational GovOps to withhold; the two documents describe incompatible mechanisms for the same rebate.

**Suggested.** unclear — needs author: either describe the control as Operational GovOps withholding approval of the fee deduction, or define the surplus-distribution mechanism this step assumes.

### `A.6.1.1.5.2.6.1.3.1.1.1.2.3` — Medium
A.6.1.1.5 · `d2d46842-e9dd-4f88-bfa5-5e947381f70b`

> The specific `RateLimitID`(s) for this conduit's inflow and outflow will be specified in a future iteration of the Obex Artifact.

**Issue.** The RateLimitIDs document declares the inflow/outflow IDs unspecified, but its two immediate children (A.6.1.1.5.2.6.1.3.1.1.1.2.3.1 and .2.3.2) already state concrete 32-byte RateLimitIDs.

**Suggested.** Replace the placeholder sentence with the standard container wording (e.g. 'The RateLimitIDs for this conduit's inflow and outflow are defined in the documents herein.').

### `A.6.1.1.7.2.2.2.2.1.2.1.1.1` — Medium
A.6.1.1.7 · `caafe932-8fa7-4ee6-ba0b-dd49bcef1ee1`

> The post must include cryptographic proof that the author controls an account holding the required percentage of the total OSERO token supply specified in [A.6.1.1.7.2.2.2.2.1.2.1.1 - Root Edit Proposal Submission](70c91853-b74b-4c6b-befb-8446f00c...

**Issue.** This transitionary measure states the proof is against the TOTAL OSERO supply and cites A.6.1.1.7.2.2.2.2.1.2.1.1 (70c91853) as the source, but that document sets the threshold at '1% of the circulating token supply' — the two supply bases differ, so the same 1% threshold resolves to different token amounts under each document.

**Suggested.** Use 'circulating token supply' here to match the cited Root Edit Proposal Submission document (or fix the base in whichever document is wrong).

### `A.6.1.1.8.2.3.2.2.1.2.1.3` — Medium
A.6.1.1.8 · `47d2823b-2e93-4a7e-b181-6c232d7429ed`

> Operational GovOps reviews Launch Agent 7's calculation of the rebate before executing a return of surplus to token holders. In the event of any issues, Operational GovOps cannot execute the distribution.

**Issue.** This Upkeep Rebate routine step conditions on withholding a 'distribution'/'return of surplus to token holders', but the same Instance's own Parameters (A.6.1.1.8.2.3.2.2.1.1) and preceding step (A.6.1.1.8.2.3.2.2.1.2.1.2, 'Launch Agent 7 deducts the rebate from the fees it pays') define the rebate purely as a deduction from Ecosystem Upkeep fees — no distribution to token holders exists in this Primitive for GovOps to withhold, so the stated enforcement mechanism cannot operate.

**Suggested.** Restate the enforcement in terms of the fee payment this Primitive actually governs (e.g. Operational GovOps cannot approve/execute the reduced Ecosystem Upkeep fee payment), or cross-reference the Primitive that defines the surplus distribution being gated.


## Structural (43)

### `A.1.10.2.4.10.6` — High
A.1 · `959dea0e-219f-4caa-8101-09bd690ce051`

> the Spell Crafter should instead use `make archive-Spell date="YYYY-MM-DD"`, where "YYYY-MM-DD"

**Issue.** The sentence is cut off mid-clause: it opens a definition of what YYYY-MM-DD must be set to and never completes it, so the rule for the non-matching-date case is unstated.

**Suggested.** ... where "YYYY-MM-DD" is the Target Date specified in the Executive Document.

### `A.1.2.2.2.1` — High
A.1 · `468d192b-83bc-45ab-896f-53e8ca307135`

> "Type Category": This Component must specify whether the Type is an Immutable Document, a Primary Document, a Supporting Document, or a Translation Document.

**Issue.** The enumerated set of legal Type Category values is wrong: A.1.2.2.1 defines the categories as Immutable, Primary, Supporting and Accessory, and A.1.2.2.2.23 (Translation) and A.1.2.2.2.24 (Archive) both actually declare Type Category 'Accessory Document' — a value this enumeration does not allow — while no document in the Atlas uses 'Translation Document' as a category.

**Suggested.** Replace 'or a Translation Document' with 'or an Accessory Document'.

### `A.1.2.2.2.3` — High
A.1 · `69dc9b57-ad4d-4d84-9775-cc5338c43820`

> The Scope Type is used for the six nonzero Immutable Documents of the first layer of the Atlas ... Scope Documents define the broad boundaries, requirements and objectives of each of the 5 Atlas Scopes

**Issue.** The same sentence pair says there are six Scope documents and then '5 Atlas Scopes'; the same document's Doc Identifier Rules say 'A.1 to A.6' (six) and A.0.1.1.13 says 'There are six Scopes' and lists six.

**Suggested.** Change '5 Atlas Scopes' to '6 Atlas Scopes'.

### `A.3.2.2.1.1.1.1.1.4` — High
A.3 · `152bc5d8-7642-424c-b5fc-9242479f705e`

> The fourth step is to calculate the Capital Requirement Without Buffers $K$.

**Issue.** The symbol K is already bound in the immediately preceding step: A.3.2.2.1.1.1.1.1.3.3 defines 'The Sensitivity Factor `K` ... It is set to `10`', used in the step-3 formula R = a(1-e^{-K x PD}) + ...; step 4 then redefines K as the Capital Requirement Without Buffers, and step 5 (A.3.2.2.1.1.1.1.1.5) multiplies that K by 1/CR x EAD x ECR, so a literal reading substitutes 10.

**Suggested.** Rename one of the two — e.g. keep K for the sensitivity factor and use K_req (or CRWB) for the Capital Requirement Without Buffers.

### `A.3.2.2.1.2.3.3.2.3` — High
A.3 · `3286915a-7d81-4eb4-a238-bc7ded8e2634`

> f_{2} = \dfrac{e_{\text{int}} + a \,\bigl(e_{\text{tot}} - e_{\text{int}}\bigr)}{s_{\text{liq}}}  Here $\alpha$ is equal to `0.1`.

**Issue.** Two contradictions in one line: the formula's coefficient is written $a$ but the note defines $\alpha$, and $\alpha$ is already defined in the same Instance Smart Contract CRR chain as the blend weight alpha = (r - 25)/(50 - 25) (A.3.2.2.1.2.3.1.2.5.2), which is a function of the Risk Rating and not the constant 0.1 — the reference implementation confirms these are two different quantities (a literal 0.1 in f2, and alpha = (rating-25)/(50-25) in the blend).

**Suggested.** Use a distinct symbol for the 0.1 coefficient in the F2 function (and make the formula and the note use the same symbol), leaving alpha for the medium-risk blend weight.

### `A.6.1.1.*.2.2.2.2.1.2.1.1` — High
A.6.1.1.* (all prime artifacts) · `(cross-artifact)`

> Spark/Grove rule: '1% of the total token supply' | Keel/Skybase/Obex/Pattern/Osero/Launch Agent 7 rule: '1% of the circulating token supply' — while ALL EIGHT transitionary measures say 'total ... token supply'

**Issue.** The Root Edit submission threshold is stated against TOTAL supply in Spark and Grove but against CIRCULATING supply in the other six prime artifacts, so the same '1%' bar means different things per prime. Consequently the transitionary measure contradicts its own rule in exactly those six. Only visible corpus-wide; no single chunk shows it.

**Suggested.** unclear - needs author

### `A.6.1.1.2.2.6.1.3.1.6.2` — High
A.6.1.1.2 · `f6501dc9-f8e9-4130-9390-a1d9f142fcc7`

> Ethereum Mainnet - Curve RLUSD/USDC Pool Instance Configuration Document ... The documents herein contain the Instance Configuration Document for the Curve RLUSD/USDC Pool Instance.

**Issue.** A.6.1.1.2.2.6.1.3.1.6.2 and its 21 subdocuments are byte-identical in title and body to A.6.1.1.2.2.6.1.3.1.6.1 — same Pool Address 0xD001aE433f254283FeCE51d4ACcE8c53263aa186, same Swap RateLimitID 0x8dcb7a35..., same 20 million / 100 million per day / 0.1% limits — so the Active Instances registry lists the identical Curve RLUSD/USDC Pool Instance twice, double-counting one on-chain rate-limit key as two Instances.

**Suggested.** Delete the duplicate entry, or differentiate it if two distinct Curve RLUSD/USDC instances are intended (distinct pool address and distinct RateLimitIDs).

### `A.6.1.1.3.2.6.1.2.2.2.1.3.2.1` — High
A.6.1.1.3 · `c75e8c0d-0b16-4808-a14c-dac919ef9269`

> The properties associated with a Reserve level rate limit can be read from the `Integration` account corresponding to a particular token

**Issue.** This document sits under 'Integration Level Rate Limits' (3bf06ac1) and reads the `Integration` account, but calls the value a Reserve level rate limit — the two rate-limit levels are defined as distinct in the adjacent doc f5b98691, so the term is used against its own definition (copy-paste from the Reserve-level doc 21590f17).

**Suggested.** Should read 'The properties associated with an Integration level rate limit can be read from the `Integration` account...'.

### `A.6.1.1.4.2.5.2.4.1.2.6` — High
A.6.1.1.4 · `45a70053-e0a3-4188-a40b-f6b64ffde9e6`

> The Data Submission Responsible Actor is The Data Submission Responsible Actor is.

**Issue.** The parameter value is a self-referential, truncated sentence that names no actor, so the Compound Integration Boost Instance has no defined Data Submission Responsible Actor, unlike its sibling Instances (Euler, Curve, Morpho) which all name 'Core Council Risk Advisor'.

**Suggested.** Should read 'The Data Submission Responsible Actor is Core Council Risk Advisor.' (or the actual intended actor)

### `A.1.10.2.4.9.2.3` — Medium
A.1 · `952d9bdc-1298-49b5-a52f-11ab480a82b7`

> ###### A.1.10.2.4.9.2.3 - A.1.9 -Spell Reviewer Direct Authoring Ban [Core]

**Issue.** The title carries a stray, stale doc number 'A.1.9 -' in front of the actual title, so the heading presents two different doc numbers for one document (its real number is A.1.10.2.4.9.2.3).

**Suggested.** A.1.10.2.4.9.2.3 - Spell Reviewer Direct Authoring Ban

### `A.1.2.2.2.28` — Medium
A.1 · `e896e0f2-2156-4647-8e0d-8001140ae980`

> Facilitator Scenario Documents must always be located as subdocuments of the Facilitator Scenario Directory Document, which in turn is nested under its parent Facilitator Action Tenet Document, e.g.: A.1.1-1.0.4.1.1.1.

**Issue.** The worked example contains a hyphenated segment 'A.1.1-1', which A.1.2.1.1 disallows (identifier segments are separated with dots) and which disagrees with A.1.2.2.2.29's example of the identical structure, given as A.1.1.0.4.1.1.1.

**Suggested.** Write the example as A.1.1.0.4.1.1.1, matching A.1.2.2.2.29.

### `A.1.6.3.0.3.1` — Medium
A.1 · `9446b896-f33f-4593-97e9-60db6c385afd`

> The element "delegated voting power" refers to the ability of SKY holders and Staking users to entrust their voting power to a Delegate Contract, allowing the Aligned Delegate controlling that contract to cast votes in the Sky Governance process on their behalf.

**Issue.** Defines the element as an ability held by SKY holders, which contradicts both the usage in its own Target Document A.1.6.3 ('Delegate Contracts are smart contracts that can receive delegated voting power' — an ability to entrust cannot be received) and the second annotation of the same element at A.1.6.4.1.3.3.0.3.1, which defines 'delegated Voting Power' as 'the cumulative SKY that has been delegated to an Aligned Delegate's Delegate Contract' — a quantity, and the meaning the Level 3 ranking rule depends on.

**Suggested.** Define the element once, as the quantity of voting power delegated to a Delegate Contract, and describe the act of entrusting separately.

### `A.2.11.1.3.4.1` — Medium
A.2 · `e525c938-7fd2-4e6e-9c01-86cf0783d728`

> Each Multisig entry in the Multisig Registry must contain the following information: - Multisig Name - Administrator Entity - Multisig Address

**Issue.** A.2.11.1.3.2.1.1.1.1 and A.2.11.1.3.2.1.1.1.2 require the Impact and Operational Classifications to be provided to Core GovOps 'as part of the Multisig registration process', A.2.11.1.3.2.1.1.8 routes those details to 'the information requirements outlined in A.2.11.1.3.4 - Multisig Registry', and A.2.11.1.3.3.1/A.2.11.1.3.3.1.1 require quarterly verification that the classification in the Registry is accurate - yet the Registry entry schema (and the Active Data table at A.2.11.1.3.4.2.0.6.1) has no classification field at all.

**Suggested.** Add Impact Classification and Operational Classification (and any other registered details) to the Multisig Registry entry requirements and to the Registered Multisigs table columns.

### `A.2.2.1.2.4.2.1.1` — Medium
A.2 · `04bbf091-b2a8-47e4-ad03-f3fd66e70279`

> These Primitives are deployed once, and thereafter their Global Status is `Completed` and cannot be altered.

**Issue.** `Completed` is defined in A.2.2.1.3.2.3 as a Primitive *Instance* Status value, and A.2.2.1.3.1 expressly states that instance Status 'is independent of the Primitive's Global Activation Status'; Global Activation Status takes only Active/Inactive (A.2.2.1.2.2). Applying `Completed` to Global Status uses a defined term against its own definition.

**Suggested.** Should say the Primitive's *Instance* Status is `Completed` while its Global Activation Status remains Active (and cannot be deactivated).

### `A.2.2.9.2.2.3.6.4.1.2` — Medium
A.2 · `1b03bc85-a7f4-4cc5-be41-d13a16b8c379`

> - `Reward Code`         - New value: set to the Reward Code from the approved Proposal     - `Tracking Methodology`         - New value: set to the tracking methodology from the approved Proposal

**Issue.** This Integration Boost output requires copying a 'Reward Code' and 'Tracking Methodology' out of the approved Proposal, but the Integration Boost Proposal defines neither: its Initial Planning Document fields (A.2.2.9.2.2.3.1.3) and the ratified Instance Configuration parameters (A.2.2.9.2.2.3.6.3) list only Integration Partner Name/Reward Address/Chain, Cadence, Data Submission Format, Data Submission Responsible Actor, Savings Rate Adjustment Strategy and Custom Instance Parameters, and the Integration Boost onboarding update (A.2.2.9.2.2.3.1.4.1.1) records only the Integrator Name.

**Suggested.** Drop the Reward Code / Tracking Methodology fields here (they belong to the Distribution Reward version, A.2.2.9.1.2.3.6.4.1.2), or state where an Integration-Boost-only Integrator's Reward Code comes from.

### `A.2.7.1.1.1.1.4.0.6.1` — Medium
A.2 · `b71564fd-22e0-4c69-99d1-5b23fc1fa329`

> | Keel | Prime Agent | N/A | N/A |

**Issue.** The registry row for Keel gives neither an entity handle nor any Authorized Representative, so the registration authorises no forum account at all; A.2.7.1.1.1.1.1 permits 'N/A' for the handle only where the entity 'rely solely on Authorized Representatives', and A.2.7.1.1.1.1.3 says posts from unregistered accounts may be disregarded.

**Suggested.** Supply Keel's entity handle or at least one Authorized Representative, or remove the row until one exists

### `A.3.2.2.1.1.1.1.1.3.1` — Medium
A.3 · `68c5da4f-9c4e-4206-a582-99be9833481f`

> The Lower Bound $a$ is an estimate of the correlation between assets during "calm" periods. It is set of `0.13`.

**Issue.** The symbol $a$ is already defined in the same five-step procedure as the Leverage Adjusted Drift To Risk Ratio (A.3.2.2.1.1.1.1.1.1.1), which appears as the exponent -2a in the Probability Of Default formula; binding a to the constant 0.13 in step 3 collides with that definition.

**Suggested.** Give the correlation lower bound its own symbol (e.g. R_min / a_R) distinct from the drift-to-risk ratio a.

### `A.3.2.2.1.2.2.1` — Medium
A.3 · `b824c6ec-940b-4921-89f0-aca89b54e86a`

> The Smart Contract Risk Rating Cap $\text{CAP}$ is a temporary cap on the Smart Contract Risk Rating. The value of the $CAP$ is `30`.

**Issue.** SCRR = min[CAP, ...] with CAP = 30 means the Risk Rating can never exceed 30, so the High Risk (rating > 50, A.3.2.2.1.2.3.1.3) and Extreme Risk (rating > 75, A.3.2.2.1.2.3.1.4) categories — and the F2-only methodology and the automatic 100% CRR they define — are unreachable; the same holds for the Administrative Risk Rating, whose CAP is also 30 (A.3.2.2.1.3.1.1) even though Starting Rates of 50 and 100 are defined.

**Suggested.** unclear — needs author: either raise/remove the cap, or state that the High/Extreme methodologies are dormant while the temporary cap is in force.

### `A.3.2.2.1.2.3.1.2.5.1` — Medium
A.3 · `303c0d7f-42a7-4b9e-8afd-26e4d54e2f56`

> The constant factor $b$ is set to `0.15`.

**Issue.** The symbol $b$ is already bound inside the same Instance Smart Contract CRR calculation as the Piecewise Function's medium risk parameter, set to `0.25` (A.3.2.2.1.2.3.3.1.2), and that 0.25 is load-bearing (the piecewise is continuous only because b = 0.25 and b + c = 1); binding b to 0.15 in the medium-risk blend formula x = b x alpha x f_2 + (1 - alpha) x f_1 gives one symbol two values in one calculation chain.

**Suggested.** Rename the blend constant (e.g. beta) so it is distinct from the piecewise function's b = 0.25.

### `A.3.4.3.3.1` — Medium
A.3 · `7b902bb1-68b4-477d-a575-29aaa02e9e7b`

> Cash income over the reporting period. Any income over $20,000 in value should be broken out as its own line item, and an explanation provided for any non-recurring or non-ordinary expenses.

**Issue.** The income requirement ends by requiring an explanation for non-recurring or non-ordinary *expenses*, duplicating the following bullet; as written no explanation is ever required for non-recurring or non-ordinary income.

**Suggested.** '...and an explanation provided for any non-recurring or non-ordinary income.'

### `A.3.7.1.1.4` — Medium
A.3 · `a38e05bf-0820-4916-a71c-cff4f54e45df`

> The Native Vault Engine collateral types of ETH, STETH, WBTC will specifically use the Chronicle v3 oracle solution, until at least January 1st 2026.

**Issue.** This classifies WBTC as a Native Vault Engine collateral type, but A.3.7.1.1.3.2 (f6762223-29f3-46c1-8fa4-a5c27636772d) states WBTC-A/B/C 'are otherwise not considered Native Vault Engine collateral'; it also names STETH, which is not among the vault types defined in A.3.7.1.1.1 (those are WSTETH-A and WSTETH-B).

**Suggested.** Name the actual vault collateral types (ETH, WSTETH) and state the WBTC oracle requirement separately, consistent with A.3.7.1.1.3.2.

### `A.4.4.1.3.8.6.2.2.3.1` — Medium
A.4 · `21c4b33d-8644-4c1c-88e2-65f1243abd56`

> In the short term while Utilization is above 100%, the `cap` must be set to 200,000,000 USDS.

**Issue.** Utilization is defined (A.4.4.1.3.2.1.4 / A.4.4.1.3.2.1.4.1.1.2) as borrowed divided by supplied in the stUSDS contract, and A.4.4.1.3.4 caps borrowing at the total USDS held in that contract, so Utilization can never exceed 100% — the condition is unsatisfiable and the rule can never apply.

**Suggested.** Probably 'while Utilization is at or near 100%' (or above the 90% Target Utilization) — needs author

### `A.4.4.1.3.8.6.2.2.4.1` — Medium
A.4 · `be4d269c-7064-4886-bdd5-8a8ff9d4abe2`

> In the short term while Utilization is above 100%, the `line` must be set to 200,000,000 USDS.

**Issue.** Same unsatisfiable condition as A.4.4.1.3.8.6.2.2.3.1: Utilization is borrowed/supplied and borrowing is capped at the stUSDS contract balance (A.4.4.1.3.4), so 'above 100%' can never occur and the short-term `line` rule is dead.

**Suggested.** Probably 'while Utilization is at or near 100%' (or above the 90% Target Utilization) — needs author

### `A.5.4.1.1` — Medium
A.5 · `58f85237-4d1d-424b-be03-6eea1e8a8d0d`

> reduce their infrastructure's exposure to locations identified in the following subdocuments as subject to either IP filtering ("limited filtering") or IP blocking ("full block").

**Issue.** The document asserts the subdocuments identify the locations for both categories, but only the Full Block branch does so (A.5.4.1.4.1 lists 14 locations); the parallel limited-filtering document A.5.4.1.3.2, also titled 'Flagged IPs', identifies no locations at all and instead delegates the choice to each frontend, so no limited-filtering location is ever identified.

**Suggested.** Either list the limited-filtering locations in A.5.4.1.3.2 or reword A.5.4.1.1 so that only full-block locations are stated as identified in the subdocuments.

### `A.6.1.1.1.2.1.1.3` — Medium
A.6.1.1.1 · `5eff8c9f-8499-41ff-9aed-2e31d9f5f139`

> A.6.1.1.1.2.1.1.3 - Completed Instances Directory [Core] ... The Instances of the Agent Creation Primitive with `Completed` Status are contained herein.

**Issue.** The title says 'Directory' but the body says the Instances themselves are contained herein, and the title duplicates the separate directory document A.6.1.1.1.2.1.1.1.3 (Completed Instances Directory, UUID 4620942e-...); every other primitive in this artifact names this slot 'Completed Instances' (e.g. A.6.1.1.1.2.1.2.3, A.6.1.1.1.2.1.3.3, A.6.1.1.1.2.1.4.3).

**Suggested.** Rename to 'Completed Instances'.

### `A.6.1.1.1.2.1.1.4` — Medium
A.6.1.1.1 · `1974618c-b054-41c3-a6aa-860ea7875d02`

> A.6.1.1.1.2.1.1.4 - In Progress Invocations Directory [Core]

**Issue.** Same slot in every other primitive is titled 'In Progress Invocations' (A.6.1.1.1.2.1.2.4, A.6.1.1.1.2.1.3.4, A.6.1.1.1.2.1.4.4); here it duplicates the title of the hub's directory document A.6.1.1.1.2.1.1.1.4 (UUID 5c48cc46-...), making the two documents indistinguishable by title.

**Suggested.** Rename to 'In Progress Invocations'.

### `A.6.1.1.1.2.6.1.2.2.1.2.2.2.2.3` — Medium
A.6.1.1.1 · `35cf8ecc-ce16-4498-81f5-d96073ec5724`

> ###### A.6.1.1.1.2.6.1.2.2.1.2.2.2.2.3 - Withdraw Aave ATokens ... The process for withdrawing Aave ATokens on destination blockchain through the `ForeignController` contract is the same as the one for withdrawing Aave ATokens on Ethereum Mainnet ...

**Issue.** This document repeats the immediately preceding sibling A.6.1.1.1.2.6.1.2.2.1.2.2.2.2.2 (5b090e5a-a2e7-4548-a1b4-53be86db6516) verbatim — same title, same body, same cross-reference target — so the enumerated Aave function list has a duplicated entry with no distinct content.

**Suggested.** Delete the duplicate, or replace it with the missing procedure it was meant to cover (the ForeignController sibling list elsewhere covers deposit/withdraw/redeem).

### `A.6.1.1.1.2.6.1.4.3` — Medium
A.6.1.1.1 · `4a98960f-dd05-4f2b-9e7c-66a489ee499a`

> The Ethereum Mainnet Instances of the Spark Liquidity Layer with `Completed` Status are stored herein and are organized by target protocol.

**Issue.** Two Ethereum Mainnet protocol groups with Completed status — A.6.1.1.1.2.6.1.4.1 Blackrock ('The Ethereum Mainnet Instances of the Blackrock Protocol with `Completed` Status are stored herein') and A.6.1.1.1.2.6.1.4.2 Centrifuge (same wording) — sit as siblings of this container rather than inside it, so the claim that the Ethereum Mainnet Completed instances are stored herein is false as written.

**Suggested.** Move the Blackrock and Centrifuge groups under A.6.1.1.1.2.6.1.4.3, or reword this document so it does not claim to hold all Ethereum Mainnet Completed instances.

### `A.6.1.1.1.3.1.3.3.4.1` — Medium
A.6.1.1.1 · `cfdf3c2d-6ede-49f0-8f2c-0cd91a5602bc`

> Conflicts must be disclosed to both the Spark Foundation before the voting window (see [A.6.1.1.1.2.2.2.2.1.2.1.3 - Root Edit Token Holder Vote](b60cfc4e-4cc5-4040-9610-f2113980831b)) for the proposal begins.

**Issue.** "both" announces two mandatory disclosure recipients but only one (the Spark Foundation) is named, so the second party a Delegate must disclose a conflict to is undefined.

**Suggested.** unclear - needs author: either name the second recipient (e.g. "to both the Spark Foundation and the Sky Forum") or drop "both".

### `A.6.1.1.2.2.1.1.3` — Medium
A.6.1.1.2 · `994395c0-c61d-4fc9-8167-00ee3134bd5a`

> ##### A.6.1.1.2.2.1.1.3 - Completed Instances Directory [Core] ... The Instances of the Agent Creation Primitive with `Completed` Status are contained herein.

**Issue.** This container document is titled '… Directory' although its own body says instances are 'contained herein', and it duplicates the title of the actual directory document A.6.1.1.2.2.1.1.1.3; every sibling primitive names the equivalent container 'Completed Instances' (A.6.1.1.2.2.1.2.3, .1.3.3, .1.4.3).

**Suggested.** Rename to 'A.6.1.1.2.2.1.1.3 - Completed Instances' (and likewise A.6.1.1.2.2.1.1.4 to 'In Progress Invocations').

### `A.6.1.1.3.2.1.1.3` — Medium
A.6.1.1.3 · `0b9ec93a-58c8-48cf-b88f-ebbbc3a4333b`

> A.6.1.1.3.2.1.1.3 - Completed Instances Directory [Core] ... The Instances of the Agent Creation Primitive with `Completed` Status are contained herein.

**Issue.** This container document is titled 'Completed Instances Directory' although its body says it holds the Instances themselves, duplicating the title of the hub's real directory at A.6.1.1.3.2.1.1.1.3; every sibling primitive names this slot 'Completed Instances' (e.g. A.6.1.1.3.2.1.2.3, A.6.1.1.3.2.1.4.3).

**Suggested.** Title should be 'Completed Instances' (the sibling A.6.1.1.3.2.1.1.4 has the same problem, titled 'In Progress Invocations Directory' instead of 'In Progress Invocations').

### `A.6.1.1.3.2.6.1.2.2.1.1.2.1.2.5.3` — Medium
A.6.1.1.3 · `030c5483-6126-40f7-b7ff-a99186ab105d`

> A.6.1.1.3.2.6.1.2.2.1.1.2.1.2.5 - PSM Functions ... define the swap operations performed by the Keel Liquidity Layer in the PSM. ... A.6.1.1.3.2.6.1.2.2.1.1.2.1.2.5.3 - Transfer Token Via LayerZero

**Issue.** A LayerZero cross-chain token transfer is filed as a child of 'PSM Functions' (which the parent defines as PSM swap operations only), while the adjacent 'Bridging Functions' section (66d40b48) is where it belongs — and that section's LayerZero entry (d239ba22) claims the process 'will be specified in a future iteration' even though transferTokenLayerZero is fully specified here.

**Suggested.** Move Transfer Token Via LayerZero under A.6.1.1.3.2.6.1.2.2.1.1.2.1.2.6 - Bridging Functions and drop the 'future iteration' placeholder there.

### `A.6.1.1.3.2.6.1.2.2.2.1.1` — Medium
A.6.1.1.3 · `6c7d3476-9e97-495d-a491-3194e7c061a3`

> The documents herein define roles (Admin, Relayer, ALM Controller and Freezer) and their responsibilities/permissions for managing the Keel Liquidity Layer.

**Issue.** Four roles are enumerated but only three are defined in the documents herein (Default Admin 0270b595, Relayer 2b42015c, Freezer 6f7becc7); no ALM Controller role document or ALM-Controller permission appears anywhere in the Solana branch.

**Suggested.** Either add the ALM Controller role document or drop it from the enumeration.

### `A.6.1.1.4.2.1.1.3` — Medium
A.6.1.1.4 · `87ad87f5-5441-4003-8029-b7ce10442119`

> ##### A.6.1.1.4.2.1.1.3 - Completed Instances Directory [Core]  <!-- UUID: 87ad87f5-5441-4003-8029-b7ce10442119 --> The Instances of the Agent Creation Primitive with `Completed` Status are contained herein.

**Issue.** This is the Instance container, not a Directory — its body says Instances 'are contained herein' — yet it carries the title of the hub Directory document A.6.1.1.4.2.1.1.1.3, duplicating that title inside the same Primitive; the three sibling Primitives all title this position 'Completed Instances' (A.6.1.1.4.2.1.2.3, A.6.1.1.4.2.1.3.3, A.6.1.1.4.2.1.4.3).

**Suggested.** Rename to 'Completed Instances'.

### `A.6.1.1.4.2.1.1.4` — Medium
A.6.1.1.4 · `58ddd7d7-28af-4ca3-ac6a-f5d2105f9e79`

> ##### A.6.1.1.4.2.1.1.4 - In Progress Invocations Directory [Core]  <!-- UUID: 58ddd7d7-28af-4ca3-ac6a-f5d2105f9e79 -->

**Issue.** Same defect as the sibling above: the Invocation container at this position is titled as the hub Directory document (duplicating A.6.1.1.4.2.1.1.1.4's title within the same Primitive), whereas A.6.1.1.4.2.1.2.4, A.6.1.1.4.2.1.3.4 and A.6.1.1.4.2.1.4.4 are all titled 'In Progress Invocations'.

**Suggested.** Rename to 'In Progress Invocations'.

### `A.6.1.1.5.2.1.1.3` — Medium
A.6.1.1.5 · `31bafd0d-b417-4759-88af-7589f9a32518`

> A.6.1.1.5.2.1.1.3 - Completed Instances Directory ... The Instances of the Agent Creation Primitive with `Completed` Status are contained herein.

**Issue.** Title says 'Directory' but the body describes the container that holds the Instances themselves; the actual Directory already exists at A.6.1.1.5.2.1.1.1.3 with the same title, and every other primitive names this node 'Completed Instances' (e.g. A.6.1.1.5.2.1.2.3, .3.3, .4.3).

**Suggested.** Rename to 'Completed Instances' to match the sibling primitives and to disambiguate from the hub Directory at A.6.1.1.5.2.1.1.1.3.

### `A.6.1.1.5.2.6.1.2.1.1.1.2.1` — Medium
A.6.1.1.5 · `5d99d731-c3ed-461c-a6ea-50ebd741b3d2`

> A.6.1.1.5.2.6.1.2.1.1.1.2.1 - Ethereum Mainnet ... The documents herein contain the ALM Contract Addresses for the Obex Liquidity Layer on the Ethereum Mainnet.

**Issue.** This chain container is left empty: the ALM contract documents that belong under it are numbered A.6.1.1.5.2.6.1.2.1.1.1.2.2 through .2.7, i.e. as its SIBLINGS under ALM Contracts, unlike the parallel Allocator section where Ethereum Mainnet (.1.1.1) correctly contains .1.1.1.1-.1.1.1.5.

**Suggested.** Renumber the ALM contract documents as A.6.1.1.5.2.6.1.2.1.1.1.2.1.1 ... .2.1.6 so they sit under the Ethereum Mainnet container.

### `A.6.1.1.6.2.1.1.3` — Medium
A.6.1.1.6 · `b57af67d-e709-41a7-986b-afdd90fd18d1`

> ##### A.6.1.1.6.2.1.1.3 - Completed Instances Directory [Core] ... The Instances of the Agent Creation Primitive with `Completed` Status are contained herein.

**Issue.** This document is titled 'Completed Instances Directory' but its body says it holds the Instances themselves, and a genuine 'Completed Instances Directory' already exists in the Hub at A.6.1.1.6.2.1.1.1.3; every sibling primitive (e.g. A.6.1.1.6.2.1.2.3, A.6.1.1.6.2.1.3.3) names this slot 'Completed Instances'.

**Suggested.** Rename the document to 'Completed Instances'.

### `A.6.1.1.6.2.1.1.4` — Medium
A.6.1.1.6 · `38aff44f-e8ef-4734-8e11-fb7894d024a5`

> ##### A.6.1.1.6.2.1.1.4 - In Progress Invocations Directory [Core]  <!-- UUID: 38aff44f-e8ef-4734-8e11-fb7894d024a5 -->

**Issue.** This slot duplicates the Hub's 'In Progress Invocations Directory' (A.6.1.1.6.2.1.1.1.4); in every sibling primitive the fourth child of the Primitive document is 'In Progress Invocations' (e.g. A.6.1.1.6.2.1.2.4, A.6.1.1.6.2.1.3.4, A.6.1.1.6.2.1.4.4), so the Agent Creation Primitive has no 'In Progress Invocations' container.

**Suggested.** Rename the document to 'In Progress Invocations'.

### `A.6.1.1.6.2.6.1.2.2.1.2.1.2.6.3` — Medium
A.6.1.1.6 · `901bf629-cee3-4296-afd6-d1e7779d15bb`

> ###### A.6.1.1.6.2.6.1.2.2.1.2.1.2.6.3 - Transfer Token Via LayerZero

**Issue.** A LayerZero OFT token transfer is numbered as a child of A.6.1.1.6.2.6.1.2.2.1.2.1.2.6 - PSM Functions (4ee9a639), whose own scope statement is 'the swap operations performed by the Pattern Liquidity Layer in the PSM'; the LayerZero transfer is neither a swap nor a PSM operation, so the child contradicts its parent's stated scope.

**Suggested.** Renumber the LayerZero transfer as a sibling of the PSM Functions group (e.g. A.6.1.1.6.2.6.1.2.2.1.2.1.2.7 - LayerZero Functions), or widen the parent's scope statement.

### `A.6.1.1.7.2.1.1.4` — Medium
A.6.1.1.7 · `ff4e7a8d-3832-40a3-b2b0-fec3831ed689`

> ##### A.6.1.1.7.2.1.1.4 - In Progress Invocations Directory

**Issue.** In the Primitive skeleton the '.4' slot directly under a Primitive is 'In Progress Invocations' (the '.1.4' slot under the Primitive Hub Document is the 'Directory'); every other Primitive in this Artifact follows that (e.g. A.6.1.1.7.2.1.2.4, A.6.1.1.7.2.1.3.4, A.6.1.1.7.2.1.4.4, A.6.1.1.7.2.2.1.4 are all 'In Progress Invocations'), so this node duplicates the title of its own sibling A.6.1.1.7.2.1.1.1.4 (383eb03a) and mislabels the slot.

**Suggested.** Retitle to 'A.6.1.1.7.2.1.1.4 - In Progress Invocations'.

### `A.6.1.1.8.2.1.1.1.3` — Medium
A.6.1.1.8 · `9378730b-3ec4-4b75-918d-1dc4163f4c45`

> ###### A.6.1.1.8.2.1.1.1.3 - Completed Instances [Core] This document contains a Directory of all Instances of the Agent Creation Primitive with Instance status of `Completed`.

**Issue.** Title says 'Completed Instances' but the body (and its child, a 'Single Instance Configuration Document Location' pointer) is the Directory; it is swapped with A.6.1.1.8.2.1.1.3, which is titled 'Completed Instances Directory' but contains the instances. Every sibling primitive in the same chunk (Prime Transformation, Executor Transformation, Agent Token, Executor Accord, Root Edit, Light Agent) uses the opposite, correct pairing.

**Suggested.** Rename to 'Completed Instances Directory' (and rename A.6.1.1.8.2.1.1.3 to 'Completed Instances').

### `A.6.1.1.8.2.1.1.3` — Medium
A.6.1.1.8 · `f661d4a1-a5ff-4cbd-8d57-82418669a279`

> ##### A.6.1.1.8.2.1.1.3 - Completed Instances Directory [Core] The Instances of the Agent Creation Primitive with `Completed` Status are contained herein.

**Issue.** Title says this is the Directory, but the body states the Instances themselves are contained herein and its child is the actual Single Instance Configuration Document — the title is swapped with the hub child A.6.1.1.8.2.1.1.1.3, contradicting the naming used by every other primitive in this Artifact.

**Suggested.** Rename to 'Completed Instances' (and rename A.6.1.1.8.2.1.1.1.3 to 'Completed Instances Directory').


## Broken cross-reference (30)

### `A.1.10.2.3.2.1.3.1` — High
A.1 · `d2a2b598-db4d-44b5-a23b-a7f62cadfa9d`

> The Reasoning URL for the "Input Action" should contain a link to the Atlas Edit Proposal Forum post specified in [A.1.10.2.3.2.1.2.1.2 - Technical Scope Forum Post](ef6d73e5-cdcb-48dd-873c-264c07af80bf)

**Issue.** The sentence describes the Atlas Edit Proposal forum post but links the Technical Scope Forum Post (ef6d73e5), which the same paragraph then separately assigns to the Derived Action's Reasoning URL, so both Reasoning URLs would point at the same document; the Atlas Edit Proposal is A.1.10.2.3.2.1.1.1.4 (0465a8ef).

**Suggested.** Link [A.1.10.2.3.2.1.1.1.4 - Atlas Edit Proposal](0465a8ef-0ec5-43b7-8b6f-bed778758364) for the Input Action's Reasoning URL

### `A.2.2.9.1.2.3.3.1.1.2` — High
A.2 · `94d06bae-9bc9-4e8f-a38d-4b879466873b`

> This process is triggered by the Document Update specified at [A.2.2.9.1.2.3.3.4.2.1 - Primitive Hub/In Progress Invocations Directory/Instance Name Update](b37c4266-2dd9-4cce-8b6b-cc35af2b94d9).

**Issue.** The Artifact Update Draft process (A.2.2.9.1.2.3.3) names its OWN required output (A.2.2.9.1.2.3.3.4.2.1) as its trigger, which is circular; the preceding step A.2.2.9.1.2.3.2.4.2.2 (6f457b50, status 'Proposal drafting in progress') explicitly states 'Triggers: A.2.2.9.1.2.3.3', and b37c4266 is separately declared as the trigger of the NEXT process A.2.2.9.1.2.3.4.

**Suggested.** Trigger should cite [A.2.2.9.1.2.3.2.4.2.2 - Primitive Hub Document/In Progress Invocations Directory/Instance Name Update](6f457b50-a98c-4516-9b37-932603a59627).

### `A.2.2.9.2.2.3.4.1.1.2` — High
A.2 · `555a08a4-e028-44bd-9ba2-91e4bbf61644`

> This process is triggered by the Document Update specified at [A.2.2.9.2.2.3.2.4.2.2 - Primitive Hub Document Update](09ddd2c5-3768-4538-b979-629e1b369299).

**Issue.** The Operational Facilitator Review process (A.2.2.9.2.2.3.4) cites the same trigger as the earlier Artifact Update Draft process (A.2.2.9.2.2.3.3.1.1.2 cites the identical 09ddd2c5, status 'Proposal drafting in progress'), so one document update would start two sequential processes at once, while the intervening output A.2.2.9.2.2.3.3.4.2.1 (e7fc7c2e, status 'Proposal Pending Facilitator Review') expressly states 'Triggers: A.2.2.9.2.2.3.4'.

**Suggested.** Trigger should cite [A.2.2.9.2.2.3.3.4.2.1 - Primitive Hub Document Update](e7fc7c2e-b6fc-4e0f-ae10-debb54124e8e).

### `A.2.4.1.2.2.1.1.2.3.2.1` — High
A.2 · `5e78fb21-1208-442f-b215-3babcd69fd69`

> the excess of (1) its Low Yield Actively Stabilizing Collateral (see [A.2.4.1.2.2.1.1.2.3.2 - Low Yield Actively Stabilizing Collateral Penalty](631e7c75-375f-4298-9d85-b17cb2eb019f)) as a percentage of its Collateral Portfolio

**Issue.** The definition of 'Low Yield Actively Stabilizing Collateral' is cited to the Penalty document (631e7c75), which only describes the penalty; the term is actually defined in its own document A.2.4.1.2.2.1.1.2.3.2.1.1 - Low Yield Actively Stabilizing Collateral (858b2ee0-89b8-4505-8324-f3cd315de40c) in the same chunk.

**Suggested.** Point the reference at A.2.4.1.2.2.1.1.2.3.2.1.1 - Low Yield Actively Stabilizing Collateral (858b2ee0-89b8-4505-8324-f3cd315de40c)

### `A.3.2.2.7.2.1.1.2` — High
A.3 · `cf1bcb59-c72a-4b17-ae4b-e80beb881f57`

> The financial penalties associated with High Severity Breaches and Low Severity Breaches are defined in [A.3.2.2.7.2.1.1.4 - Financial Penalties For Low Severity Breaches](...) and [A.3.2.2.7.2.1.1.5 - Financial Penalties For High Severity Breache...

**Issue.** The word 'respectively' pairs High Severity with the Low Severity penalties document and Low Severity with the High Severity penalties document - the two references are in reverse order.

**Suggested.** Either reorder the subjects ('The financial penalties associated with Low Severity Breaches and High Severity Breaches are defined in ... and ..., respectively') or swap the two links.

### `A.6.1.1.1.3.4.2.1.1` — High
A.6.1.1.1 · `f426cc6e-336a-43bf-825d-1f0c08d1795e`

> Spark will seek to maintain a Encumbrance Ratio not greater than the Target Risk Tolerance Ratio specified in [A.6.1.1.1.3.4.2.1.3 - Parameters](d65a06a6-1426-4af2-978c-cd4f7bac79b7).

**Issue.** The binding limit is named "Target Risk Tolerance Ratio", but the cited Parameters document (d65a06a6) specifies only "The current Target Encumbrance Ratio is 90%"; the same undefined term reappears as the divisor "Risk Tolerance Ratio" in the Evaluation Method (99d4b8da), which cites the Encumbrance Ratio doc.

**Suggested.** Use "Target Encumbrance Ratio" consistently in both places, or define Target Risk Tolerance Ratio somewhere.

### `A.6.1.1.1.3.5.3.2.3.2` — High
A.6.1.1.1 · `087dc001-1a44-4096-acd1-feeb109f7ec0`

> [A.6.1.1.1.3.5.3.2.2 - Rewards Rate Operational Process](6c7a4964-485f-4edf-a05f-61fa65c9871c)

**Issue.** link text title "Rewards Rate Operational Process" but target title is "Operational Process"

### `A.6.1.1.1.3.5.3.2.3.2` — High
A.6.1.1.1 · `087dc001-1a44-4096-acd1-feeb109f7ec0`

> [A.6.1.1.1.3.5.2.2.2 - Onchain Parameters](39a398d7-600e-472a-ac85-c789866fddfc)

**Issue.** link text title "Onchain Parameters" but target title is "Spark Savings USDT on Ethereum"

### `A.6.1.1.1.3.5.3.2.3.2` — High
A.6.1.1.1 · `087dc001-1a44-4096-acd1-feeb109f7ec0`

> [A.6.1.1.1.3.5.3.2.1 - Rewards Rate Definition](3a143911-80c9-4eb0-9aa3-5b3d3a8ca843)

**Issue.** link text title "Rewards Rate Definition" but target title is "Definition"

### `A.6.1.1.1.3.5.3.2.3.6` — High
A.6.1.1.1 · `ad064b08-8866-4c14-ad34-1275101032a5`

> [A.6.1.1.1.3.5.3.2.2 - Rewards Rate Operational Process](6c7a4964-485f-4edf-a05f-61fa65c9871c)

**Issue.** link text title "Rewards Rate Operational Process" but target title is "Operational Process"

### `A.6.1.1.1.3.5.3.2.3.6` — High
A.6.1.1.1 · `ad064b08-8866-4c14-ad34-1275101032a5`

> [A.6.1.1.1.3.5.2.2.6 - Onchain Parameters](398944f7-59c3-495c-900b-939358b76e68)

**Issue.** link text title "Onchain Parameters" but target title is "Spark Savings USDG on Robinhood Chain"

### `A.6.1.1.1.3.5.3.2.3.6` — High
A.6.1.1.1 · `ad064b08-8866-4c14-ad34-1275101032a5`

> [A.6.1.1.1.3.5.3.2.1 - Rewards Rate Definition](3a143911-80c9-4eb0-9aa3-5b3d3a8ca843)

**Issue.** link text title "Rewards Rate Definition" but target title is "Definition"

### `A.6.1.1.1.3.5.3.2.3.7` — High
A.6.1.1.1 · `2df1f51c-308f-4b29-90a7-7c01c35e891c`

> [A.6.1.1.1.3.5.3.2.2 - Rewards Rate Operational Process](6c7a4964-485f-4edf-a05f-61fa65c9871c)

**Issue.** link text title "Rewards Rate Operational Process" but target title is "Operational Process"

### `A.6.1.1.1.3.5.3.2.3.7` — High
A.6.1.1.1 · `2df1f51c-308f-4b29-90a7-7c01c35e891c`

> [A.6.1.1.1.3.5.2.2.7 - Onchain Parameters](5a2b0ec2-5358-4464-b6cb-0d39642a437d)

**Issue.** link text title "Onchain Parameters" but target title is "Spark Savings USDT on Arbitrum"

### `A.6.1.1.1.3.5.3.2.3.7` — High
A.6.1.1.1 · `2df1f51c-308f-4b29-90a7-7c01c35e891c`

> [A.6.1.1.1.3.5.3.2.1 - Rewards Rate Definition](3a143911-80c9-4eb0-9aa3-5b3d3a8ca843)

**Issue.** link text title "Rewards Rate Definition" but target title is "Definition"

### `A.6.1.1.1.3.5.3.2.3.8` — High
A.6.1.1.1 · `40f91471-6b4c-4058-8917-d3b6d2a87f38`

> [A.6.1.1.1.3.5.3.2.2 - Rewards Rate Operational Process](6c7a4964-485f-4edf-a05f-61fa65c9871c)

**Issue.** link text title "Rewards Rate Operational Process" but target title is "Operational Process"

### `A.6.1.1.1.3.5.3.2.3.8` — High
A.6.1.1.1 · `40f91471-6b4c-4058-8917-d3b6d2a87f38`

> [A.6.1.1.1.3.5.2.2.8 - Onchain Parameters](c6eb9203-a5af-4f9b-baaf-b70c4449d4a4)

**Issue.** link text title "Onchain Parameters" but target title is "Spark Savings USDT on X Layer"

### `A.6.1.1.1.3.5.3.2.3.8` — High
A.6.1.1.1 · `40f91471-6b4c-4058-8917-d3b6d2a87f38`

> [A.6.1.1.1.3.5.3.2.1 - Rewards Rate Definition](3a143911-80c9-4eb0-9aa3-5b3d3a8ca843)

**Issue.** link text title "Rewards Rate Definition" but target title is "Definition"

### `A.6.1.1.1.3.7.2.5.2` — High
A.6.1.1.1 · `a51aef25-bf7e-4467-9678-0b1ea59fb47e`

> as noted in section [A.6.1.1.1.3.7.2.2.5 - Unapproved Assets and Products](5163ebb9-a425-4df6-aba9-b483e8a482c1)

**Issue.** The link's doc_no is wrong: the target UUID 5163ebb9-… is 'A.6.1.1.1.3.7.2.2.6 - Unapproved Assets and Products', while A.6.1.1.1.3.7.2.2.5 is a different document ('Decentralized Exchange Protocols').

**Suggested.** Cite A.6.1.1.1.3.7.2.2.6 - Unapproved Assets and Products.

### `A.6.1.1.1.3.7.2.5.2` — High
A.6.1.1.1 · `a51aef25-bf7e-4467-9678-0b1ea59fb47e`

> [A.6.1.1.1.3.7.2.2.5 - Unapproved Assets and Products](5163ebb9-a425-4df6-aba9-b483e8a482c1)

**Issue.** link text says A.6.1.1.1.3.7.2.2.5 but target is A.6.1.1.1.3.7.2.2.6 "Unapproved Assets and Products"

### `A.1.10.2.4.11.1.6` — Medium
A.1 · `12ebd0d9-52dc-4d1f-8e1a-8bdc2a51b9b0`

> Executive Validator [(](https://vote.makerdao.com/executive/create)[https://vote.sky.money/executive/create](https://vote.sky.money/executive/create))

**Issue.** The validator link is split into two links pointing at two different hosts — a hidden stale vote.makerdao.com URL behind '(' and the vote.sky.money URL — whereas the parallel step A.1.10.2.4.8.5.3 gives only vote.sky.money.

**Suggested.** Executive Validator ([https://vote.sky.money/executive/create](https://vote.sky.money/executive/create)) — drop the vote.makerdao.com link.

### `A.1.5.5.0.4.2` — Low
A.1 · `56fd4055-b412-4058-a33a-57d4d1b54181`

> [A.1.5.5.0.4.1 - Operationally Active - Whether An Entity Is "Operationally Active" In A Role Is Determined Purely On A Formal Basis](38c70e00-b5b8-4d1b-9f57-809ef284cb25)

**Issue.** link text title "Operationally Active - Whether An Entity Is "Operationally Active" In A Role Is Determined Purely On A Formal Basis" but target title is "Operationally Active - Whether An Entity Is “Operationally Active" In A Role Is Determined Purely On A Formal Basis"

### `A.2.4.1.2.2.1.1.2.3.2.1.1` — Medium
A.2 · `858b2ee0-89b8-4505-8324-f3cd315de40c`

> Low Yield Actively Stabilizing Collateral is Actively Stabilizing Collateral (see [A.3.3.2.2.1.1 - Resting Actively Stabilizing Collateral](0e17b35a-c830-4695-b63c-5ef58b249d3f)) that earns less than the Agent Credit Line Borrow Rate.

**Issue.** The sentence defines a subset of 'Actively Stabilizing Collateral' but cites a document titled 'Resting Actively Stabilizing Collateral', a narrower and differently-named concept, so the definition silently restricts itself to resting collateral (or cites the wrong document).

**Suggested.** Cite the document that defines Actively Stabilizing Collateral generally, or say 'Resting Actively Stabilizing Collateral' in the sentence if that is what is meant

### `A.3.2.2.1.1.1.5.2.2.1.2` — Medium
A.3 · `9868d6c9-17ec-44da-8898-b59a1ae579e0`

> For the following Exposure Types, Exposure At Default is equal to book value multiplied by the Credit Conversion Factor (see `CRE51`): - Off-Balance Sheet Items

**Issue.** Within the same chunk, Off-Balance Sheet Items are assigned to `CRE20.94-101` (A.3.2.2.1.1.1.5.2.1) and the off-balance-sheet rows of the risk-weight table all cite CRE20.95-20.100 (the CCF paragraphs), while `CRE50-52` is the chunk's own citation for Derivatives/SFTs — so citing CRE51 for the off-balance-sheet Credit Conversion Factor contradicts the chunk's own mapping.

**Suggested.** Cite `CRE20.94-101` (the off-balance-sheet credit conversion factor paragraphs) instead of `CRE51`.

### `A.3.3.1.3` — Medium
A.3 · `810270db-2436-411b-94e4-afbc66492531`

> must maintain, with respect to its portion of same, the percentage of Actively Stabilizing Collateral and Demand Absorption Buffer specified in [A.3.3.2.2 - Minimum Actively Stabilizing Collateral](475fe222-9e4a-4e9d-9be6-a7a424ce02f8).

**Issue.** The cited document sets only the Actively Stabilizing Collateral minimum (5%); the Demand Absorption Buffer percentage is set in a different document, A.3.3.2.3 - Minimum Demand Absorption Buffer (1e129119-a2ce-4978-b235-c50f2a1c5e2e), so half of the sentence's requirement is not in the reference it points at.

**Suggested.** Cite both A.3.3.2.2 (ASC) and A.3.3.2.3 (DAB).

### `A.6.1.1.1.2.6.1.1.2.1.6.4` — Medium
A.6.1.1.1 · `3dabe1bb-244d-4546-993a-449b988d9199`

> A.6.1.1.1.2.6.1.1.2.1.6.4 - Ethereum Mainnet - Spark Savings v2 PYUSD Instance Configuration Document Location ... located at [A.6.1.1.1.2.6.1.3.1.6.4 - Ethereum Mainnet - Spark Savings v2 spPYUSD Instance Configuration Document]

**Issue.** The document's own title names the instance asset PYUSD while the link text for the document it points at names spPYUSD; PYUSD and spPYUSD are different tokens, and every sibling entry (ETH, USDC, USDT) names the underlying asset consistently on both sides.

**Suggested.** Make both sides use the same token name (most likely 'PYUSD', matching the sibling entries).

### `A.6.1.1.2.2.6.1.1.2.3.1.2` — Medium
A.6.1.1.2 · `363c5d9f-9486-4091-8ed6-f909f66ead65`

> This Instance’s associated Instance Configuration Document is located at [A.6.1.1.2.2.6.1.3.3.2 - Base - Steakhouse Prime Instant USDC Morpho Vault V2 Instance Configuration Document](d47ec9c3-b308-453a-989a-7396504f6a99).

**Issue.** The cited doc_no is one level too shallow: this entry sits under Base > Morpho, and its sibling A.6.1.1.2.2.6.1.1.2.3.1.1 cites A.6.1.1.2.2.6.1.3.3.1.1, so A.6.1.1.2.2.6.1.3.3.2 would be a chain-level protocol bucket, not a Morpho Instance Configuration Document; every other entry in this directory maps 1:1 to <chain>.<protocol>.<instance>.

**Suggested.** A.6.1.1.2.2.6.1.3.3.1.2

### `A.6.1.1.2.3.6.7` — Medium
A.6.1.1.2 · `db2e4893-d315-4a65-a5cc-133d7763c693`

> [https://gateway.pinata.cloud/ipfs/bafkreierc3rxu3d64xakeeibkqujkqbhlz3lcsnjymcckaacix55vhya6u](ttps://gateway.pinata.cloud/ipfs/bafkreierc3rxu3d64xakeeibkqujkqbhlz3lcsnjymcckaacix55vhya6u)

**Issue.** The link target is 'ttps://' - it disagrees with its own link text and is not a resolvable URL scheme; every other DAO Resolution in this section links to a well-formed https URL.

**Suggested.** Link target should be https://gateway.pinata.cloud/ipfs/bafkreierc3rxu3d64xakeeibkqujkqbhlz3lcsnjymcckaacix55vhya6u.

### `A.6.1.1.4.2.5.2.2.1.2.1` — Medium
A.6.1.1.4 · `6fe71ca8-3c28-408e-8b11-3c2fcfcc5778`

> subject to the qualifications specified in [A.2.2.9.1.2.1.3.3.1 - Near-Term Process](05fb732b-de55-4886-81a7-7c5d4c13d2d2).

**Issue.** The Euler Instance belongs to the Integration Boost Primitive (A.6.1.1.4.2.5.2, 'See A.2.2.9.2 - Integration Boost Primitive'), but its Near-Term Process qualification points into the Distribution Reward Primitive subtree (A.2.2.9.1.*), while its two sibling Integration Boost Instances (Curve A.6.1.1.4.2.5.2.2.2.2.1 and Morpho A.6.1.1.4.2.5.2.2.3.2.1) both cite A.2.2.9.2.2.1.3.2.1 - Near Term Process.

**Suggested.** Should cite [A.2.2.9.2.2.1.3.2.1 - Near Term Process](4ab621b4-ef8e-4b01-a6aa-9296601033c5), as the Curve and Morpho Instances do

### `A.6.1.1.4.2.5.2.4.1.3.1` — Medium
A.6.1.1.4 · `9ad35e12-7bd0-46c8-a753-4a341ab880a2`

> subject to the qualifications specified in [A.2.2.9.1.2.1.3.3.1 - Near-Term Process](05fb732b-de55-4886-81a7-7c5d4c13d2d2).

**Issue.** The Compound Instance is an Integration Boost Primitive Instance (A.6.1.1.4.2.5.2 -> A.2.2.9.2) yet its Near-Term Process qualification points into the Distribution Reward Primitive subtree (A.2.2.9.1.*), contradicting the Curve and Morpho Integration Boost Instances in the same chunk which cite A.2.2.9.2.2.1.3.2.1 - Near Term Process.

**Suggested.** Should cite [A.2.2.9.2.2.1.3.2.1 - Near Term Process](4ab621b4-ef8e-4b01-a6aa-9296601033c5)


## Stale / dated (10)

### `A.1.5.10.2.0.6.1` — High
A.1 · `e7aec672-ed19-4329-aaf7-736950be2eb7`

> | 2023-02-02 | AD | 0xDefensor | - | [https://forum.skyeco.com/t/ad-derecognition-due-to-operational-security-breach-02-02-2024/23619]

**Issue.** The row is dated 2023-02-02 but its own linked reasoning post is titled '02-02-2024', and the row breaks the table's otherwise strictly chronological order (it sits between two 2023-10-30 rows and a 2024-04-06 row); forum topic id 23619 also falls between the 2023-10-30 post (22532) and the 2024-04 post (24043).

**Suggested.** 2024-02-02

### `A.2.8.2.1.1.2` — High
A.2 · `c2fe6ab2-bec3-48d3-b4b1-9f93cd97f693`

> The duration of Ecosystem Accord 1 is six (6) months, commencing from May 29, 2025.

**Issue.** Six months from 2025-05-29 expired on 2025-11-29, roughly ten months before today (2026-09-15), yet Accord 1 is still recorded under A.2.8.2 'Active Ecosystem Accords' ('The subdocuments herein record currently active Ecosystem Accords') with no renewal or extension clause anywhere in the Section.

**Suggested.** State the renewal/extension terms or the new end date, or move Accord 1 out of the Active Ecosystem Accords section

### `A.2.8.2.2.2.7.4` — High
A.2 · `f3672ca1-b305-4e16-86f0-3dc3267073bb`

> Any operational or other expenses incurred by a Prime and paid directly by Sky after July 1, 2025 shall be treated as an advance against the Prime's Genesis Capital Allocation.

**Issue.** The rule only covers expenses paid AFTER July 1, 2025, yet the document it governs (its title says 'Pre-TGE', and A.2.8.2.2.2.7.2.1 deducts 4.4m USDS of 'pre-TGE expenses ... as specified in A.2.8.2.2.2.7.4' in the June 26, 2025 Executive Vote, with A.2.8.2.2.2.7.4.1/.2 stating in the past tense that Sky 'has transferred' 2m and 2.4m) concerns expenses necessarily paid before July 1, 2025 — Spark's TGE was June 17, 2025, so no pre-TGE expense can post-date July 1, 2025.

**Suggested.** The cut-off should probably read 'before the Prime's TGE' or 'prior to July 1, 2025', matching the document title and the 4.4m deduction it authorizes; otherwise the Spark deduction is unauthorized by the clause it cites.

### `A.6.1.1.1.2.2.2.2.1.2.4` — High
A.6.1.1.1 · `6ecef2b2-42c7-4bea-80f0-1cb1cd4e735d`

> will be controlled by Sky Core Governance until Sky determines that the SPK token is decentralized enough to allow for meaningful governance by tokenholders. At such time, which is currently estimated for September 17, 2025, control will transition

**Issue.** This 'Short-Term Transitionary Measure' states a future handover of parameter control estimated for September 17, 2025, a date that passed roughly a year ago (today is 2026-09-15), yet the clause is still written in the future tense as if pending.

**Suggested.** Either record that the transition occurred and retire the transitionary measure, or replace the stale estimate with a current date/condition.

### `A.6.1.1.1.3.1.3.4.3` — High
A.6.1.1.1 · `c612d4e4-96c4-4ccf-a830-7f742338cfd9`

> For the avoidance of doubt, there will be no re-approval on January 1, 2026; the first re-approval checkpoint is July 1, 2026 for all such Delegates.

**Issue.** A transitionary clause still written in the future tense although both dates are in the past as of 2026-09-15 - and the Registry of Delegates (daa90217) already records Current Term 2026-07-01 to 2026-12-31 for all three Delegates, i.e. that checkpoint has passed.

**Suggested.** Retire the transition paragraph, or restate it in the past tense now that the 2026-07-01 re-approval checkpoint has occurred.

### `A.1.10.4.1` — Medium
A.1 · `fe525e67-1142-4312-bab7-bd9549747f77`

> Spark is one of the initial Agents focused on developing crypto on-chain lending engines. ... structured as a Conduit in the upcoming Allocation System. SparkLend will be adopted by Spark once Agents are launched.

**Issue.** The same document states Spark IS an Agent (present tense) yet says SparkLend will be adopted 'once Agents are launched' and calls the Allocation System 'upcoming' — the future-tense framing cannot be true if Agents already exist, and it is stale relative to 2026-09-15.

**Suggested.** Rewrite in present tense: SparkLend is operated by the Spark Agent as a Conduit/Allocation instance; drop 'upcoming' and 'once Agents are launched'.

### `A.2.11.1.1.1` — Medium
A.2 · `54134f24-84a2-4130-80a5-a519f291c918`

> The Sky Ecosystem must continue to maintain a Bug Bounty Program for SparkLend until the launch of the Spark Agent.

**Issue.** The sunset condition has already been met but the obligation is still stated as running to a future event: the Spark Prime Agent is treated throughout the same file as launched and operating (Spark Token Generation Event occurred June 17, 2025 per A.2.8.2.2.2.7.1.1.1, Spark SubProxy funded in the June 26, 2025 Executive Vote, Spark Prime Treasury grants authorised through Q3 2026), yet A.2.11.1.1.2 still says the scope 'currently includes both Sky Protocol and Spark Protocol'.

**Suggested.** Either remove the lapsed sunset condition and state the SparkLend program's current status directly, or restate the condition against a milestone that has not yet occurred.

### `A.2.8.2.7.1.2` — Medium
A.2 · `9d207eb3-955e-4b4d-af1b-056519d0235b`

> The duration of Ecosystem Accord 7 is indefinite, commencing from September 1, 2024.

**Issue.** Breaks the otherwise monotonic commencement sequence of the numbered Ecosystem Accords (3: June 23, 2025; 4: November 13, 2025; 5: December 11, 2025; 6: December 18, 2025; 8 and 9: March 19, 2026) by more than a year, with no 'retroactively' qualifier of the kind Accord 10 carries, and precedes Skybase's own Genesis Capital Allocation (January 29, 2026 Executive Vote) by 17 months.

**Suggested.** Probably should be a 2025 or 2026 date consistent with Accord 6 and Accord 8, or be marked as retroactive as in A.2.8.2.10.1.2.

### `A.3.7.1.4.1` — Medium
A.3 · `af29fc28-e4d4-4921-98e5-9468f06068ec`

> Chainlink Automation Budget: 1,500 USDS per day Stream Duration: 3 years (start date 29 May 2023).

**Issue.** Its parent A.3.7.1.4 presents these as 'the current keeper providers and ... their associated payment streams', but a 3-year stream beginning 29 May 2023 ended on 29 May 2026, before today (2026-09-15), so the stated current budget no longer exists.

**Suggested.** Either record the stream as expired/renewed with a new duration, or state the current arrangement - unclear, needs author.

### `A.4.2.2.3.2` — Medium
A.4 · `1c0d2cf1-dc44-4b7f-b709-61fcc5c1612c`

> The Avalanche SkyLink Bridge will be deployed in the April 9, 2026 Executive Vote. The timing may be modified by the Core Facilitator in consultation with relevant Ecosystem Actors.

**Issue.** The stated deployment date (April 9, 2026) is over five months in the past relative to today (2026-09-15) yet is still written as a future event, so the document cannot be accurate as written.

**Suggested.** Restate as a completed deployment with its actual date, or update to the new planned Executive Vote date


## Unfilled placeholder (12)

### `A.2.2.9.1.2.4.1.3.4.1` — High
A.2 · `cca17fe9-3dc9-48ce-be26-39a1625b3690`

> - TBD

**Issue.** placeholder text left in document

### `A.6.1.1.1.2.6.1.2.1.1.1.2.6.3` — High
A.6.1.1.1 · `abe7f425-65fd-4a3a-b70c-55a8f30e708d`

> The address of the Multisig that has the Freezer Role is specified in TBD.

**Issue.** placeholder text left in document

### `A.6.1.1.1.2.6.1.2.1.1.1.2.6.5` — High
A.6.1.1.1 · `179f186a-079b-4663-b06c-b21f9dec85ca`

> The address of the ALM_PROXY contract is: `TBD`

**Issue.** placeholder text left in document

### `A.6.1.1.1.2.6.1.2.1.1.1.2.6.6` — High
A.6.1.1.1 · `43462d47-89bf-4166-88de-8601eb6ac7ad`

> The address of the ALM_RATE_LIMITS contract is: `TBD`

**Issue.** placeholder text left in document

### `A.6.1.1.1.2.6.1.3.1.11.2.2.2.3` — High
A.6.1.1.1 · `d22ee5e9-4601-4ff1-b0c0-b2641f871b2b`

> TBD

**Issue.** placeholder text left in document

### `A.6.1.1.1.2.6.1.3.3.3.1.2.2.1` — High
A.6.1.1.1 · `a455756e-8476-443b-9d98-afee0bee28e5`

> TBD

**Issue.** placeholder text left in document

### `A.6.1.1.1.2.6.1.3.3.3.1.4.1.1` — High
A.6.1.1.1 · `bfa35719-77b3-4fbf-b8a3-329238b66c86`

> TBD

**Issue.** placeholder text left in document

### `A.6.1.1.1.2.6.1.3.3.3.1.4.1.3` — High
A.6.1.1.1 · `60113aaa-8464-4417-9344-8594b5a2d23f`

> TBD

**Issue.** placeholder text left in document

### `A.6.1.1.1.2.6.1.3.5.1.1.4.2.3` — High
A.6.1.1.1 · `6c10e42f-bd39-4359-9f7c-08ac9db45bbd`

> - `maxAmount`: `TBD` (not specified in the proposal)

**Issue.** placeholder text left in document

### `A.6.1.1.1.2.6.1.3.5.1.1.4.2.4` — High
A.6.1.1.1 · `b58e2248-8251-4000-8867-9ba32d48f422`

> - `maxAmount`: `TBD`

**Issue.** placeholder text left in document

### `A.2.2.9.1.2.4.1.3.4.1` — Medium
A.2 · `cca17fe9-3dc9-48ce-be26-39a1625b3690`

> - Payment Inaccuracy Previously Found By Core GovOps     - TBD

**Issue.** Leftover "TBD" placeholder left in the Sky Core Atlas Updates output spec instead of a defined update procedure.

**Suggested.** Replace "TBD" with the actual specified update procedure for this branch, or state explicitly that none applies.

### `A.6.1.1.1.2.6.1.3.1.11.1.2.2.3` — Medium
A.6.1.1.1 · `ec3d3c63-f0ac-4d85-a05b-4af82744340d`

> TBD

**Issue.** Document body for 'Binance Deposit Address' is the leftover placeholder text 'TBD' instead of an actual address.

**Suggested.** Replace with the actual Binance deposit address, or mark the field explicitly as pending in prose.


## Copy-paste residue (8)

### `A.1.10.2.4.9.2.3` — High
A.1 · `952d9bdc-1298-49b5-a52f-11ab480a82b7`

> A.1.10.2.4.9.2.3 - A.1.9 -Spell Reviewer Direct Authoring Ban [Core]

**Issue.** The document title embeds a stray, mismatched doc-number fragment "A.1.9 -" that does not match this document's own doc_no and does not belong in the title.

**Suggested.** A.1.10.2.4.9.2.3 - Spell Reviewer Direct Authoring Ban [Core]

### `A.6.1.1.2.2.6.1.3.1.7.1.2.3.2` — High
A.6.1.1.2 · `a7ad7e2a-5c2e-4231-94d4-cdd14d526c1d`

> **Outflow RateLimitID** _(Core)_ - The outflow RateLimitID is: `0xe668276e49fbcb8fc24c716adf328ec4602ad894aaeabc608d172aadfd5cd485`.

**Issue.** The document body contains a duplicated heading-style fragment ("Outflow RateLimitID (Core) -") pasted before the actual sentence, unlike every sibling Outflow RateLimitID document in this file which simply reads "The outflow RateLimitID is: ...".

**Suggested.** The outflow RateLimitID is: `0xe668276e49fbcb8fc24c716adf328ec4602ad894aaeabc608d172aadfd5cd485`.

### `A.6.1.1.3.2.6.1.2.1.1.3.2.2.2` — High
A.6.1.1.3 · `06081a43-075d-48c1-a26d-6578c1aa2fd3`

> The maximum amount of USDC that can be swapped for USDC by the Keel Liquidity Layer on Solana is specified in the document herein.

**Issue.** Heading is titled "USDC For USDS Swap Maximum" but the body says USDC can be swapped for USDC (should be USDS), contradicting its own title; every sibling swap-maximum doc in this section correctly names the target token in its body.

**Suggested.** The maximum amount of USDC that can be swapped for USDS by the Keel Liquidity Layer on Solana is specified in the document herein.

### `A.1.10.2.4.12.3.3.7` — Medium
A.1 · `a6940e22-f25c-4f29-9307-328b7f590ce7`

> Group this with general constant validations (e.g., ensuring hardcoded values like fees or ceilings are computed accurately).

**Issue.** This sentence reads as a leftover drafting/editorial note (an instruction about document organization) rather than published guidance to Spell validators, breaking the second-person instructional voice of the rest of the paragraph.

**Suggested.** Remove the sentence, or rewrite as guidance to validators, e.g. "Validators should also apply the same care to general constant validations, ensuring hardcoded values like fees or ceilings are computed accurately."

### `A.2.1.1.1.0.3.3` — Medium
A.2 · `b5be838e-23a8-4ed4-b713-d5a57fe1864d`

> The element means that a formal request has been made to the Core Facilitator to review an Atlas document

**Issue.** Unlike its two sibling Element Annotation documents (A.2.1.1.1.0.3.1 and .0.3.2), which open with 'The element "<term>" refers to/describes...', this one drops the quoted element name entirely, leaving "The element means that..." with no stated referent.

**Suggested.** The element "document is appealed" means that a formal request has been made to the Core Facilitator to review an Atlas document

### `A.5.4.1.4.1` — Medium
A.5 · `e6b9065e-8dd7-4f23-b7e4-4e3d2736bee4`

> Luhansk People’s Republic of Ukraine

**Issue.** Breaks the parallel list structure: every other entry in this list is a bare region/republic name (e.g. "Donetsk People’s Republic", "Crimea and Sevastopol", "Kherson Oblast") with no country appended, but this one entry has "of Ukraine" tacked on, reading as leftover/copy-paste text.

**Suggested.** Luhansk People’s Republic

### `A.6.1.1.1.2.6.1.2.2.1.2.1.2.1.2.2` — Medium
A.6.1.1.1 · `efbe3b04-022f-4181-b7c9-402728536931`

> The operator must ensure the `RateLimits` allow for minting the required amount.

**Issue.** This sentence sits under the "Burn USDS" / "Check RateLimits" step but says "minting" instead of "burning" — looks copied verbatim from the Mint USDS doc without updating the verb.

**Suggested.** The operator must ensure the `RateLimits` allow for burning the required amount.

### `A.6.1.1.1.2.6.1.2.2.1.2.1.2.4.2.9` — Medium
A.6.1.1.1 · `5b50fe5d-22a9-4ea4-a9e1-de7feba453a3`

> If the PSM can't be filled, the transaction reverts with `DssLitePsm/nothing-to-fill`.

**Issue.** Heading title "Split Into Multiple Swaps If Limit Exceeded" duplicates the previous doc's title verbatim, but this doc's opening sentence describes an unrelated revert-on-fill-failure case, not splitting swaps.

**Suggested.** Retitle to something like "Revert If PSM Refill Fails" to match the body.


## Wrong word (8)

### `A.1.1.3.1.0.6.1` — High
A.1 · `88df9622-0dd5-4035-83fb-9866a66eadf2`

> at the proscribed conversion rate listed in the Atlas

**Issue.** "Proscribed" (forbidden) is used where "prescribed" (specified/mandated) is clearly intended.

**Suggested.** at the prescribed conversion rate listed in the Atlas

### `A.2.9.1.1.1.4.2.2.1` — High
A.2 · `d47f9aa8-96d1-4be7-910c-505693b1784a`

> Supportive documentation is highly sensible.

**Issue.** 'Sensible' (reasonable) is a malapropism for 'sensitive' (confidential) — the following sentence requires encryption tools, which only makes sense for sensitive documents.

**Suggested.** Supportive documentation is highly sensitive.

### `A.3.2.2.1.1.1.1.1.3.1` — High
A.3 · `68c5da4f-9c4e-4206-a582-99be9833481f`

> It is set of `0.13`.

**Issue.** Wrong preposition; should be "set to", not "set of".

**Suggested.** It is set to `0.13`.

### `A.3.2.2.1.2.2.5` — High
A.3 · `0016d78c-66e7-447f-9691-eaff8ea68d6d`

> The audit from each audit firm with the highest product of Effective Audit Value and Delay factor should be included in this calculation.

**Issue.** "Delay factor" should be "Decay Factor" — the formula uses decayFactor and the parameter is defined in a subdocument titled "Decay Factor", not "Delay Factor".

**Suggested.** The audit from each audit firm with the highest product of Effective Audit Value and Decay Factor should be included in this calculation.

### `A.6.1.1.1.3.7.2.7.3` — High
A.6.1.1.1 · `4c8b20c3-e723-4304-904f-7d7f8de5fc8b`

> Spark Asset Foundation (including legal council)

**Issue.** Malapropism: "legal council" (a deliberative body) should be "legal counsel" (legal advisors), which is the intended meaning here.

**Suggested.** Spark Asset Foundation (including legal counsel)

### `A.6.1.1.1.3.8.2.7.3` — High
A.6.1.1.1 · `8f3822f2-8403-444f-9db7-2a9fa2da552f`

> Spark Asset Foundation (including legal council)

**Issue.** Malapropism: "legal council" (a deliberative body) should be "legal counsel" (legal advisors), which is the intended meaning here.

**Suggested.** Spark Asset Foundation (including legal counsel)

### `A.2.2.10.1.1.3.2.1.2.3.1` — Medium
A.2 · `7e95efa7-e409-48dc-9b5a-96edce54bf31`

> The outcome of this validation is a critical input for the monthly settlement cycles, which latter includes the determination and retroactive application of penalties

**Issue.** "which latter includes" is not grammatical — "latter" (an adjective meaning "the second of two") is used where an adverb like "later" (temporal) was clearly intended, and the verb also disagrees in number with the plural "cycles".

**Suggested.** The outcome of this validation is a critical input for the monthly settlement cycles, which later includes the determination and retroactive application of penalties

### `A.2.7.1.2.1.1.3` — Medium
A.2 · `4d4a1d9a-c8c7-4c2b-aaec-33e382790d52`

> the ban on unbanned users will be lifted across all communication channels

**Issue.** "Unbanned users" already implies the ban was lifted, contradicting the statement that their ban "will be lifted"; should refer to users approved for unbanning.

**Suggested.** the ban on users approved for unbanning will be lifted across all communication channels


## Typo / spelling (22)

### `A.1.10.2.4.7.4.4` — High
A.1 · `aa0a8049-f883-4366-9924-6651aeec14e6`

> consider the "Lindy" of systems, elements,and smart contracts when evaluating their use

**Issue.** Missing space after the comma between "elements," and "and".

**Suggested.** consider the "Lindy" of systems, elements, and smart contracts when evaluating their use

### `A.1.10.2.4.7.4.4` — High
A.1 · `aa0a8049-f883-4366-9924-6651aeec14e6`

> ed best practice to consider the "Lindy" of systems, elements,and smart contracts when evaluating their use or inclusion

**Issue.** missing space after comma

### `A.1.14.2.9.2` — High
A.1 · `1405d49c-8373-409e-a96b-e59f49e3aeb0`

> Executor Agent Artifacts define each Agent’s approach to operationalizing the strategy of different Prime Agents, including risk-management and fees

**Issue.** Sentence is missing its closing period; every other document body in this file ends its final sentence with terminal punctuation.

**Suggested.** Executor Agent Artifacts define each Agent’s approach to operationalizing the strategy of different Prime Agents, including risk-management and fees.

### `A.1.2.2.2.29` — High
A.1 · `935bd219-df68-4466-99fe-0f9c5b328032`

> `A.1.1.0.4.1.1.1.var2` .

**Issue.** Stray space before the closing sentence period after the backtick-quoted identifier.

**Suggested.** `A.1.1.0.4.1.1.1.var2`.

### `A.2.2.1.1.13` — High
A.2 · `c1ff42c9-1ffc-46f0-9dac-da54eb4eb042`

> CoreGovOps reviews the inputs to the Executor Accord Primitive

**Issue.** "CoreGovOps" is missing the space present in every other occurrence of "Core GovOps" throughout the atlas (including the rest of this same document).

**Suggested.** Core GovOps reviews the inputs to the Executor Accord Primitive

### `A.2.2.9.2.2.3.1.4.2` — High
A.2 · `d86e5f9f-7b1c-4605-9253-4281a6bdbc13`

> Responsible party: Operational GovOps [ automated]

**Issue.** Stray space after the opening bracket; every other occurrence in the document (and the sibling GovOps-review bullet directly above) reads "[automated]" with no space.

**Suggested.** Responsible party: Operational GovOps [automated]

### `A.2.9.1.1.1.4.1.2` — High
A.2 · `a457da07-943a-4d98-8153-db7b0eb55fe2`

> .x4: [Signature hash]

**Issue.** Template list item breaks the established '.x.N' numbering pattern (preceded by .x.1, .x.2, .x.3) by omitting the dot before 4.

**Suggested.** .x.4: [Signature hash]

### `A.2.9.1.1.1.4.2.2.4` — High
A.2 · `07cd5714-47aa-46ef-a162-ab96875631d6`

> Resilience Fund Claim Approval Technical Commitee Review

**Issue.** 'Commitee' is misspelled (missing a 't') in the document heading title; every sibling document correctly spells 'Committee'.

**Suggested.** Resilience Fund Claim Approval Technical Committee Review

### `A.3.2.2.1.2.2.3.3.10` — High
A.3 · `a30c8bc7-2686-46ac-952e-9c1f71c96aa0`

> The Code Size Factory is an arbitrary factor to normalize the Code Size relative to other parameters.

**Issue.** "Factory" is a typo for "Factor" — the document's own heading is "Code Size Factor".

**Suggested.** The Code Size Factor is an arbitrary factor to normalize the Code Size relative to other parameters.

### `A.3.4.3.1` — High
A.3 · `4b110433-bf28-4c9a-b709-e2deaac9212e`

> Arrangers are generally prohibited from occupying any position where they could cause damage or loss to the Sky Ecoystem, notwithstanding delays or inconveniences.

**Issue.** "Ecoystem" is a misspelling of "Ecosystem".

**Suggested.** Arrangers are generally prohibited from occupying any position where they could cause damage or loss to the Sky Ecosystem, notwithstanding delays or inconveniences.

### `A.3.7.1.1.2.6` — High
A.3 · `d6e0c32d-aea2-4bc7-9ec3-97d54bdbd9a7`

> the transaction will fail and no DAi will be minted

**Issue.** "DAi" is a mis-capitalized form of "Dai", inconsistent with the term's use elsewhere in the same sentence/document.

**Suggested.** the transaction will fail and no Dai will be minted

### `A.6.1.1.1.2.6.1.2.2.1.3.1` — High
A.6.1.1.1 · `89577062-a38b-4cf7-a1ae-33c0bcff1cca`

> Function getRateLimitData(bytes32 key) external override view returns (RateLimitData memory) {

**Issue.** Solidity keyword "Function" is capitalized here; every other code snippet in this file uses lowercase "function".

**Suggested.** function getRateLimitData(bytes32 key) external override view returns (RateLimitData memory) {

### `A.6.1.1.1.2.6.1.4.3.4.1.3.1.1` — High
A.6.1.1.1 · `7fcbd408-2aef-427f-b88d-d301350bd41b`

> These addesses will be specified in a future iteration of the Spark Artifact.

**Issue.** Misspelling of 'addresses'.

**Suggested.** These addresses will be specified in a future iteration of the Spark Artifact.

### `A.6.1.1.1.3.4.2.3.2` — High
A.6.1.1.1 · `dfa483c7-5adb-480e-9f82-c97cf4d0f74e`

> the Current SubDAO Proxy Value with be calculated based on the definition

**Issue.** "with be calculated" is a typo for "will be calculated".

**Suggested.** the Current SubDAO Proxy Value will be calculated based on the definition

### `A.6.1.1.2.2.6.1.3.1.4.1.3.1.1` — High
A.6.1.1.2 · `ba1c514f-026a-4ecd-bb9a-c736cca59728`

> These addesses will be specified in a future iteration of the Spark Artifact.

**Issue.** Misspelling of 'addresses' as 'addesses'.

**Suggested.** These addresses will be specified in a future iteration of the Spark Artifact.

### `A.6.1.1.2.2.6.3` — High
A.6.1.1.2 · `0ec0b58d-9332-49ba-bdf8-8e0201480d1d`

> The documents herein contain all data and specifications for Groves Instances of the Asset Liability Management Rental Primitive.

**Issue.** Missing apostrophe: "Groves Instances" should be the possessive "Grove's Instances", consistent with every parallel sentence in this document (e.g. "Grove's usage", "Grove's Instances" elsewhere).

**Suggested.** The documents herein contain all data and specifications for Grove's Instances of the Asset Liability Management Rental Primitive.

### `A.6.1.1.3.2.5.2.2.4.1.6` — High
A.6.1.1.3 · `94bc2f19-0cbd-4afe-8c5d-d909092fb31d`

> The Data Submission Responsible Actor is the Core Council Risk Advisor..

**Issue.** Doubled period at end of sentence.

**Suggested.** The Data Submission Responsible Actor is the Core Council Risk Advisor.

### `A.6.1.1.4.2.5.1.1.4` — High
A.6.1.1.4 · `95beed80-4199-4c08-82bd-0ae7827c98b0`

> moved to [A.6.1.1.4.2.5.1.1.2 - Active Instances Directory](c6275b51-9ee0-49df-a4ea-33a24cd2c752),; whereas failed Invocations

**Issue.** Stray mangled punctuation: a comma immediately followed by a semicolon ("),;") after the link.

**Suggested.** moved to [A.6.1.1.4.2.5.1.1.2 - Active Instances Directory](c6275b51-9ee0-49df-a4ea-33a24cd2c752), whereas failed Invocations

### `A.6.1.1.4.2.5.2.2.3.3` — High
A.6.1.1.4 · `88095904-1a04-449c-b421-3a3c7e4fa437`

> A.6.1.1.4.2.5.2.2.3.3 - Date Repository [Core]

**Issue.** Heading title says 'Date Repository' but the body text and every sibling document in this pattern call it 'Data Repository'.

**Suggested.** A.6.1.1.4.2.5.2.2.3.3 - Data Repository [Core]

### `A.2.3.1.2.1.1` — Medium
A.2 · `bddce7bf-c568-444b-b196-e15a99016696`

> Income and Expenses are defined such that Net Revenue must always be positive

**Issue.** Sentence is missing its terminating period, unlike every other sentence in this document.

**Suggested.** Income and Expenses are defined such that Net Revenue must always be positive.

### `A.6.1.1.1.3.4.2.2.1.1` — Medium
A.6.1.1.1 · `3baabdcc-d715-419d-97b7-28936d4b0f95`

> Target SubDAO Proxy Value is the minimum target value of the Spark DAO SubDAO Proxy, below which Spark will not undertake

**Issue.** Extraneous, redundant "DAO" — the term used consistently everywhere else in this section is "Spark SubDAO Proxy", not "Spark DAO SubDAO Proxy".

**Suggested.** Target SubDAO Proxy Value is the minimum target value of the Spark SubDAO Proxy, below which Spark will not undertake

### `A.6.1.1.3.2.6.1.2.2.2.1.1.3` — Medium
A.6.1.1.3 · `6f7becc7-2e70-44e5-8662-25ba7dd1a5f8`

> The Freezer role has `can_freeze_controller` , `can_suspend_permissions` and `can_liquidate` permissions.

**Issue.** Stray space before the comma after the first code-formatted permission name.

**Suggested.** The Freezer role has `can_freeze_controller`, `can_suspend_permissions` and `can_liquidate` permissions.


## Grammar (53)

### `A.1.11.1.3` — High
A.1 · `22508894-e015-4f7c-9ee8-24ac13756d31`

> The Core Facilitator confirm the Executive Vote contents and deliver the Executive Sheet to the Spell team.

**Issue.** Subject/verb disagreement: singular subject 'The Core Facilitator' takes plural verb forms 'confirm'/'deliver'.

**Suggested.** The Core Facilitator confirms the Executive Vote contents and delivers the Executive Sheet to the Spell team.

### `A.1.11.1.3` — High
A.1 · `22508894-e015-4f7c-9ee8-24ac13756d31`

> The Core Facilitator add the Executive Vote to the Voting Portal and communicate this to the Sky Ecosystem community.

**Issue.** Subject/verb disagreement: singular subject 'The Core Facilitator' takes plural verb forms 'add'/'communicate'.

**Suggested.** The Core Facilitator adds the Executive Vote to the Voting Portal and communicates this to the Sky Ecosystem community.

### `A.1.12.2.4` — High
A.1 · `fbbd47b3-8985-42bb-98f4-3e5af582dea1`

> no person has communicated willingness to take over the responsibility of a AEP Author

**Issue.** Wrong article: 'AEP' is pronounced starting with a vowel sound, so it takes 'an', not 'a'.

**Suggested.** no person has communicated willingness to take over the responsibility of an AEP Author

### `A.1.12.2.5` — High
A.1 · `8eea2827-4d10-4893-92d3-9083be7e9267`

> The Core Facilitator publish the set of Ratification Polls.

**Issue.** Subject/verb disagreement: singular subject 'The Core Facilitator' takes plural verb form 'publish'.

**Suggested.** The Core Facilitator publishes the set of Ratification Polls.

### `A.1.2.1.1` — High
A.1 · `af7c725e-06c9-4c48-ac8a-c979eb004456`

> The Document Identifiers help determine the position of each Atlas Document, and makes it easier to estimate the relationship between two different Atlas Documents.

**Issue.** Subject-verb agreement: plural subject "Document Identifiers" takes singular verb "makes".

**Suggested.** The Document Identifiers help determine the position of each Atlas Document, and make it easier to estimate the relationship between two different Atlas Documents.

### `A.1.2.1.2.5` — High
A.1 · `6ae438cd-3678-46a2-b323-1f44204b5759`

> The Components of an Atlas Document is determined by its Type.

**Issue.** Subject-verb agreement: "Components" is plural and requires "are", not "is".

**Suggested.** The Components of an Atlas Document are determined by its Type.

### `A.1.2.2.2.8` — High
A.1 · `ff7f74ee-356d-403c-9454-56fcef514e9e`

> or if new perspectives or new external events makes it possible and useful to modify the Original Context Data Document

**Issue.** Subject-verb agreement: plural subject "events" (nearest to the verb) requires "make", not "makes".

**Suggested.** or if new perspectives or new external events make it possible and useful to modify the Original Context Data Document

### `A.1.7.6` — High
A.1 · `7aafa61e-8649-41fb-8c3f-64e5714f9f18`

> Formal allegations of such failure must be adjudicated by Core GovOps to the same process referenced in the above-cited document.

**Issue.** Dropped word breaks the sentence: "adjudicated by Core GovOps to the same process" does not parse; the parallel sentence in the preceding paragraph (and identical constructions elsewhere in the atlas) uses "pursuant to".

**Suggested.** Formal allegations of such failure must be adjudicated by Core GovOps pursuant to the same process referenced in the above-cited document.

### `A.2.11.1.2.4` — High
A.2 · `45ab54e8-309a-4149-91cc-fcdbeb5d1d37`

> are incorporated into the terms of conditions governing the frontends operated by Sky and/or Prime Agents

**Issue.** Should be "terms and conditions," the correct phrase (used correctly two paragraphs later in A.2.11.1.2.5).

**Suggested.** are incorporated into the terms and conditions governing the frontends operated by Sky and/or Prime Agents

### `A.2.2.9.1.2.4.1.1.4.2` — High
A.2 · `f3ba519f-0d2f-4565-80be-3c095fc49b75`

> The requirements specified [A.2.2.9.1.2.4.1.1.3 - Required Primitive Inputs](57921647-2a63-4d01-907b-131a50510d76) fully complete the Process.

**Issue.** Missing the word "in" before the bracketed reference; every parallel sentence elsewhere in the document reads "specified in [...]".

**Suggested.** The requirements specified in [A.2.2.9.1.2.4.1.1.3 - Required Primitive Inputs](57921647-2a63-4d01-907b-131a50510d76) fully complete the Process.

### `A.2.2.9.2.2.4.1.1.4.2` — High
A.2 · `b785cb0c-1ebb-438d-a5c4-c385e7446977`

> The requirements specified [A.2.2.9.2.2.4.1.1.3 - Required Primitive Inputs](4c84f0a6-0d4d-4718-a7c4-04fa29fadfcc) fully complete the Process.

**Issue.** Missing the word "in" before the bracketed reference; every parallel sentence elsewhere in the document reads "specified in [...]".

**Suggested.** The requirements specified in [A.2.2.9.2.2.4.1.1.3 - Required Primitive Inputs](4c84f0a6-0d4d-4718-a7c4-04fa29fadfcc) fully complete the Process.

### `A.2.9.1.1.1.4.2.2.1` — High
A.2 · `d47f9aa8-96d1-4be7-910c-505693b1784a`

> issued by a Court or Governmental Agency Supportive documentation is highly sensible.

**Issue.** Missing sentence-ending punctuation between 'Governmental Agency' and 'Supportive documentation' makes it read as one run-on, unparseable sentence.

**Suggested.** issued by a Court or Governmental Agency. Supportive documentation is highly sensitive.

### `A.3.2.1.2.2.2.1.2` — High
A.3 · `2adf8738-09b2-43e2-884c-c4ce6ff601ba`

> srUSDS smart contract, which allow users to provide USDS to Sky Core to serve as senior risk capital

**Issue.** Subject/verb disagreement: "which allow users" should be "which allows users" (singular subject "the srUSDS smart contract").

**Suggested.** ...srUSDS smart contract, which allows users to provide USDS to Sky Core...

### `A.3.2.2.1.1.1.2` — High
A.3 · `69fac7fa-6168-4b74-99cc-28b557826556`

> The near-term treatment of these assets are specified in the subdocuments herein.

**Issue.** Subject/verb disagreement: singular "treatment" takes "is", not "are".

**Suggested.** The near-term treatment of these assets is specified in the subdocuments herein.

### `A.3.2.2.1.1.1.3` — High
A.3 · `69d0776b-786c-408b-b76a-860ea60b6b9a`

> The near-term treatment of these assets are specified in the subdocuments herein.

**Issue.** Subject/verb disagreement: singular "treatment" takes "is", not "are".

**Suggested.** The near-term treatment of these assets is specified in the subdocuments herein.

### `A.3.2.2.1.1.1.4` — High
A.3 · `da1a154c-6db8-4012-91a7-31ea4e73e95d`

> The near-term treatment of these assets are specified in the subdocuments herein.

**Issue.** Subject/verb disagreement: singular "treatment" takes "is", not "are".

**Suggested.** The near-term treatment of these assets is specified in the subdocuments herein.

### `A.3.2.2.1.1.1.6` — High
A.3 · `3c0a9e8b-4a0b-4059-87a4-155deaee0486`

> The near-term treatment of these assets are specified in the subdocuments herein.

**Issue.** Subject/verb disagreement: singular "treatment" takes "is", not "are".

**Suggested.** The near-term treatment of these assets is specified in the subdocuments herein.

### `A.3.2.2.1.2.3.1.1` — High
A.3 · `80701bc2-5b75-4205-841e-7799c2be2c33`

> Low risk protocols are ones with a Risk Rating between less than or equal to `25`.

**Issue.** "between less than or equal to" is not valid phrasing; compare the parallel Medium/High Risk Protocols sentences, which state a single bound without "between".

**Suggested.** Low risk protocols are ones with a Risk Rating less than or equal to `25`.

### `A.3.2.2.7.2.1.1.7` — High
A.3 · `829e886b-0d00-488a-bb27-27f12dae9b3b`

> Prime Agents are expected to maintain a Encumbrance Ratio of less than or equal to 90%.

**Issue.** Wrong article: "a" should be "an" before "Encumbrance" (vowel sound).

**Suggested.** Prime Agents are expected to maintain an Encumbrance Ratio of less than or equal to 90%.

### `A.6.1.1.1.2.6.1.2.1.1.1.2.1.4` — High
A.6.1.1.1 · `f8958f39-6893-471a-bfd0-f72cb0aa0e4c`

> The address of the Multisigs that has the Relayer Role are specified in

**Issue.** Subject/verb disagreement: plural "Multisigs" takes "has" instead of "have".

**Suggested.** The address of the Multisigs that have the Relayer Role are specified in

### `A.6.1.1.1.2.6.1.2.1.1.1.2.2.4` — High
A.6.1.1.1 · `0d92d953-ce09-4f3a-a788-2f1dc7b190ed`

> The address of the Multisigs that has the Relayer Role are specified in

**Issue.** Subject/verb disagreement: plural "Multisigs" takes "has" instead of "have".

**Suggested.** The address of the Multisigs that have the Relayer Role are specified in

### `A.6.1.1.1.2.6.1.2.1.1.1.2.3.4` — High
A.6.1.1.1 · `d9bbc9dc-a8e9-413c-83ee-b6d1d3a2c2ec`

> The address of the Multisigs that has the Relayer Role are specified in

**Issue.** Subject/verb disagreement: plural "Multisigs" takes "has" instead of "have".

**Suggested.** The address of the Multisigs that have the Relayer Role are specified in

### `A.6.1.1.1.2.6.1.2.1.1.1.2.4.4` — High
A.6.1.1.1 · `351fc37c-0567-4fbc-bae0-975427192f29`

> The address of the Multisigs that has the Relayer Role are specified in

**Issue.** Subject/verb disagreement: plural "Multisigs" takes "has" instead of "have".

**Suggested.** The address of the Multisigs that have the Relayer Role are specified in

### `A.6.1.1.1.2.6.1.2.1.1.1.2.5.4` — High
A.6.1.1.1 · `1ce78bd7-1a4f-4389-b4dc-f2f7ab9e2b33`

> The address of the Multisigs that has the Relayer Role are specified in

**Issue.** Subject/verb disagreement: plural "Multisigs" takes "has" instead of "have".

**Suggested.** The address of the Multisigs that have the Relayer Role are specified in

### `A.6.1.1.1.2.6.1.2.1.1.1.2.6.4` — High
A.6.1.1.1 · `229a9ce0-30bd-4069-a8a9-2ff911185b66`

> The address of the Multisigs that has the Relayer Role will be specified in a future iteration of the artifact.

**Issue.** Subject/verb disagreement: plural "Multisigs" takes "has" instead of "have".

**Suggested.** The address of the Multisigs that have the Relayer Role will be specified in a future iteration of the artifact.

### `A.6.1.1.1.2.6.1.2.2.1.1` — High
A.6.1.1.1 · `e72290a8-e1af-494b-931d-778f5d697d4d`

> The documents herein defines roles (Admin, Relayer, Freezer) and their responsibilities/permissions for managing the Spark Liquidity Layer.

**Issue.** Subject/verb disagreement: plural "documents" takes "defines" instead of "define" (every sibling doc in this file uses "documents herein define/describe").

**Suggested.** The documents herein define roles (Admin, Relayer, Freezer) and their responsibilities/permissions for managing the Spark Liquidity Layer.

### `A.6.1.1.1.2.6.1.3.1.2.1.3.1.2` — High
A.6.1.1.1 · `d3977382-1434-4958-8910-b0f61a5aecc7`

> The operator must ensure ALM Proxy holds enough of the underlying asset to cover the instructed `deposit` amount.

**Issue.** Missing definite article 'the' before 'ALM Proxy'; every other sibling doc using this same boilerplate sentence (e.g. Check ALM Proxy for withdraw, ERC-4626 deposit/withdraw) says 'the ALM Proxy'.

**Suggested.** The operator must ensure the ALM Proxy holds enough of the underlying asset to cover the instructed `deposit` amount.

### `A.6.1.1.1.2.6.1.3.2.1.1.4.1` — High
A.6.1.1.1 · `ab15055e-99ff-4699-82f9-6f1b9a6b4f58`

> The documents herein contains exposure details for this Instance

**Issue.** Subject/verb disagreement: plural subject 'documents' takes singular verb 'contains' (and the sentence is missing a closing period).

**Suggested.** The documents herein contain exposure details for this Instance.

### `A.6.1.1.1.2.6.1.4.3.4.1.3` — High
A.6.1.1.1 · `6a009815-fba1-452c-af33-7ac5454211f1`

> The documents herein defines the operations performed to manage the Ethena Instance

**Issue.** Subject/verb disagreement: plural subject 'documents' takes singular verb 'defines'.

**Suggested.** The documents herein define the operations performed to manage the Ethena Instance

### `A.6.1.1.1.3.2.1.1.3.1.2` — High
A.6.1.1.1 · `7807007b-c076-4c7a-bd90-10cd23d41189`

> The `ttl` parameters is the minimum time requirement before it is possible to increase the Supply Cap or Borrow Cap

**Issue.** Subject/verb disagreement: "parameters is" should be "parameter is" (single ttl parameter, matching how gap/max are described elsewhere).

**Suggested.** The `ttl` parameter is the minimum time requirement before it is possible to increase the Supply Cap or Borrow Cap

### `A.6.1.1.1.3.2.1.1.3.2.9` — High
A.6.1.1.1 · `061ca4e3-08a7-4262-aa22-9a79b988cf89`

> `gap`: 50 millions sUSDS

**Issue.** "millions" should be singular "million" when used as a quantifier (compare "50 million sDai", "50 million pyUSD" elsewhere in the same section).

**Suggested.** `gap`: 50 million sUSDS

### `A.6.1.1.1.3.2.1.2.3.2` — High
A.6.1.1.1 · `bb867551-5231-4a5b-ac37-09d545bf70ce`

> must be calculated manually at the end of each quarter by the Spark and manually paid as Dai to a smart contract under the control of Aave Governance from Spark

**Issue.** "by the Spark" uses an incorrect article; "Spark" is used as a bare proper noun everywhere else, including later in the same sentence ("from Spark").

**Suggested.** must be calculated manually at the end of each quarter by Spark and manually paid as Dai to a smart contract under the control of Aave Governance from Spark

### `A.6.1.1.2.2.3.2` — High
A.6.1.1.2 · `ef8a7a1d-4e4d-474b-97fd-801c8285e9fc`

> The documents herein contain all data and specifications for Groves Instance of the Upkeep Rebate Primitive.

**Issue.** Missing possessive apostrophe: "Groves" should be "Grove's" (every sibling document in this file uses the possessive form, e.g. "Grove's Instance").

**Suggested.** The documents herein contain all data and specifications for Grove's Instance of the Upkeep Rebate Primitive.

### `A.6.1.1.2.2.5.1.1` — High
A.6.1.1.2 · `21b5e889-c9f9-45e7-becb-fde3e070e063`

> The documents herein organize all base information relevant to Groves usage of the Distribution Reward Primitive.

**Issue.** Missing possessive apostrophe: "Groves" should be "Grove's" (every sibling Primitive Hub Document in this file uses "Grove's usage").

**Suggested.** The documents herein organize all base information relevant to Grove's usage of the Distribution Reward Primitive.

### `A.6.1.1.2.2.6.1.2.1.2.1` — High
A.6.1.1.2 · `edf44383-44e6-4aaa-972a-7dfdaee0998d`

> The governance process to invoke a new Instance of the Allocation System Primitive follows the Root Edit process see [A.6.1.1.2.2.2.2.2.1.2 - Operational Process Definition](40826926-adb2-4de3-936d-702e2d8cb3b9).

**Issue.** Missing punctuation between "Root Edit process" and "see" makes the sentence run on / fail to parse; needs a comma or period to separate the clause from the cross-reference instruction.

**Suggested.** The governance process to invoke a new Instance of the Allocation System Primitive follows the Root Edit process, see [A.6.1.1.2.2.2.2.2.1.2 - Operational Process Definition](40826926-adb2-4de3-936d-702e2d8cb3b9).

### `A.6.1.1.2.2.6.1.3.1.4.1.3` — High
A.6.1.1.2 · `80844016-8ae5-4ea3-b4b7-970a33158425`

> The documents herein defines the operations performed to manage the Ethena Instance, including rate limiting, role-based access control, and cooldown functionality.

**Issue.** Subject/verb disagreement: plural subject 'documents' takes singular verb 'defines'.

**Suggested.** The documents herein define the operations performed to manage the Ethena Instance, including rate limiting, role-based access control, and cooldown functionality.

### `A.6.1.1.3.2.6.1.2.1.2.1` — High
A.6.1.1.3 · `ca0026a1-a4d2-4ebd-a99a-0a089dea8c82`

> follows the Root Edit process see [A.6.1.1.3.2.2.2.2.1.2 - Operational Process Definition]

**Issue.** Two clauses are run together with no punctuation between "process" and "see", so the sentence does not parse.

**Suggested.** follows the Root Edit process; see [A.6.1.1.3.2.2.2.2.1.2 - Operational Process Definition]

### `A.6.1.1.3.2.6.1.2.1.2.3.1.5` — High
A.6.1.1.3 · `e7492c8c-10b6-4ee1-9d62-fb3c292f1308`

> Changes to the Prime Relayer Addresses is a controller action which must be invoked by a

**Issue.** Subject/verb disagreement: plural subject "Changes" takes singular verb "is".

**Suggested.** Changes to the Prime Relayer Addresses are a controller action which must be invoked by a

### `A.6.1.1.3.2.6.1.2.1.2.3.2.5` — High
A.6.1.1.3 · `e471ce78-e775-4aff-a331-7e581a4606e6`

> Changes to the Prime Relayer Addresses is a controller action which must be invoked by a

**Issue.** Subject/verb disagreement: plural subject "Changes" takes singular verb "is".

**Suggested.** Changes to the Prime Relayer Addresses are a controller action which must be invoked by a

### `A.6.1.1.3.2.6.1.2.2.2.3.2.1` — High
A.6.1.1.3 · `4f8c8aa3-fffc-46dd-aeb7-b23e996619d7`

> Integrations, Reserves nor Permissions cannot be managed during this period, and funds cannot be moved.

**Issue.** "nor" is used without a preceding "neither", and the parallel Reallocation Freeze document uses "and" for the identical sentence structure, so this reads as a grammar slip.

**Suggested.** Integrations, Reserves, and Permissions cannot be managed during this period, and funds cannot be moved.

### `A.6.1.1.5.2.6.1.2.1.1.3.1.3` — High
A.6.1.1.5 · `8505febf-f853-4de9-89dc-d483d5439cbc`

> The maximum amount that can be transferred and sent to the Ethereum Mainnet ALM Proxy for USDC are located herein.

**Issue.** Subject/verb disagreement: singular subject "amount" takes plural verb "are located".

**Suggested.** The maximum amount that can be transferred and sent to the Ethereum Mainnet ALM Proxy for USDC is located herein.

### `A.6.1.1.5.2.6.1.2.2.1.1` — High
A.6.1.1.5 · `4eb0b4dc-9ffe-4201-b0cf-31e1cde8fcdb`

> The documents herein defines roles (Admin, Relayer, ALM Controller and Freezer) and their responsibilities/permissions for managing the Obex Liquidity Layer.

**Issue.** Subject/verb disagreement: plural subject "documents" takes singular verb "defines" (every other instance of this boilerplate sentence in the same document uses "define").

**Suggested.** The documents herein define roles (Admin, Relayer, ALM Controller and Freezer) and their responsibilities/permissions for managing the Obex Liquidity Layer.

### `NR-18` — High
A.1 · `ab868a43-3f89-4e9e-b281-6078e655e065`

> If the Core Facilitator merge parts of two approved, but conflicting AEPs, and the final merged product significantly deviates

**Issue.** Subject/verb disagreement: singular subject "the Core Facilitator" takes the plural verb form "merge" instead of "merges".

**Suggested.** If the Core Facilitator merges parts of two approved, but conflicting AEPs, and the final merged product significantly deviates

### `A.1.2.1.2.5` — Medium
A.1 · `6ae438cd-3678-46a2-b323-1f44204b5759`

> can have variable number of components, and different characteristics of each component, for each instance of the Type

**Issue.** Missing indefinite article before "variable number".

**Suggested.** can have a variable number of components, and different characteristics of each component, for each instance of the Type

### `A.1.2.2.2.26` — Medium
A.1 · `57c17134-5c45-4a98-8015-38e5e0438095`

> related to the Focus Hubs Immutable or Primary Document or its subtree

**Issue.** Missing possessive apostrophe: should be "Focus Hub's" (the Immutable/Primary Document belonging to the Focus Hub), not the plural "Focus Hubs".

**Suggested.** related to the Focus Hub's Immutable or Primary Document or its subtree

### `A.1.6.4.3.1` — Medium
A.1 · `ad1ef0f4-246f-4289-b5fc-ea5c91508ccf`

> their RD rank, and the budget eligibility associated with that rank, is transferred to the next highest-ranking AD

**Issue.** Subject/verb disagreement: the compound subject "their RD rank" and "the budget eligibility" joined by "and" requires a plural verb.

**Suggested.** their RD rank, and the budget eligibility associated with that rank, are transferred to the next highest-ranking AD

### `A.2.11.1.2.2.3.2.3` — Medium
A.2 · `3b5d10d1-16b0-49d8-88e6-9d1185e5de4f`

> conducted by a trusted third-party provider at Sky and Stars discretion

**Issue.** Missing possessive apostrophe: should be "Sky and Stars' discretion."

**Suggested.** conducted by a trusted third-party provider at Sky and Stars' discretion

### `A.2.2.9.2.2.3.1.4.2` — Medium
A.2 · `d86e5f9f-7b1c-4605-9253-4281a6bdbc13`

> Each Output "set" is triggered following the completion of its respective Input stage, which latter is defined in [A.2.2.9.2.2.3.1.3 - Required Primitive Inputs]...

**Issue.** "which latter is defined in" is an ungrammatical construction; the identical sentence in every parallel document (e.g. the Distribution Reward Primitive equivalent) reads simply "...Input stage, defined in [...]".

**Suggested.** Each Output "set" is triggered following the completion of its respective Input stage, defined in [A.2.2.9.2.2.3.1.3 - Required Primitive Inputs](b91d0eb6-fa86-486c-8350-4564bdb5af09).

### `A.2.7.1.2.1.1.1.1` — Medium
A.2 · `a3e4d767-56d1-4b1f-8ade-b733bca4244f`

> the ban interrupts the users' exercise of a governance process

**Issue.** Plural possessive "users'" disagrees with the singular antecedent "a user" used earlier in the same sentence.

**Suggested.** the ban interrupts the user's exercise of a governance process

### `A.3.7.1.1.2.5.1.1` — Medium
A.3 · `1ff3ceac-abd0-4195-9a60-a4aaf48c3d31`

> For example, 0.99 equated to a 1% price drop.

**Issue.** Verb tense ("equated") is inconsistent with the surrounding present-tense technical description.

**Suggested.** For example, 0.99 equates to a 1% price drop.

### `A.6.1.1.1.2.6.1.3.2.3.1.3` — Medium
A.6.1.1.1 · `bac5a103-a0fa-4d3b-8cd0-b9dfe024d4a9`

> For the general operational procedures applicable to all Aave-type instances. See [A.6.1.1.1.2.6.1.2.2.1.2.1.2.3 - Aave Functions]

**Issue.** Sentence fragment: 'For the general operational procedures applicable to all Aave-type instances.' has no verb and should be joined to the following 'See ...' clause rather than punctuated as its own sentence (the same fragment recurs verbatim in the Arbitrum and Avalanche Aave instance docs).

**Suggested.** For the general operational procedures applicable to all Aave-type instances, see [Aave Functions] and [Aave AToken Withdrawal Action].

### `A.6.1.1.1.2.6.1.4.1.1.2.3` — Medium
A.6.1.1.1 · `43f9fa01-68a2-4c8f-b1f4-fe775927562e`

> The specific `RateLimitID`(s) for this conduit's inflow and outflow is:

**Issue.** Verb 'is' does not agree with the three-item list that follows (should be plural 'are'); the same pattern recurs in the Superstate USTB instance doc.

**Suggested.** The specific `RateLimitID`(s) for this conduit's inflow and outflow are:

### `A.6.1.1.5.2.6.1.2.1.2.1` — Medium
A.6.1.1.5 · `f6be405d-fae7-474e-882d-5c98985324b6`

> The governance process to invoke a new Instance of the Allocation System Primitive follows the Root Edit process see Operational Process Definition.

**Issue.** Sentence does not parse: "follows the Root Edit process see Operational Process Definition" is missing punctuation connecting the cross-reference (e.g. a parenthesis or period before "see").

**Suggested.** The governance process to invoke a new Instance of the Allocation System Primitive follows the Root Edit process (see Operational Process Definition).


## Broken markdown (32)

### `A.1.10.2.4.11.1.6` — High
A.1 · `12ebd0d9-52dc-4d1f-8e1a-8bdc2a51b9b0`

> [(](https://vote.makerdao.com/executive/create)[https://vote.sky.money/executive/create](https://vote.sky.money/executive/create))

**Issue.** Malformed nested markdown link: contains a leftover, unlabeled link to the old vote.makerdao.com domain glued in front of the correct sky.money link, with mismatched parentheses.

**Suggested.** [https://vote.sky.money/executive/create](https://vote.sky.money/executive/create)

### `A.2.2.1.1.3.2` — High
A.2 · `a4f65994-2526-4522-a986-cd444a5cb896`

> _"_Founder Access" gives the Founder of an Agent the ability to freely edit the Scaffold Artifact

**Issue.** Malformed markdown italic/quote sequence at the start of the paragraph — a stray underscore is placed between the opening quote mark and the word "Founder", instead of the closing underscore following the closing quote as intended (matching the later "Founder Access" is revoked... pattern).

**Suggested.** "Founder Access" gives the Founder of an Agent the ability to freely edit the Scaffold Artifact

### `A.2.2.9.1.2.4.1.4.1.1.2` — High
A.2 · `c298f200-2ac8-4fc3-9d02-e05f4cf2f42f`

> This process is triggered by the Document Update specified in **`Sky Core Distribution Reward Reimbursement`** **Active Data Document Update**.

**Issue.** stray empty bold markers ** **

### `A.2.8.2.1.2.4.1` — High
A.2 · `0db1525d-bcce-469a-b414-65b41669432d`

> _Example:__ A lending protocol (i.e. Aave, Euler, Morpho, etc) plans on deploying on blockchain X.

**Issue.** Mismatched markdown emphasis markers: opens with one underscore but closes with two ("_Example:__"), garbling the emphasis syntax.

**Suggested.** _Example:_ A lending protocol (i.e. Aave, Euler, Morpho, etc) plans on deploying on blockchain X.

### `A.3.3.2.7.1.1.1.1` — High
A.3 · `12714156-5543-4443-b733-d213db62cecb`

> `tin` is a percentage fee applied when trading the collateral asset into the PSM in exchange for Dai**.**

**Issue.** Stray bold markdown wraps only the closing period after "Dai".

**Suggested.** `tin` is a percentage fee applied when trading the collateral asset into the PSM in exchange for Dai.

### `A.3.7.1.5.4.1` — High
A.3 · `5f2109db-6680-478b-b72a-45f30065b626`

> as defined in [A.1.9.1.1 - Definition Of Emergency Situations](5eafb29e-84a0-4a53-a798-3f958c880225)**.**

**Issue.** Stray bold markdown wraps only the closing period after the link.

**Suggested.** as defined in [A.1.9.1.1 - Definition Of Emergency Situations](5eafb29e-84a0-4a53-a798-3f958c880225).

### `A.6.1.1.1.2.5.2.1.4` — High
A.6.1.1.1 · `786859ec-1f50-4343-8bed-82ef86781356`

> Active Instances Directory](bb23a141-5119-4473-be3a-8f3c2a6f181a),; whereas failed Invocations are Archived

**Issue.** Stray comma-semicolon sequence ",;" — mangled punctuation not found anywhere else in the identical boilerplate sentence pattern used throughout this document.

**Suggested.** Active Instances Directory](bb23a141-5119-4473-be3a-8f3c2a6f181a), whereas failed Invocations are Archived

### `A.6.1.1.1.2.6.1.2.1.3` — High
A.6.1.1.1 · `ff7add39-b942-4df0-a710-75f70a05b49d`

> The documents herein** **specify requirements related to Spark’s Total Risk Capital (TRC) management.

**Issue.** Stray empty-bold markdown markers (** **) embedded mid-sentence between "herein" and "specify".

**Suggested.** The documents herein specify requirements related to Spark’s Total Risk Capital (TRC) management.

### `A.6.1.1.1.2.6.1.2.2.1.2.1.2.5.1.3` — High
A.6.1.1.1 · `469d9616-010c-4648-8fc4-66eeff7398c3`

> ** **The operator must verify the `mint` recipient.

**Issue.** Stray empty-bold markdown markers (** **) at the start of the sentence.

**Suggested.** The operator must verify the `mint` recipient.

### `A.6.1.1.1.2.6.1.2.2.1.2.1.2.5.1.3` — High
A.6.1.1.1 · `469d9616-010c-4648-8fc4-66eeff7398c3`

> ** **The operator must verify the `mint` recipient. They must check that a mint recipient (mapping from domain IDs to recipient addresses) is configured for the `destinationDomain`

**Issue.** stray empty bold markers ** **

### `A.6.1.1.1.2.6.1.2.2.3.2.4` — High
A.6.1.1.1 · `c1f708eb-7373-448d-a54c-b178d0fd909a`

> foreignController.withdrawAave(aToken, aToken.balanceOf(address(proxy))

**Issue.** Unclosed parenthesis in the code snippet — the outer withdrawAave( call is never closed (compare the correctly balanced version in the sibling doc UUID 5b090e5a).

**Suggested.** foreignController.withdrawAave(aToken, aToken.balanceOf(address(proxy)))

### `A.6.1.1.1.2.6.1.2.2.3.4.3` — High
A.6.1.1.1 · `09de757a-e742-4061-a1d4-7e5d70e9c0df`

> mainnetController.withdrawAave(aToken, aToken.balanceOf(address(proxy))

**Issue.** Unclosed parenthesis in the code snippet — the outer withdrawAave( call is never closed.

**Suggested.** mainnetController.withdrawAave(aToken, aToken.balanceOf(address(proxy)))

### `A.6.1.1.1.2.6.1.2.2.3.5` — High
A.6.1.1.1 · `62bf500a-56be-4766-8390-c6c1aaa4aeb9`

> mainnetController.swapUSDCToUSDS(usdc.balanceOf(address(proxy))

**Issue.** Unclosed parenthesis in the code snippet — the outer swapUSDCToUSDS( call is never closed.

**Suggested.** mainnetController.swapUSDCToUSDS(usdc.balanceOf(address(proxy)))

### `A.6.1.1.1.2.6.1.2.2.3.6` — High
A.6.1.1.1 · `dadf134c-5faa-4dfb-b31b-62f0bacc9519`

> mainnetController.burnUSDS(usds.balanceOf(address(proxy))

**Issue.** Unclosed parenthesis in the code snippet — the outer burnUSDS( call is never closed.

**Suggested.** mainnetController.burnUSDS(usds.balanceOf(address(proxy)))

### `A.6.1.1.2.2.5.2.1.4` — High
A.6.1.1.2 · `83d45b11-4497-473b-b3c4-80c0543dd5dd`

> whereas failed Invocations are Archived in [A.6.1.1.2.2.5.2.1.5 - Hub Data Repository](732e99b3-3a0c-4116-b3f6-5b9d2ad4d351) .

**Issue.** Stray space between the closing link parenthesis and the sentence-final period; every other instance of this boilerplate sentence in the file has no space before the period.

**Suggested.** whereas failed Invocations are Archived in [A.6.1.1.2.2.5.2.1.5 - Hub Data Repository](732e99b3-3a0c-4116-b3f6-5b9d2ad4d351).

### `A.6.1.1.2.3.6.7` — High
A.6.1.1.2 · `db2e4893-d315-4a65-a5cc-133d7763c693`

> See [https://gateway.pinata.cloud/ipfs/bafkreierc3rxu3d64xakeeibkqujkqbhlz3lcsnjymcckaacix55vhya6u](ttps://gateway.pinata.cloud/ipfs/bafkreierc3rxu3d64xakeeibkqujkqbhlz3lcsnjymcckaacix55vhya6u).

**Issue.** The markdown link target is missing the leading "h" of "https" ("ttps://..."), making the link non-functional.

**Suggested.** See [https://gateway.pinata.cloud/ipfs/bafkreierc3rxu3d64xakeeibkqujkqbhlz3lcsnjymcckaacix55vhya6u](https://gateway.pinata.cloud/ipfs/bafkreierc3rxu3d64xakeeibkqujkqbhlz3lcsnjymcckaacix55vhya6u).

### `A.6.1.1.3.2.5.2.3.1.1.2` — High
A.6.1.1.3 · `951107cb-8087-4a47-8b6c-5c50793b8796`

> `AZtUUe9GvTFq9kfseu9jxTioSgdSfjgmZfGQBmhVpTj1 `on Solana.

**Issue.** Stray space is inside the code span before the closing backtick, and there is no space between the closing backtick and "on".

**Suggested.** `AZtUUe9GvTFq9kfseu9jxTioSgdSfjgmZfGQBmhVpTj1` on Solana.

### `A.6.1.1.3.2.6.1.1.4` — High
A.6.1.1.3 · `c0753031-d528-4f41-affc-aed720bd018a`

> are moved to[A.6.1.1.3.2.6.1.1.2 - Active Instances Directory]

**Issue.** Missing space between "to" and the following markdown link.

**Suggested.** are moved to [A.6.1.1.3.2.6.1.1.2 - Active Instances Directory]

### `A.6.1.1.3.2.6.1.2.1.2.3.1.4` — High
A.6.1.1.3 · `d5bbbab6-ab49-4b45-90c8-31c2bbce5e65`

> must use it to exercise the[A.6.1.1.3.2.6.1.2.2.2.1.1.2 - Relayer Role]

**Issue.** Missing space between "the" and the following markdown link.

**Suggested.** must use it to exercise the [A.6.1.1.3.2.6.1.2.2.2.1.1.2 - Relayer Role]

### `A.1.10.2.4.12.3.1.1` — Medium
A.1 · `ea1d866c-41ed-474b-91ce-d9f6428bc158`

> run: `git clone <https://github.com/sky-ecosystem/Spells-mainnet`>.

**Issue.** Mismatched angle bracket around the URL: the opening `<` is inside the code span but the closing `>` falls outside it, leaving a stray `>` after the backtick.

**Suggested.** run: `git clone https://github.com/sky-ecosystem/Spells-mainnet`.

### `A.1.10.2.4.8.5.3` — Medium
A.1 · `95c6809a-17a3-4741-b428-5ecb1b1f5b20`

> Executive Validator [(https://vote.sky.money/executive/create](https://vote.sky.money/executive/create)).

**Issue.** Malformed markdown link: an extra opening parenthesis is included in the link text and a stray closing parenthesis is left after the link.

**Suggested.** Executive Validator [https://vote.sky.money/executive/create](https://vote.sky.money/executive/create).

### `A.1.2.2.2.22` — Medium
A.1 · `6eceace8-f499-4954-9ecc-1ada12a02c18`

> The Definition Type is used for documents that define unique concepts contained in subdocuments to the Target Document of the Definition Document

**Issue.** Sentence is missing its terminal period.

**Suggested.** The Definition Type is used for documents that define unique concepts contained in subdocuments to the Target Document of the Definition Document.

### `A.1.5.5.0.4.1` — Medium
A.1 · `38c70e00-b5b8-4d1b-9f57-809ef284cb25`

> Whether An Entity Is “Operationally Active" In A Role Is Determined Purely On A Formal Basis

**Issue.** Heading title has a mismatched quotation mark pair: a curly opening quote paired with a straight closing quote around "Operationally Active".

**Suggested.** Whether An Entity Is "Operationally Active" In A Role Is Determined Purely On A Formal Basis

### `A.6.1.1.1.2.6.1.1.2.4.2` — Medium
A.6.1.1.1 · `805d95ac-c6fa-4326-bade-380c3635306c`

> The Avalanche Instances Directory of the Spark Savings v2 Protocol with `Active` Status are stored herein

**Issue.** Sentence is missing its terminal period; every other instance of this identical boilerplate sentence pattern in the document ends with a period.

**Suggested.** The Avalanche Instances Directory of the Spark Savings v2 Protocol with `Active` Status are stored herein.

### `A.6.1.1.1.2.6.1.1.2.4.2.1` — Medium
A.6.1.1.1 · `82ccfe21-2172-41cc-b845-231ed61b101d`

> Configuration Document](afa35a43-18e2-4084-b36c-eb584f4749ac)

**Issue.** Sentence ending in a link is missing its terminal period; every other instance of this identical boilerplate sentence pattern in the document ends with a period after the closing parenthesis.

**Suggested.** Configuration Document](afa35a43-18e2-4084-b36c-eb584f4749ac).

### `A.6.1.1.1.2.6.1.1.2.5.1` — Medium
A.6.1.1.1 · `d0cbb95a-5115-4a9a-a67e-cc00172beef5`

> The Robinhood Chain Instances Directory of the Spark Savings v2 Protocol with `Active` Status are stored herein

**Issue.** Sentence is missing its terminal period; every other instance of this identical boilerplate sentence pattern in the document ends with a period.

**Suggested.** The Robinhood Chain Instances Directory of the Spark Savings v2 Protocol with `Active` Status are stored herein.

### `A.6.1.1.1.2.6.1.1.2.5.1.1` — Medium
A.6.1.1.1 · `8c634d61-3959-473d-8dea-f1a015e7650a`

> Configuration Document](87c1f6a7-8af8-4350-b43e-f63bc3287a1f)

**Issue.** Sentence ending in a link is missing its terminal period; every other instance of this identical boilerplate sentence pattern in the document ends with a period after the closing parenthesis.

**Suggested.** Configuration Document](87c1f6a7-8af8-4350-b43e-f63bc3287a1f).

### `A.6.1.1.1.2.6.1.1.2.6.1` — Medium
A.6.1.1.1 · `70c70fa9-9cb4-4bcf-a62f-b815a90981c3`

> The X Layer Instances Directory of the Spark Savings v2 Protocol with `Active` Status are stored herein

**Issue.** Sentence is missing its terminal period; every other instance of this identical boilerplate sentence pattern in the document ends with a period.

**Suggested.** The X Layer Instances Directory of the Spark Savings v2 Protocol with `Active` Status are stored herein.

### `A.6.1.1.1.2.6.1.1.2.6.1.1` — Medium
A.6.1.1.1 · `9c5abebd-6cfe-407c-9cda-5a397dd54ee8`

> Configuration Document](8c303f01-617d-40aa-9f4f-181af2c6e040)

**Issue.** Sentence ending in a link is missing its terminal period; every other instance of this identical boilerplate sentence pattern in the document ends with a period after the closing parenthesis.

**Suggested.** Configuration Document](8c303f01-617d-40aa-9f4f-181af2c6e040).

### `A.6.1.1.3.2.3.2.2.1.2.3` — Medium
A.6.1.1.3 · `77ad2a49-8fa6-499b-bd26-b9fdef57fded`

> it must be escalated to Core GovOps

**Issue.** Sentence ends without terminal punctuation (missing period).

**Suggested.** it must be escalated to Core GovOps.

### `A.6.1.1.4.2.5.2.1.2.3` — Medium
A.6.1.1.4 · `a050d87d-8918-4bf7-a0ae-0314d7e85b42`

> [A.6.1.1.4.2.5.2.2.3 Morpho Instance Configuration Document]

**Issue.** Link text is missing the ' - ' separator between the doc number and title that every sibling link in this same document uses (e.g. 'A.6.1.1.4.2.5.2.2.1 - Euler Instance Configuration Document').

**Suggested.** [A.6.1.1.4.2.5.2.2.3 - Morpho Instance Configuration Document]

### `NR-7` — Medium
A.1 · `98d5b899-f012-403d-9c6a-2ffda4ec2961`

> Defining “Severe Actions Or Violations" And “Governance Attack”

**Issue.** Heading title mixes a curly opening quote with a straight closing quote around "Severe Actions Or Violations", inconsistent with the correctly-paired curly quotes used around "Governance Attack" in the same title.

**Suggested.** Defining “Severe Actions Or Violations” And “Governance Attack”


## Naming inconsistency (12)

### `A.3.2.2.1.3.1.3` — High
A.3 · `52511026-55f4-4848-95a2-53db048d906c`

> The Delay Adjustment Factor $\text{DF}$ is a factor indicating the extent to which the risk associated with backdoor access is mitigated by a security delay

**Issue.** Inconsistent naming within the same document: the heading and the very next sentence both call this the "Delay Factor", but this sentence calls it "Delay Adjustment Factor".

**Suggested.** The Delay Factor $\text{DF}$ is a factor indicating the extent to which the risk associated with backdoor access is mitigated by a security delay

### `A.6.1.1.1.2.6.1.2.2.1.3` — High
A.6.1.1.1 · `554a654f-930a-419e-a8a4-f49dd5599ee8`

> The ratelimits must be maintained in line with Spark’s strategy, market conditions, and security considerations.

**Issue.** Inconsistent naming within the same document: the preceding sentence uses the backtick-formatted proper term `RateLimits`, this sentence uses lowercase plain "ratelimits".

**Suggested.** The RateLimits must be maintained in line with Spark’s strategy, market conditions, and security considerations.

### `A.6.1.1.1.3.2.1.1.3.2.5` — High
A.6.1.1.1 · `21bdfe50-0996-494d-8413-1d41966fb4f6`

> `gap`: 50 million sDai ... `max`: 1 billion sDai ... `max`: 0 sDAI

**Issue.** The same asset is written "sDai" twice and "sDAI" once within this single document.

**Suggested.** Use "sDai" consistently throughout (`max`: 0 sDai).

### `A.1.10.5.2.3.3.1` — Medium
A.1 · `0567fc4c-4a93-4f7e-803e-f587ddbd4f15`

> the Core Facilitator may temporarily grant an Operational Facilitator the sole authority to validate the authenticity of the Emergency Spell pursuant to

**Issue.** This document and its heading are entirely about Standby Spells (the surrounding sentences say 'Standby Spell' twice), but this clause switches to 'Emergency Spell' for the same referent, unlike the parallel Protego document (A.1.10.5.3.2.3.1) which consistently says 'Emergency Drop Spell' throughout.

**Suggested.** the Core Facilitator may temporarily grant an Operational Facilitator the sole authority to validate the authenticity of the Standby Spell pursuant to

### `A.1.9.1.3.2.4` — Medium
A.1 · `4627de70-9866-41b8-be8e-68e9ca809a45`

> may run firedrills to test the preparedness of individuals ... The results of firedrills shall be published

**Issue.** Body text spells "firedrills" as one word twice, inconsistent with the document's own heading title "Emergency Contact Mechanism Fire Drills" (two words) and with "fire drills" (two words) used elsewhere in the atlas.

**Suggested.** Replace "firedrills" with "fire drills" in both places to match the heading.

### `A.2.8.2.2.2.7.2.1` — Medium
A.2 · `e3ec99ec-54c9-4fe7-8104-aee20c57ec57`

> This includes 2 million USDS transferred from the Sky Ecosystem Liquidity Bootstrapping Budget to Spark to provide liquidity to market makers and 2.4 million USDS transferred from the Ecosystem Liquidity Bootstrapping Budget to Spark to provide liquidity to exchanges.

**Issue.** The same budget is named 'Sky Ecosystem Liquidity Bootstrapping Budget' and then 'the Ecosystem Liquidity Bootstrapping Budget' (missing 'Sky') within the same sentence/document.

**Suggested.** ...and 2.4 million USDS transferred from the Sky Ecosystem Liquidity Bootstrapping Budget to Spark to provide liquidity to exchanges.

### `A.3.2.2.1.1.1.1.1.3.3` — Medium
A.3 · `3b7924b2-1236-43cb-b0f0-ebe06f573b78`

> The Sensitivity Factor `K` is a tuning parameter indicating how quickly the correlations transition between $a$ and $b$.

**Issue.** The document's own heading calls this parameter "Sensitivity Coefficient", but the body calls it "Sensitivity Factor".

**Suggested.** The Sensitivity Coefficient `K` is a tuning parameter indicating how quickly the correlations transition between $a$ and $b$.

### `A.3.2.2.1.2.2.3` — Medium
A.3 · `295e4d3b-8c8a-4f74-879f-88060bb07803`

> The Code Complexity Rate $CCR$ is a measure of the complexity of the code of the smart contracts used by the protocol.

**Issue.** The document's own heading and every related subdocument call this "Code Complexity Rating", but this sentence calls it "Code Complexity Rate".

**Suggested.** The Code Complexity Rating $CCR$ is a measure of the complexity of the code of the smart contracts used by the protocol.

### `A.3.2.2.1.3.1.2` — Medium
A.3 · `368786cb-da80-4d48-a2e8-52d14fb6320c`

> The Starting Rate $\text{SR}$ is an initial risk rating for Administrative Risk before taking into account the Delay Factor and Lindy Adjustment Factor.

**Issue.** The document's own heading calls this parameter "Starting Rating", but the body and all three child documents call it "Starting Rate".

**Suggested.** The Starting Rating $\text{SR}$ is an initial risk rating for Administrative Risk before taking into account the Delay Factor and Lindy Adjustment Factor.

### `A.4.3` — Medium
A.4 · `c64a37d4-08a8-41bb-beae-4e976b6d0982`

> This Article regulates the rewards benefiting Dai users and USDS users for holding each Stablecoin. DAI users can access the legacy DAI Savings Rate Mechanism.

**Issue.** Same document refers to the same token/users first as "Dai" then as "DAI" (two different capitalizations within one document).

**Suggested.** Use "Dai" consistently: "...benefiting Dai users and USDS users... Dai users can access the legacy Dai Savings Rate Mechanism."

### `A.6.1.1.1.3.10.3` — Medium
A.6.1.1.1 · `56281438-63f9-46d4-a382-39a790a3bba1`

> voluntarily deposited by users into a Confidential Strategic Partnership and Deployment through preconfigured product functionality

**Issue.** Inconsistent naming: this document and its section otherwise consistently use "Confidential Strategic Integration(s) and Deployment(s)"; this instance swaps in "Partnership" for "Integration" for the same concept.

**Suggested.** voluntarily deposited by users into a Confidential Strategic Integration and Deployment through preconfigured product functionality

### `A.6.1.1.3.2.6.1.2.2.2.1.1.2` — Medium
A.6.1.1.3 · `2b42015c-c76a-4364-b8b5-c9a2b9f6f484`

> The Relayer role is the address(es) ... The Relayer Role has `can_execute_swap` and `can_reallocate` permissions. The Relayer Role may be granted...

**Issue.** Within the same paragraph, "Relayer role" and "Relayer Role" are capitalized inconsistently (lowercase in the first sentence, capitalized in the next two), unlike parallel Admin/Freezer role sections which stay lowercase throughout.

**Suggested.** Use consistent capitalization, e.g. "The Relayer role is ... The Relayer role has ... The Relayer role may be granted..."


## Duplication (1)

### `A.1.2.2.2.28` — Medium
A.1 · `e896e0f2-2156-4647-8e0d-8001140ae980`

> A Scenario’s Name should never be followed by a number unless there are multiple Scenarios with the same Name.

**Issue.** This exact sentence is duplicated verbatim within the same document, once under Components and again under Doc Identifier Rules.

**Suggested.** Remove the duplicate occurrence (keep it in one section only).

