# Duplicate Grove ICD trees

Zip this folder and send it. Everything needed to read the finding and re-run the check is here, except the Atlas file.

## Files

| File | What it is |
|------|------------|
| `README.md` | This note |
| `report.md` | The finding |
| `compare-atlas-trees.py` | Verifier (Python 3.8+, no packages) |

## Re-run

Save the Atlas Grove document as `grove.md` in this folder.

```bash
python3 compare-atlas-trees.py --self-test
python3 compare-atlas-trees.py
```

Exit `0` means the two trees are still duplicates.

Default trees:

- `A.6.1.1.2.2.6.1.3.1.6.1`
- `A.6.1.1.2.2.6.1.3.1.6.2`
