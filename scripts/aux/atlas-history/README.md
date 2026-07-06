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

## Collected data (2026-07-06)

Added while measuring the MIP → genesis → current lineage and the forum-parser
feasibility (results baked into `docs/plans/pre-git-history.md`):

- **`recovered/genesis-2024-09-02.html`** — the Atlas v2 genesis snapshot fetched
  from the poll-#25010 IPFS CID (`bafkreih7mbj4npqhxeprzk7sahpqjrajmxursaenzqgxdw5uo7sz554os4`,
  693,903 B). The single hardest-to-replace anchor — keep it committed.
- **`recovered/mip-corpus.json`** — 1,076 sections extracted from the 13
  atlas-track MIPs (MIP101 + five BMAAs core; MIP102/103/105/109–112 adjacent),
  final frozen state of `sky-ecosystem/mips` (2024-09-05).
- **`recovered/mip-genesis-lineage.json`** — per-genesis-doc lineage record: MIP
  attribution (file + § + containment scores), genesis→`4e931dfd` bridge result,
  resolved uuid, seam, alive-today flag.
- **`recovered/mip-section-dates.json`** — first-appearance date per matched MIP
  section (from `git log --reverse -S` over the mips clone).
- **`recovered/forum-coverage.json`** — per-proposal parse stats + severed-born
  coverage summary.
- **`severed-proposals/*.md`** — raw markdown of all 29 severed-window Atlas Edit
  cycle proposals (`forum.skyeco.com/raw/<id>/1`; note `26262` continues in post
  2, not yet fetched).
- **`prototypes/*.mjs`** — the five measurement scripts. **Prototype quality**:
  they hard-code session scratch paths (mips clone, genesis html) and read
  `public/history-html-era.json` + `public/docs.json`; parameterize before
  promoting into a real `scripts/prehist/` pipeline.
