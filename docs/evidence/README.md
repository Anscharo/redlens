# Duplicate ICD evidence packet

This folder is meant to be sent as-is.

| File | What it is |
|------|------------|
| `grove-curve-rlusd-usdc-icd-duplicate.md` | The finding: `A.6.1.1.2.2.6.1.3.1.6.1` and `…6.2` (Grove Curve RLUSD/USDC Pool ICDs) are the same 22-document tree. |
| `compare-atlas-trees.py` | Verifier. Python 3.8+, no pip packages. |

Re-run against an Atlas `content/` directory:

```bash
python3 compare-atlas-trees.py --self-test
python3 compare-atlas-trees.py --content /path/to/next-gen-atlas/content \
  A.6.1.1.2.2.6.1.3.1.6.1 \
  A.6.1.1.2.2.6.1.3.1.6.2
```

Exit `0` means the trees are still duplicates. The same file also lives at `scripts/aux/compare-atlas-trees.py` in the RedLens repo.
