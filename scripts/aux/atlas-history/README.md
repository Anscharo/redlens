# Atlas history — recovery tooling & data

Offline enumerators (not part of `pnpm build`) plus the checked-in manifests they
produce, for reconstructing the **severed HTML-era** Atlas history
(≈2024-09 → 2025-05-28) that was garbage-collected from the `next-gen-atlas` repo
when it was re-initialized. Background and the recovery plan live in `docs/plans/`
(`atlas-prehistory-mips.md`, `forum-severed-era-history.md`, `html-era-history.md`,
`atlas-data-request.md`).

Each script writes its manifest **into this folder**, so script ↔ output stay together:

| Script | Output | Source |
|---|---|---|
| `enumerate-atlas-proposals.mjs` | `atlas-edit-proposals.json` | Sky forum Discourse API — the Atlas Edit proposal series |
| `enumerate-onchain-polls.mjs` | `atlas-onchain-polls.json` | Ethereum mainnet (Etherscan) — on-chain ratification polls + IPFS poll hashes |

## Run

```bash
# forum enumeration (no key needed)
node scripts/aux/atlas-history/enumerate-atlas-proposals.mjs

# on-chain poll enumeration (needs an Etherscan key)
node --env-file-if-exists=.env.local scripts/aux/atlas-history/enumerate-onchain-polls.mjs
```

On-chain history is immutable, so re-runs are deterministic apart from the `captured`
date. Both scripts cross-link the committed AEP files in
`vendor/next-gen-atlas/Atlas Edit Proposals/`.
