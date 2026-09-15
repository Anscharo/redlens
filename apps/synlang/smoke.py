#!/usr/bin/env python3
"""smoke.py — load the real encoding through the synlang library and assert what it must answer.

This is the integration gate (synlang test covers the rule shapes with toy data). It also
doubles as the "embed the engine in Python" demo: three files, one Space, plain queries.

Run:  apps/synlang/.venv/bin/python apps/synlang/smoke.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from synlang import Space, parse

HERE = Path(__file__).resolve().parent
SOURCES = [
    HERE / "atlas" / "definitions.synlang",
    HERE / "atlas" / "definitions-curated.synlang",
    HERE / "atlas" / "rules.synlang",
]

EXPECTED_TERMS = 56  # direct [Core] children of A.0.1.1 at the generated atlasCommit
EXPECTED_SCOPES = 6  # "There are six Scopes" — f30e56f9-da71-44bc-ab3b-9b13348794fe


def build() -> Space:
    space = Space()
    for src in SOURCES:
        for form in parse(src.read_text(encoding="utf-8")):
            space.add(form)
    return space


def q(space: Space, text: str) -> list[str]:
    return [r.canonical() for r in space.query(parse(text)[0])]


def main() -> int:
    space = build()
    failures: list[str] = []

    def check(label: str, ok: bool, detail: str = "") -> None:
        print(("PASS " if ok else "FAIL ") + label + (f"  ({detail})" if detail else ""))
        if not ok:
            failures.append(label)

    terms = q(space, "(: $t Term)")
    check("term count", len(terms) == EXPECTED_TERMS, f"{len(terms)} of {EXPECTED_TERMS}")

    check("alias AC resolves", q(space, '(alias $t "AC")') == ['(alias alignment-conserver "AC")'])
    check("lookup rule resolves an alias", any("scope-alignment-artifact" in r for r in q(space, '(lookup "Scope Artifact" $t)')))

    prov = q(space, "(defined-at slippery-slope-misalignment $uuid)")
    check("provenance UUID present", prov == ['(defined-at slippery-slope-misalignment "adf7ccb3-9ef0-43e0-90cc-6eb9d779f9cd")'], str(prov))

    scopes = q(space, "(instance-of $s scope)")
    check("six scopes", len(scopes) == EXPECTED_SCOPES, f"{len(scopes)}")

    derived = q(space, "(subclass-of operational-executor-agent agent)")
    check("derived grandparent class (never stated)", len(derived) == 1, str(derived))

    two_hop = q(space, "(subclass-of operational-executor-facilitator alignment-conserver)")
    check("derived two-hop class", len(two_hop) == 1, str(two_hop))

    mentions = q(space, "(mentions $t universal-alignment)")
    check("universal-alignment is mentioned by other definitions", len(mentions) >= 5, f"{len(mentions)}")

    reach = q(space, "(reaches-term slippery-slope-misalignment $x)")
    check("tabled closure reaches beyond direct mentions", len(reach) > len(q(space, "(mentions slippery-slope-misalignment $x)")), f"{len(reach)}")

    check("closed world: undefined term is empty", q(space, '(term $t "Risk Capital")') == [])

    errors = [r for r in terms if r.startswith("(Error")]
    check("no Error values", not errors, str(errors[:1]))

    print(f"\n{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
