# Atlas duplicate-tree evidence

Generated: 2026-08-26 10:59 UTC
Atlas file: `./content/A.6.1.1.2 - Grove.md`
Atlas git commit: `9ba9246a30ceb1fcb69f5c3bee8d54a76fc87d74`

## Verdict

**YES — the two trees are duplicates**

- Tree A: `A.6.1.1.2.2.6.1.3.1.6.1` — 22 documents
- Tree B: `A.6.1.1.2.2.6.1.3.1.6.2` — 22 documents
- Corresponding pairs: 22
- Structure only in A: 0
- Structure only in B: 0
- Pairs with title/type/body differences: 0

## What this means

Every Atlas document has three identity fields that are *supposed* to be unique:

1. **Document number** (e.g. `A.6.1.1.2.2.6.1.3.1.6.1` vs `…6.2`)
2. **UUID** (permanent machine id in the heading comment)
3. **Title, type, and body** — the actual text

This check **ignores (1) and (2)** and asks: if you line the trees up by
relative position (root, `.1`, `.1.1`, …), is the remaining text the same?

If yes, the second tree is a copy of the first: same titles, same types,
same bodies, same child shape. Only the numbers and UUIDs differ.

## Fingerprints (title + type + body, document numbers and UUIDs removed)

- Tree A: `eba6c737240dea7421388c2aa811a381e873cee7aeefb934df3b379669015a46`
- Tree B: `eba6c737240dea7421388c2aa811a381e873cee7aeefb934df3b379669015a46`

Matching fingerprints mean the concatenated relative shape + text of both
trees is byte-identical.

## Pairing table

| # | relative | A document | B document | title | type | text match | A UUID | B UUID |
|---|----------|------------|------------|-------|------|------------|--------|--------|
| 1 | `(root)` | `A.6.1.1.2.2.6.1.3.1.6.1` | `A.6.1.1.2.2.6.1.3.1.6.2` | Ethereum Mainnet - Curve RLUSD/USDC Pool Instance Configuration Document | Core | yes | `67b85f8a-3857-461d-a214-d3bf990f9111` | `f6501dc9-f8e9-4130-9390-a1d9f142fcc7` |
| 2 | `1` | `A.6.1.1.2.2.6.1.3.1.6.1.1` | `A.6.1.1.2.2.6.1.3.1.6.2.1` | RRC Framework Full Implementation Coverage | Core | yes | `f457fb43-c250-4111-b370-3e875e13db65` | `438f0f65-8e66-40c6-a17b-b861d57da301` |
| 3 | `2` | `A.6.1.1.2.2.6.1.3.1.6.1.2` | `A.6.1.1.2.2.6.1.3.1.6.2.2` | Parameters | Core | yes | `ef903d8d-08fe-4be2-b68f-adb87d7449e3` | `23317c4d-a0ce-48c5-b2ac-7ce4cd93cf83` |
| 4 | `2.1` | `A.6.1.1.2.2.6.1.3.1.6.1.2.1` | `A.6.1.1.2.2.6.1.3.1.6.2.2.1` | Instance Identifiers | Core | yes | `49528c46-1220-46a7-b693-cf0433129077` | `987eb2cc-420e-40d7-b5b2-31452ed7bcc7` |
| 5 | `2.1.1` | `A.6.1.1.2.2.6.1.3.1.6.1.2.1.1` | `A.6.1.1.2.2.6.1.3.1.6.2.2.1.1` | Network | Core | yes | `4b77a1d9-18bc-4144-ad5f-8b1bdf2974db` | `a4fa782e-587c-46d5-b2d0-4a77d778ab07` |
| 6 | `2.1.2` | `A.6.1.1.2.2.6.1.3.1.6.1.2.1.2` | `A.6.1.1.2.2.6.1.3.1.6.2.2.1.2` | Target Protocol | Core | yes | `d7ad7cbd-774d-4ef7-b35c-897e1d66b766` | `e727e42d-e275-4122-9ba0-fe98bb7eedcf` |
| 7 | `2.1.3` | `A.6.1.1.2.2.6.1.3.1.6.1.2.1.3` | `A.6.1.1.2.2.6.1.3.1.6.2.2.1.3` | Asset Supplied By Grove Liquidity Layer | Core | yes | `aadd33fa-45a8-4df8-963a-2ee40ea6075b` | `7b685931-6f16-40b5-ae0e-86c46751da93` |
| 8 | `2.1.4` | `A.6.1.1.2.2.6.1.3.1.6.1.2.1.4` | `A.6.1.1.2.2.6.1.3.1.6.2.2.1.4` | Token | Core | yes | `b787771e-42f4-4a11-b683-1be8d536546c` | `8bc9fd15-00f7-44c5-b48d-1916ea567117` |
| 9 | `2.2` | `A.6.1.1.2.2.6.1.3.1.6.1.2.2` | `A.6.1.1.2.2.6.1.3.1.6.2.2.2` | Contract Addresses | Core | yes | `3a2d436e-e498-46ae-aa93-5eaf2b1c3adf` | `8aecdc5f-0f1a-4394-9306-a60c2f7daf69` |
| 10 | `2.2.1` | `A.6.1.1.2.2.6.1.3.1.6.1.2.2.1` | `A.6.1.1.2.2.6.1.3.1.6.2.2.2.1` | Pool Address | Core | yes | `869f4a71-5a20-4e34-b718-cfe844630475` | `ef88cdfb-f431-4897-b9e6-11a16c6b8188` |
| 11 | `2.2.2` | `A.6.1.1.2.2.6.1.3.1.6.1.2.2.2` | `A.6.1.1.2.2.6.1.3.1.6.2.2.2.2` | Underlying Asset Address | Core | yes | `29aee46d-b94b-4402-ba84-2029422965e6` | `c3b33e2f-23b6-42f9-a6d7-abb5372217ae` |
| 12 | `2.2.3` | `A.6.1.1.2.2.6.1.3.1.6.1.2.2.3` | `A.6.1.1.2.2.6.1.3.1.6.2.2.2.3` | Underlying Asset Address | Core | yes | `bcb5e6e4-1616-4e0f-96d5-a08d4c4dda84` | `f1c52fdb-5856-4fce-b99e-6cbcc13296b1` |
| 13 | `2.3` | `A.6.1.1.2.2.6.1.3.1.6.1.2.3` | `A.6.1.1.2.2.6.1.3.1.6.2.2.3` | Rate Limit IDs | Core | yes | `5c5d80a6-c0cc-491c-9e4b-75480d2a7a30` | `8b1cc07a-58fd-4657-99c7-e1feecc13ab3` |
| 14 | `2.3.1` | `A.6.1.1.2.2.6.1.3.1.6.1.2.3.1` | `A.6.1.1.2.2.6.1.3.1.6.2.2.3.1` | Inflow RateLimitID | Core | yes | `385325de-b8c3-4e9f-96ee-c8499fca7848` | `6cff8544-7a7d-43a6-8db6-3f2b1939b656` |
| 15 | `2.3.2` | `A.6.1.1.2.2.6.1.3.1.6.1.2.3.2` | `A.6.1.1.2.2.6.1.3.1.6.2.2.3.2` | Outflow RateLimitID | Core | yes | `4f630380-8ca6-4ce6-9482-9af88826ea07` | `e5752190-a5a0-4d6f-9738-b07898e0dccb` |
| 16 | `2.3.3` | `A.6.1.1.2.2.6.1.3.1.6.1.2.3.3` | `A.6.1.1.2.2.6.1.3.1.6.2.2.3.3` | Swap RateLimitID | Core | yes | `3edab299-1530-48bb-9c89-0a2aee6902ce` | `d2d15203-f105-401f-8d0b-19f67771fb1e` |
| 17 | `2.4` | `A.6.1.1.2.2.6.1.3.1.6.1.2.4` | `A.6.1.1.2.2.6.1.3.1.6.2.2.4` | Rate Limits | Core | yes | `d9cb1721-0f26-41db-a929-4725ac227d3e` | `c9ac1f48-8dbf-4c72-8a77-27c6e8863a83` |
| 18 | `2.4.1` | `A.6.1.1.2.2.6.1.3.1.6.1.2.4.1` | `A.6.1.1.2.2.6.1.3.1.6.2.2.4.1` | Deposit Rate Limits | Core | yes | `172836ec-2f76-4e64-96db-fb60c9885d12` | `84d948f0-8a23-4710-a6d4-8fc094befc91` |
| 19 | `2.4.2` | `A.6.1.1.2.2.6.1.3.1.6.1.2.4.2` | `A.6.1.1.2.2.6.1.3.1.6.2.2.4.2` | Withdrawal Rate Limits | Core | yes | `a3a60b38-055f-42e4-b35d-bb04eb829b67` | `91eeb3a6-3b06-4e33-b835-51614136ce2e` |
| 20 | `2.4.3` | `A.6.1.1.2.2.6.1.3.1.6.1.2.4.3` | `A.6.1.1.2.2.6.1.3.1.6.2.2.4.3` | Swap Rate Limits | Core | yes | `511cec98-4c5b-488e-8b5b-c088d04cd46b` | `8885e8e3-1ab5-4b0a-998c-07e692db7054` |
| 21 | `2.5` | `A.6.1.1.2.2.6.1.3.1.6.1.2.5` | `A.6.1.1.2.2.6.1.3.1.6.2.2.5` | Off-chain Operational Parameters | Core | yes | `8dbe4e53-e70b-4b52-b607-558e9b023b56` | `fb386f16-e7f8-4cba-b10f-346c0e19b8f1` |
| 22 | `3` | `A.6.1.1.2.2.6.1.3.1.6.1.3` | `A.6.1.1.2.2.6.1.3.1.6.2.3` | Instance-specific Operational Processes | Core | yes | `7a0d7698-5f64-47f8-b81e-c2e71e6e15dc` | `502790de-8ab5-4359-86e0-d40b8ceda9ff` |

## Source locations in `./content/A.6.1.1.2 - Grove.md`

Tree A root: `./content/A.6.1.1.2 - Grove.md:6316` (`67b85f8a-3857-461d-a214-d3bf990f9111`)
Tree B root: `./content/A.6.1.1.2 - Grove.md:6413` (`f6501dc9-f8e9-4130-9390-a1d9f142fcc7`)

## Inbound references (documents outside each tree that point at it)

A duplicate that nothing else links to is an orphan copy. A duplicate that
is also linked from an Instance is a live second ICD for the same pool.

### Links / mentions of tree A (`A.6.1.1.2.2.6.1.3.1.6.1`)

- `A.6.1.1.2.2.6.1.1.2.1.6.1` — Ethereum Mainnet - Curve RLUSD/USDC Pool Instance Configuration Document Location — link → 67b85f8a-3857-461d-a214-d3bf990f9111 (A.6.1.1.2.2.6.1.3.1.6.1 - Ethereum Mainnet - Curve RLUSD/USDC Pool Instance Configuration Document)

### Links / mentions of tree B (`A.6.1.1.2.2.6.1.3.1.6.2`)

_None._

## How to reproduce

Python 3.8+, no packages. Run from the next-gen-atlas repo root:

```bash
python3 compare-atlas-trees.py --self-test
python3 compare-atlas-trees.py
```

Default file: `./content/A.6.1.1.2 - Grove.md`. Default trees: `A.6.1.1.2.2.6.1.3.1.6.1` and `A.6.1.1.2.2.6.1.3.1.6.2`.

The script exits `0` only when the trees are duplicates under the rules above.

## Bodies of every paired document

Included so a reviewer does not have to open the Atlas. Each pair is shown
once: the A body. The B body is identical when the row says `text match: yes`.

### `A.6.1.1.2.2.6.1.3.1.6.1`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2`

**Ethereum Mainnet - Curve RLUSD/USDC Pool Instance Configuration Document** \[Core\] — identical on both trees

```
The documents herein contain the Instance Configuration Document for the Curve RLUSD/USDC Pool Instance.
```

### `A.6.1.1.2.2.6.1.3.1.6.1.1`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.1`

**RRC Framework Full Implementation Coverage** \[Core\] — identical on both trees

```
**`Pending`**
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2`

**Parameters** \[Core\] — identical on both trees

```
The documents herein define the parameters of the Curve RLUSD/USDC Pool Instance of the Allocation System Primitive.
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.1`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.1`

**Instance Identifiers** \[Core\] — identical on both trees

```
The documents herein define the Instance identifiers.
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.1.1`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.1.1`

**Network** \[Core\] — identical on both trees

```
Ethereum Mainnet
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.1.2`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.1.2`

**Target Protocol** \[Core\] — identical on both trees

```
Curve
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.1.3`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.1.3`

**Asset Supplied By Grove Liquidity Layer** \[Core\] — identical on both trees

```
RLUSD and USDC
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.1.4`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.1.4`

**Token** \[Core\] — identical on both trees

```
RLUSD/USDC
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.2`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.2`

**Contract Addresses** \[Core\] — identical on both trees

```
The documents herein define the Instance contract addresses.
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.2.1`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.2.1`

**Pool Address** \[Core\] — identical on both trees

```
`0xD001aE433f254283FeCE51d4ACcE8c53263aa186`
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.2.2`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.2.2`

**Underlying Asset Address** \[Core\] — identical on both trees

```
`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.2.3`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.2.3`

**Underlying Asset Address** \[Core\] — identical on both trees

```
`0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD`
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.3`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.3`

**Rate Limit IDs** \[Core\] — identical on both trees

```
The specific `RateLimitID`(s) for this conduit’s inflow, outflow and swap are defined in the subdocuments herein.
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.3.1`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.3.1`

**Inflow RateLimitID** \[Core\] — identical on both trees

```
The inflow RateLimitID is: N/A - swap only.
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.3.2`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.3.2`

**Outflow RateLimitID** \[Core\] — identical on both trees

```
The outflow RateLimitID is: N/A - swap only.
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.3.3`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.3.3`

**Swap RateLimitID** \[Core\] — identical on both trees

```
The swap RateLimitID is: `0x8dcb7a359e6824ce9fd1c1f50ba67cd468764f690da2589aa3c262ac142c333a`.
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.4`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.4`

**Rate Limits** \[Core\] — identical on both trees

```
The current `maxAmount`, `slope` and `maxSlippage` for this conduit’s inflow/outflow/swap are defined in the subdocuments herein.
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.4.1`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.4.1`

**Deposit Rate Limits** \[Core\] — identical on both trees

```
The deposit rate limits are:

- `maxAmount`: N/A - swap only
- `slope`: N/A - swap only
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.4.2`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.4.2`

**Withdrawal Rate Limits** \[Core\] — identical on both trees

```
The withdrawal rate limits are:

- `maxAmount`: N/A - swap only
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.4.3`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.4.3`

**Swap Rate Limits** \[Core\] — identical on both trees

```
The swap rate limits are:

- `maxAmount`: 20 million
- `slope`: 100 million per day
- `maxSlippage`: 0.1%
```

### `A.6.1.1.2.2.6.1.3.1.6.1.2.5`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.2.5`

**Off-chain Operational Parameters** \[Core\] — identical on both trees

```
The documents herein contain specific off-chain parameters for this Instance.
```

### `A.6.1.1.2.2.6.1.3.1.6.1.3`  ↔  `A.6.1.1.2.2.6.1.3.1.6.2.3`

**Instance-specific Operational Processes** \[Core\] — identical on both trees

```
The documents herein contain operational procedures or monitoring requirements unique to this Instance that deviate from or otherwise supplement the general Grove Liquidity Layer processes.
```

