#!/usr/bin/env python3
"""Compare two Atlas document trees for duplicate content.

Zero third-party dependencies. Requires Python 3.8+.

Run this script from the root of a next-gen-atlas checkout. It reads one Atlas
markdown file (default: ./content/A.6.1.1.2 - Grove.md). A document is a heading
that matches the Atlas title-line syntax, plus the body until the next such
heading. A tree is that document and every descendant whose document number is
that number plus a dotted suffix.

Two trees are duplicates when, after ignoring document number and UUID, every
corresponding node has the same title, type, and body.

    python3 compare-atlas-trees.py --self-test
    python3 compare-atlas-trees.py
    python3 compare-atlas-trees.py --out report.md

Exit codes:
    0  trees are duplicates
    1  trees differ
    2  usage / parse / missing-tree error
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

HEADING_RE = re.compile(
    r"^(#{1,6}) ([\w.-]+) - (.+?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->\s*$"
)
LINK_RE = re.compile(r"\[([^\]]+)\]\(([0-9a-f-]{36})\)")

DEFAULT_GROVE = "./content/A.6.1.1.2 - Grove.md"
DEFAULT_A = "A.6.1.1.2.2.6.1.3.1.6.1"
DEFAULT_B = "A.6.1.1.2.2.6.1.3.1.6.2"


@dataclass
class Node:
    doc_no: str
    title: str
    type: str
    uuid: str
    body: str
    file: str
    line: int

    def relative_key(self, root: str) -> str:
        if self.doc_no == root:
            return ""
        prefix = root + "."
        if not self.doc_no.startswith(prefix):
            raise ValueError(f"{self.doc_no} is not under {root}")
        return self.doc_no[len(prefix) :]

    def fingerprint(self) -> str:
        payload = f"{self.title}\n[{self.type}]\n{self.body}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def in_tree(doc_no: str, root: str) -> bool:
    return doc_no == root or doc_no.startswith(root + ".")


def find_grove(explicit: str | None) -> Path:
    p = Path(explicit).expanduser() if explicit else Path(DEFAULT_GROVE)
    if not p.is_file():
        sys.exit(
            f"error: {p} not found. Run this script from the next-gen-atlas "
            f"repo root (default path is {DEFAULT_GROVE}), or pass the Grove file."
        )
    return p.resolve()


def parse_file(path: Path) -> list[Node]:
    lines = path.read_text(encoding="utf-8").splitlines()
    name = path.name
    starts: list[tuple[int, re.Match[str]]] = []
    for i, line in enumerate(lines):
        m = HEADING_RE.match(line)
        if m:
            starts.append((i, m))
    nodes: list[Node] = []
    for idx, (start, m) in enumerate(starts):
        end = starts[idx + 1][0] if idx + 1 < len(starts) else len(lines)
        body_lines = lines[start + 1 : end]
        while body_lines and body_lines[-1] == "":
            body_lines.pop()
        if body_lines and body_lines[0] == "":
            body_lines = body_lines[1:]
        nodes.append(
            Node(
                doc_no=m.group(2),
                title=m.group(3),
                type=m.group(4),
                uuid=m.group(5),
                body="\n".join(body_lines),
                file=name,
                line=start + 1,
            )
        )
    return nodes


def tree_of(nodes: list[Node], root: str) -> list[Node]:
    found = [n for n in nodes if in_tree(n.doc_no, root)]
    found.sort(key=lambda n: [int(p) if p.isdigit() else p for p in n.doc_no.split(".")])
    return found


def _doc_no_mentioned(body: str, doc_no: str) -> bool:
    return re.search(r"(?<![\w])" + re.escape(doc_no) + r"(?![\w.-])", body) is not None


def inbound_refs(nodes: list[Node], tree: list[Node]) -> list[tuple[str, str, str]]:
    tree_uuids = {n.uuid for n in tree}
    tree_nos = {n.doc_no for n in tree}
    tree_ids = {n.uuid for n in tree}
    hits: list[tuple[str, str, str]] = []
    for n in nodes:
        if n.uuid in tree_ids:
            continue
        for title, uuid in LINK_RE.findall(n.body):
            if uuid in tree_uuids:
                hits.append((n.doc_no, n.title, f"link → {uuid} ({title})"))
        for uuid in tree_uuids:
            if uuid in n.body and not any(h[0] == n.doc_no and uuid in h[2] for h in hits):
                hits.append((n.doc_no, n.title, f"mentions UUID {uuid}"))
        for doc_no in sorted(tree_nos, key=len, reverse=True):
            if not _doc_no_mentioned(n.body, doc_no):
                continue
            if any(h[0] == n.doc_no and doc_no in h[2] for h in hits):
                continue
            hits.append((n.doc_no, n.title, f"mentions {doc_no}"))
    seen: set[tuple[str, str, str]] = set()
    out = []
    for h in hits:
        if h not in seen:
            seen.add(h)
            out.append(h)
    return out


def compare(a_root: str, a_tree: list[Node], b_root: str, b_tree: list[Node]) -> dict:
    a_map = {n.relative_key(a_root): n for n in a_tree}
    b_map = {n.relative_key(b_root): n for n in b_tree}
    keys_a, keys_b = set(a_map), set(b_map)
    only_a = sorted(keys_a - keys_b)
    only_b = sorted(keys_b - keys_a)
    shared = sorted(keys_a & keys_b, key=lambda k: k.split(".") if k else [""])

    pairs = []
    mismatches = []
    for key in shared:
        left, right = a_map[key], b_map[key]
        diffs = []
        if left.title != right.title:
            diffs.append("title")
        if left.type != right.type:
            diffs.append("type")
        if left.body != right.body:
            diffs.append("body")
        row = {
            "relative": key if key else "(root)",
            "a_doc_no": left.doc_no,
            "b_doc_no": right.doc_no,
            "title": left.title,
            "type": left.type,
            "a_uuid": left.uuid,
            "b_uuid": right.uuid,
            "diffs": diffs,
        }
        pairs.append(row)
        if diffs:
            mismatches.append(row)

    return {
        "identical": not only_a and not only_b and not mismatches and len(a_tree) > 0,
        "pairs": pairs,
        "only_a": only_a,
        "only_b": only_b,
        "mismatches": mismatches,
        "a_map": a_map,
        "b_map": b_map,
    }


def tree_fingerprint(tree: list[Node], root: str) -> str:
    parts = [f"{n.relative_key(root)}\t{n.title}\t{n.type}\t{n.body}" for n in tree]
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def atlas_revision(grove: Path) -> str:
    d = grove.parent
    for _ in range(8):
        if (d / ".git").exists():
            try:
                return subprocess.check_output(
                    ["git", "-C", str(d), "rev-parse", "HEAD"],
                    text=True,
                    stderr=subprocess.DEVNULL,
                ).strip()
            except Exception:
                return "unknown"
        if d.parent == d:
            break
        d = d.parent
    return "unknown"


def md_cell(s: str) -> str:
    return s.replace("|", "\\|")


def render_report(
    *,
    grove_name: str,
    atlas_sha: str,
    a_root: str,
    b_root: str,
    a_tree: list[Node],
    b_tree: list[Node],
    result: dict,
    inbound_a: list,
    inbound_b: list,
) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    sha_a = tree_fingerprint(a_tree, a_root)
    sha_b = tree_fingerprint(b_tree, b_root)
    verdict = (
        "YES — the two trees are duplicates"
        if result["identical"]
        else "NO — the two trees are not duplicates"
    )
    lines = [
        "# Atlas duplicate-tree evidence",
        "",
        f"Generated: {now}",
        f"Atlas file: `{grove_name}`",
        f"Atlas git commit: `{atlas_sha}`",
        "",
        "## Verdict",
        "",
        f"**{verdict}**",
        "",
        f"- Tree A: `{a_root}` — {len(a_tree)} documents",
        f"- Tree B: `{b_root}` — {len(b_tree)} documents",
        f"- Corresponding pairs: {len(result['pairs'])}",
        f"- Structure only in A: {len(result['only_a'])}",
        f"- Structure only in B: {len(result['only_b'])}",
        f"- Pairs with title/type/body differences: {len(result['mismatches'])}",
        "",
        "## What this means",
        "",
        "Every Atlas document has three identity fields that are *supposed* to be unique:",
        "",
        "1. **Document number** (e.g. `A.6.1.1.2.2.6.1.3.1.6.1` vs `…6.2`)",
        "2. **UUID** (permanent machine id in the heading comment)",
        "3. **Title, type, and body** — the actual text",
        "",
        "This check **ignores (1) and (2)** and asks: if you line the trees up by",
        "relative position (root, `.1`, `.1.1`, …), is the remaining text the same?",
        "",
        "If yes, the second tree is a copy of the first: same titles, same types,",
        "same bodies, same child shape. Only the numbers and UUIDs differ.",
        "",
        "## Fingerprints (title + type + body, document numbers and UUIDs removed)",
        "",
        f"- Tree A: `{sha_a}`",
        f"- Tree B: `{sha_b}`",
        "",
        "Matching fingerprints mean the concatenated relative shape + text of both",
        "trees is byte-identical.",
        "",
        "## Pairing table",
        "",
        "| # | relative | A document | B document | title | type | text match | A UUID | B UUID |",
        "|---|----------|------------|------------|-------|------|------------|--------|--------|",
    ]
    for i, row in enumerate(result["pairs"], 1):
        match = "yes" if not row["diffs"] else "NO: " + ", ".join(row["diffs"])
        lines.append(
            "| {i} | `{rel}` | `{a}` | `{b}` | {title} | {typ} | {match} | `{au}` | `{bu}` |".format(
                i=i,
                rel=row["relative"],
                a=row["a_doc_no"],
                b=row["b_doc_no"],
                title=md_cell(row["title"]),
                typ=row["type"],
                match=match,
                au=row["a_uuid"],
                bu=row["b_uuid"],
            )
        )
    if result["only_a"] or result["only_b"]:
        lines += ["", "## Shape differences"]
        if result["only_a"]:
            lines += ["", "Present only under A (relative keys):"]
            lines += [f"- `{k or '(root)'}`" for k in result["only_a"]]
        if result["only_b"]:
            lines += ["", "Present only under B (relative keys):"]
            lines += [f"- `{k or '(root)'}`" for k in result["only_b"]]
    if result["mismatches"]:
        lines += ["", "## Text differences"]
        for row in result["mismatches"]:
            key = "" if row["relative"] == "(root)" else row["relative"]
            left, right = result["a_map"][key], result["b_map"][key]
            lines += ["", f"### `{row['a_doc_no']}` vs `{row['b_doc_no']}`", ""]
            lines.append("Differ in: " + ", ".join(row["diffs"]))
            if "title" in row["diffs"]:
                lines.append(f"- A title: {left.title}")
                lines.append(f"- B title: {right.title}")
            if "body" in row["diffs"]:
                lines += ["", "A body:", "", "```", left.body, "```", "", "B body:", "", "```", right.body, "```"]

    lines += [
        "",
        f"## Source locations in `{grove_name}`",
        "",
        f"Tree A root: `{grove_name}:{a_tree[0].line}` (`{a_tree[0].uuid}`)" if a_tree else "Tree A: not found",
        f"Tree B root: `{grove_name}:{b_tree[0].line}` (`{b_tree[0].uuid}`)" if b_tree else "Tree B: not found",
        "",
        "## Inbound references (documents outside each tree that point at it)",
        "",
        "A duplicate that nothing else links to is an orphan copy. A duplicate that",
        "is also linked from an Instance is a live second ICD for the same pool.",
        "",
        f"### Links / mentions of tree A (`{a_root}`)",
        "",
    ]
    if inbound_a:
        for doc_no, title, how in inbound_a:
            lines.append(f"- `{doc_no}` — {title} — {how}")
    else:
        lines.append("_None._")
    lines += ["", f"### Links / mentions of tree B (`{b_root}`)", ""]
    if inbound_b:
        for doc_no, title, how in inbound_b:
            lines.append(f"- `{doc_no}` — {title} — {how}")
    else:
        lines.append("_None._")

    lines += [
        "",
        "## How to reproduce",
        "",
        "Python 3.8+, no packages. Run from the next-gen-atlas repo root:",
        "",
        "```bash",
        "python3 compare-atlas-trees.py --self-test",
        "python3 compare-atlas-trees.py",
        "```",
        "",
        f"Default file: `{DEFAULT_GROVE}`. Default trees: `{a_root}` and `{b_root}`.",
        "",
        "The script exits `0` only when the trees are duplicates under the rules above.",
        "",
        "## Bodies of every paired document",
        "",
        "Included so a reviewer does not have to open the Atlas. Each pair is shown",
        "once: the A body. The B body is identical when the row says `text match: yes`.",
        "",
    ]
    for row in result["pairs"]:
        key = "" if row["relative"] == "(root)" else row["relative"]
        node = result["a_map"][key]
        status = "identical on both trees" if not row["diffs"] else "DIFFERENT — see Text differences"
        lines += [
            f"### `{row['a_doc_no']}`  ↔  `{row['b_doc_no']}`",
            "",
            f"**{node.title}** \\[{node.type}\\] — {status}",
            "",
        ]
        if node.body:
            lines += ["```", node.body, "```", ""]
        else:
            lines += ["_Empty body._", ""]
    return "\n".join(lines) + "\n"


SELF_TEST_MD = """# A.1 - Root [Scope]  <!-- UUID: 11111111-1111-1111-1111-111111111111 -->

hello

## A.1.1 - Child [Core]  <!-- UUID: 22222222-2222-2222-2222-222222222222 -->

same text

# A.2 - Root [Scope]  <!-- UUID: 33333333-3333-3333-3333-333333333333 -->

hello

## A.2.1 - Child [Core]  <!-- UUID: 44444444-4444-4444-4444-444444444444 -->

same text
"""


def self_test() -> int:
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        grove = Path(td) / "grove.md"
        grove.write_text(SELF_TEST_MD, encoding="utf-8")
        nodes = parse_file(grove)
        a, b = tree_of(nodes, "A.1"), tree_of(nodes, "A.2")
        result = compare("A.1", a, "A.2", b)
        assert result["identical"] and len(result["pairs"]) == 2
        b[1].body = "different"
        result2 = compare("A.1", a, "A.2", b)
        assert not result2["identical"]
        assert result2["mismatches"][0]["diffs"] == ["body"]
    print("self-test: ok")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Confirm two Atlas document trees are duplicates. "
            "Run from the next-gen-atlas repo root."
        )
    )
    parser.add_argument(
        "grove",
        nargs="?",
        default=None,
        help=f"Atlas Grove markdown file (default: {DEFAULT_GROVE})",
    )
    parser.add_argument("doc_a", nargs="?", default=DEFAULT_A)
    parser.add_argument("doc_b", nargs="?", default=DEFAULT_B)
    parser.add_argument("--out", help="write markdown report to this path")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    grove = find_grove(args.grove)
    nodes = parse_file(grove)
    if not nodes:
        sys.stderr.write(f"error: no Atlas headings found in {grove.name}\n")
        return 2

    a_tree = tree_of(nodes, args.doc_a)
    b_tree = tree_of(nodes, args.doc_b)
    if not a_tree:
        sys.stderr.write(f"error: document {args.doc_a} not found in {grove.name}\n")
        return 2
    if not b_tree:
        sys.stderr.write(f"error: document {args.doc_b} not found in {grove.name}\n")
        return 2

    result = compare(args.doc_a, a_tree, args.doc_b, b_tree)
    report = render_report(
        grove_name=DEFAULT_GROVE if args.grove is None else str(Path(args.grove)),
        atlas_sha=atlas_revision(grove),
        a_root=args.doc_a,
        b_root=args.doc_b,
        a_tree=a_tree,
        b_tree=b_tree,
        result=result,
        inbound_a=inbound_refs(nodes, a_tree),
        inbound_b=inbound_refs(nodes, b_tree),
    )

    if args.quiet:
        status = "DUPLICATE" if result["identical"] else "NOT_DUPLICATE"
        print(
            f"{status} {args.doc_a} ({len(a_tree)} docs) vs {args.doc_b} ({len(b_tree)} docs); "
            f"pairs={len(result['pairs'])} mismatches={len(result['mismatches'])} "
            f"only_a={len(result['only_a'])} only_b={len(result['only_b'])}"
        )
    else:
        sys.stdout.write(report)

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(report, encoding="utf-8")
        sys.stderr.write(f"wrote {out_path}\n")

    return 0 if result["identical"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except BrokenPipeError:
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(0)
