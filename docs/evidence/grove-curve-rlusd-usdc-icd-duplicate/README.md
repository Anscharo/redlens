# Duplicate Instance Configuration Documents — Grove Curve RLUSD/USDC

Two Grove documents in the Atlas are copies of each other, including every child document under them.

| | Document A | Document B |
|---|------------|------------|
| Number | `A.6.1.1.2.2.6.1.3.1.6.1` | `A.6.1.1.2.2.6.1.3.1.6.2` |
| Title | Ethereum Mainnet - Curve RLUSD/USDC Pool Instance Configuration Document | same |
| UUID | `67b85f8a-3857-461d-a214-d3bf990f9111` | `f6501dc9-f8e9-4130-9390-a1d9f142fcc7` |
| Size | 22 documents (the root plus 21 children) | 22 documents, same shape |

They sit next to each other in `content/A.6.1.1.2 - Grove.md` (around lines 6316 and 6413).

The titles, types, bodies, and child structure match exactly. Only the document numbers and UUIDs differ — as they must, because every Atlas document is required to have its own number and UUID.

The live Instance points at document A (`A.6.1.1.2.2.6.1.1.2.1.6.1` links to it). Document B is not linked from anywhere else in Grove.

The pairing table, hashes, inbound links, and full text of each document are in `report.md`.

## How to verify

This folder includes a small Python script with no extra packages (Python 3.8+). Run it from the root of the next-gen-atlas repository so it can read Grove:

```bash
python3 compare-atlas-trees.py --self-test
python3 compare-atlas-trees.py
```

It compares the two trees in `./content/A.6.1.1.2 - Grove.md`. Exit code `0` means they still match under the rules above. `--self-test` checks the script against a built-in fixture first.

## Files in this folder

- `README.md` — this summary
- `report.md` — full evidence
- `compare-atlas-trees.py` — the check
