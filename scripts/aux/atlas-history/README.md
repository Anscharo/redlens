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
  693,633 B). **Byte-verified 2026-07-06**: `sha256 = ff6053c6…8e97`, exactly the
  CID's sha2-256 digest (CIDv1 raw). Gotcha for any future gateway fetch:
  ipfs.io's Cloudflare layer **injects a per-request hidden `<a
  href="…/cdn-cgi/content?id=…">` honeypot after `<body>`** into text/html
  responses — strip it and re-verify the hash before trusting downloaded bytes
  (the first capture of this file contained one). The single hardest-to-replace
  anchor — keep it committed.
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
- **`prototypes/*.mjs`** — the measurement + gate scripts. **Prototype quality**:
  several hard-code session scratch paths (mips clone, genesis html) and read
  `public/history-html-era.json` + `public/docs.json`; parameterize before
  promoting into a real `scripts/prehist/` pipeline.

### Phase A pre-flight gate evidence (2026-07-06 — all four gates PASSED)

See `docs/plans/pre-git-history.md` ("Phase A pre-flight gates") for the gate
definitions and verdicts. Evidence files here:

- **`recovered/gate1-genesis-parse-audit.json`** (+ `prototypes/audit-genesis-parse.mjs`)
  — the 890-vs-"≈1,068" delta fully reconciled: 890 doc rows is complete; the
  extra `<dfn>`s are in-cell cross-reference citations + per-section header rows.
- **`recovered/gate2-bridge-corroboration.json`** (+ `prototypes/corroborate-bridge.mjs`)
  — all 115 non-tier-1 genesis→root pairs double-signed (113 two-signal locks,
  2 recorded adjudications); ambiguous/contained queues snapshotted.
- **`recovered/gate4-mip-calibration.json`** (+ `prototypes/build-calibration-sample.mjs`,
  review sheets `recovered/calibration-sample.md`, `recovered/calibration-extra.md`)
  — 74 labeled docs; precision 25/25 at ≥0.25, 35/36 at 0.05–0.25; auto-lock
  line calibrated to **≥0.05**; title-hits confirmed hint-only.
- Gate 3 (presentation traps) is a code-verification appendix in
  `pre-git-history.md` — exact file:line fix list, no data artifact.
