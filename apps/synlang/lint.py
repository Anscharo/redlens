#!/usr/bin/env python3
"""lint.py — engine-free syntax and shape check for the .synlang files in this folder.

The SYNLANG engine is not installable here, so this is the verification we can run:

  * every file tokenizes and parses as balanced S-expressions with closed strings
    (the generator's string escaping is exercised on all 56 definitions);
  * every (= lhs rhs) rule obeys the documented variable rule (V001): a right-hand
    variable not bound on the left is allowed only when the whole body is one
    top-level (and …) / (or …) / (not …);
  * every class named by subclass-of / instance-of was declared with declare-class
    earlier in load order (the protocols' documented precondition);
  * every !(query) head in the entrypoint is defined somewhere in the project's
    sources (the run-time view of V007), or is a protocol / type head;
  * per-head fact counts, so drift in the generated file is visible at a glance.

It is a checker for the shapes this project uses, not a SYNLANG implementation.
Run:  python3 apps/synlang/lint.py        (stdlib only; Python 3.9+)
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROTOCOL_HEADS = {"subclass-of", "instance-of", "declare-class", ":", "tabled"}
GUARD_HEADS = {"and", "or", "not"}


class Str(str):
    """A string literal, distinguished from a symbol."""


def tokenize(text: str):
    i, n, line = 0, len(text), 1
    while i < n:
        c = text[i]
        if c == "\n":
            line += 1
            i += 1
        elif c.isspace():
            i += 1
        elif c == ";":
            while i < n and text[i] != "\n":
                i += 1
        elif c in "()":
            yield c, c, line
            i += 1
        elif c == "!" and i + 1 < n and text[i + 1] == "(":
            yield "!", "!", line
            i += 1
        elif c == '"':
            j = i + 1
            while j < n and text[j] != '"':
                if text[j] == "\\":
                    j += 1
                elif text[j] == "\n":
                    line += 1
                j += 1
            if j >= n:
                raise SyntaxError(f"unterminated string starting at line {line}")
            yield "str", text[i + 1 : j], line
            i = j + 1
        else:
            j = i
            while j < n and not text[j].isspace() and text[j] not in '();"':
                j += 1
            yield "atom", text[i:j], line
            i = j


def parse(text: str) -> list:
    """Top-level forms as nested lists; queries are wrapped as ['!', form]."""
    forms: list = []
    stack: list = []
    pending_bang = False
    for kind, value, line in tokenize(text):
        if kind == "!":
            pending_bang = True
        elif kind == "(":
            node: list = []
            if pending_bang:
                node = ["!"]
                pending_bang = False
            stack.append(node)
        elif kind == ")":
            if not stack:
                raise SyntaxError(f"unmatched ')' at line {line}")
            node = stack.pop()
            (stack[-1] if stack else forms).append(node)
        else:
            item = Str(value) if kind == "str" else value
            if stack:
                stack[-1].append(item)
            else:
                raise SyntaxError(f"bare top-level token {value!r} at line {line}")
    if stack:
        raise SyntaxError(f"{len(stack)} unclosed '(' at end of file")
    return forms


def variables(node) -> set[str]:
    if isinstance(node, list):
        return set().union(*(variables(x) for x in node)) if node else set()
    return {node} if isinstance(node, str) and not isinstance(node, Str) and node.startswith("$") else set()


def head(form) -> str | None:
    if isinstance(form, list) and form and isinstance(form[0], str) and not isinstance(form[0], Str):
        return form[0]
    return None


def manifest_sources() -> tuple[list[Path], Path | None]:
    text = (HERE / "synlang.toml").read_text(encoding="utf-8")
    section = text.split("[synlang]", 1)[1].split("\n[", 1)[0]
    src = re.search(r"sources\s*=\s*\[(.*?)\]", section, re.S)
    entry = re.search(r'entrypoint\s*=\s*"([^"]+)"', section)
    sources = [HERE / s for s in re.findall(r'"([^"]+)"', src.group(1))] if src else []
    return sources, (HERE / entry.group(1)) if entry else None


def main() -> int:
    problems: list[str] = []
    sources, entrypoint = manifest_sources()
    test_files = sorted((HERE / "tests").glob("*.synlang"))
    all_files = sources + [f for f in test_files if f not in sources]

    parsed: dict[Path, list] = {}
    for f in all_files:
        try:
            parsed[f] = parse(f.read_text(encoding="utf-8"))
        except SyntaxError as e:
            problems.append(f"{f.relative_to(HERE)}: {e}")
    if problems:
        for p in problems:
            print("FAIL", p)
        return 1

    defined: set[str] = set(PROTOCOL_HEADS)
    declared: set[str] = set()
    counts: Counter = Counter()
    for f in sources:
        for form in parsed[f]:
            h = head(form)
            if h == "!":
                continue
            counts[(f.name, h)] += 1
            if h == "=":
                lhs, rhs = form[1], form[2]
                if head(lhs):
                    defined.add(head(lhs))
                fresh = variables(rhs) - variables(lhs)
                if fresh and head(rhs) not in GUARD_HEADS:
                    problems.append(f"{f.name}: rule {head(lhs)} has free right-hand variables {sorted(fresh)} outside an and/or/not body (V001)")
            elif h == "declare-class":
                declared.add(form[1])
            elif h == "subclass-of":
                for cls in form[1:3]:
                    if cls not in declared:
                        problems.append(f"{f.name}: (subclass-of {form[1]} {form[2]}) uses undeclared class {cls}")
            elif h == "instance-of":
                if form[2] not in declared:
                    problems.append(f"{f.name}: (instance-of {form[1]} {form[2]}) uses undeclared class {form[2]}")
            elif h == "tabled":
                defined.add(form[1])
            if h and h != "=":
                defined.add(h)

    # A query parses as ["!", head, args…] — the marker is spliced into the form's own list.
    queries = [form[1:] for form in parsed.get(entrypoint, []) if head(form) == "!"] if entrypoint else []
    for q in queries:
        if head(q) not in defined:
            problems.append(f"{entrypoint.name}: query head {head(q)!r} is not defined by any source")

    tests = sum(1 for f in test_files for form in parsed[f] if head(form) == "test")

    print(f"files parsed: {len(all_files)}  top-level forms: {sum(len(v) for v in parsed.values())}")
    for f in sources:
        per = sorted(((h, n) for (name, h), n in counts.items() if name == f.name), key=lambda x: (-x[1], str(x[0])))
        if per:
            print(f"  {f.name}: " + ", ".join(f"{h} {n}" for h, n in per))
    print(f"  {entrypoint.name if entrypoint else '-'}: {len(queries)} queries, all heads defined: {not any('query head' in p for p in problems)}")
    print(f"  tests: {tests} (test …) blocks in {len(test_files)} file(s)")
    for p in problems:
        print("FAIL", p)
    print("PASS" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
