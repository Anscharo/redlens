# Duplicate Grove ICD trees

Zip this folder and send it. Everything needed to read the finding and re-run the check is here.

## Files

| File | What it is |
|------|------------|
| `README.md` | This note |
| `report.md` | The finding |
| `compare-atlas-trees.py` | Verifier (Python 3.8+, no packages) |

## Re-run

Run the script from the **next-gen-atlas** repo root. It reads:

`./content/A.6.1.1.2 - Grove.md`

```bash
cd next-gen-atlas
python3 compare-atlas-trees.py --self-test
python3 compare-atlas-trees.py
```

Exit `0` means the two trees are still duplicates.

Default trees:

- `A.6.1.1.2.2.6.1.3.1.6.1`
- `A.6.1.1.2.2.6.1.3.1.6.2`
