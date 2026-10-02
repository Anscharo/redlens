#!/usr/bin/env python3
"""gen_definitions.py — emit a SYNLANG Space from one Atlas "Definitions" section.

Reads the RedLens docs.json artifact ({atlasCommit, nodes}) and takes the direct
[Core] children of a Definitions section — the same gate as
scripts/required/build-glossary.mjs — writing one block of flat SYNLANG facts per
defined term:

    (: <slug> Term)
    (term <slug> "<display name>")
    (alias <slug> "<parenthetical alias>")        ; only when the title carries one
    (defined-at <slug> "<uuid>")                  ; provenance anchor (UUID, never doc_no)
    (defined-in <slug> <section-slug>)
    (content-hash <slug> "<parser sha256>")       ; staleness tripwire
    (definition <slug> "<verbatim content>")      ; prose as string data
    (mentions <slug> <other-slug>)                ; one per other defined term named in the prose

Deterministic: terms sorted by numeric doc_no segments, no timestamps, so a rerun
at the same atlasCommit is byte-identical. Stdlib only.

Usage:
    python3 apps/synlang/gen_definitions.py                     # A.0.1.1, local docs.json or the public endpoint
    python3 apps/synlang/gen_definitions.py --section <uuid> --out atlas/other.synlang
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DEFAULT_LOCAL = ROOT / "public" / "docs.json"
DEFAULT_URL = "https://atlas.redline.support/docs.json"
# A.0.1.1 "Definitions" — the doc_no is for humans; the UUID is the identity.
DEFAULT_SECTION = "c7d62f28-1d64-4632-8cd8-4f2b44c51bba"
DEFAULT_OUT = HERE / "atlas" / "definitions.synlang"

# Symbols a generated slug must never collide with: SYNLANG reserved atoms and
# built-in heads (reference/symbols, reference/functions, reference/operators),
# the always-on protocol heads, project directives, and the heads this file emits.
RESERVED = {
    "true", "false", "nil", "notreducible", "now", "error",
    "abs", "and", "apply", "assert", "assertequal", "assertnotequal", "car-atom",
    "case", "cdr-atom", "collapse", "cond", "cons", "decons-atom", "empty",
    "error-kind", "error-message", "filter", "first", "fold", "get-type", "if",
    "intersection-atom", "is-error", "length", "let", "let*", "map", "match",
    "max", "min", "not", "nth", "or", "quasiquote", "quote", "rest", "seq",
    "sha256", "sum", "superpose", "to-number", "type", "type-of", "unify",
    "union-atom", "unique-atom", "xor", "list", "lambda",
    "subclass-of", "instance-of", "declare-class", "tabled", "space", "query",
    "in", "import", "test", "realm", "add-space", "state-hash", "space-version",
    "belief-of", "provenance-of",
    "term", "alias", "definition", "defined-at", "defined-in", "content-hash",
    "mentions", "definitions-section", "section-title", "section-parent",
}


def load_docs(source: str) -> dict:
    if source.startswith("http://") or source.startswith("https://"):
        with urllib.request.urlopen(source, timeout=60) as resp:  # noqa: S310 — fixed public URL
            return json.load(resp)
    return json.loads(Path(source).read_text(encoding="utf-8"))


def docno_key(doc_no: str) -> list:
    return [int(seg) if seg.isdigit() else seg for seg in doc_no.split(".")]


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


_PAREN = re.compile(r"\s*\(([^()]*)\)\s*$")


def split_title(title: str) -> tuple[str, str | None]:
    """'Alignment Conserver (AC)' -> ('Alignment Conserver', 'AC')."""
    m = _PAREN.search(title)
    if not m:
        return title.strip(), None
    return title[: m.start()].strip(), m.group(1).strip() or None


def escape(s: str) -> str:
    """SYNLANG string literal escaping — the docs do not specify the rules, so this is
    the conservative C-style choice, verified by a parse round-trip (see README)."""
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def build_matchers(terms: list[dict]) -> list[tuple[str, re.Pattern, str]]:
    """Longest-first patterns over every term's display name (case-insensitive) and
    alias (case-sensitive — 'AC'/'AD'/'PRO' are too short to match loosely), each
    allowing a plural suffix."""
    pats = []
    for t in terms:
        pats.append((t["name"], re.compile(r"\b" + re.escape(t["name"]) + r"(?:e?s)?\b", re.IGNORECASE), t["slug"]))
        if t["alias"]:
            pats.append((t["alias"], re.compile(r"\b" + re.escape(t["alias"]) + r"(?:e?s)?\b"), t["slug"]))
    pats.sort(key=lambda p: (-len(p[0]), p[0]))
    return pats


def mentions_of(term: dict, pats: list[tuple[str, re.Pattern, str]]) -> list[str]:
    """Other terms named in this term's prose. A longer match consumes its span so
    'Operational Executor Agent' does not also register 'Executor Agent' and 'Agent';
    a term's own name is consumed but not reported."""
    consumed: list[tuple[int, int]] = []
    found: set[str] = set()
    for _name, rx, slug in pats:
        for m in rx.finditer(term["content"]):
            s, e = m.span()
            if any(s < ce and e > cs for cs, ce in consumed):
                continue
            consumed.append((s, e))
            if slug != term["slug"]:
                found.add(slug)
    return sorted(found)


def collect(docs: dict, section_id: str) -> tuple[dict, dict | None, list[dict]]:
    nodes = docs["nodes"]
    section = nodes.get(section_id)
    if section is None:  # runtime convenience: accept a doc_no on the command line
        section = next((n for n in nodes.values() if n.get("doc_no") == section_id), None)
    if section is None:
        sys.exit(f"section not found: {section_id}")
    parent = nodes.get(section.get("parentId") or "")
    kids = [n for n in nodes.values() if n.get("parentId") == section["id"] and n.get("type") == "Core"]
    kids.sort(key=lambda n: docno_key(n["doc_no"]))
    terms = []
    for n in kids:
        name, alias = split_title(n["title"])
        terms.append({
            "slug": slugify(name), "name": name, "alias": alias, "uuid": n["id"],
            "doc_no": n["doc_no"], "content": n["content"], "hash": n.get("contentHash", ""),
        })
    return section, parent, terms


def check(terms: list[dict]) -> None:
    seen: dict[str, str] = {}
    for t in terms:
        if not t["slug"]:
            sys.exit(f"empty slug for {t['doc_no']} {t['name']!r}")
        if t["slug"] in RESERVED:
            sys.exit(f"slug collides with a reserved SYNLANG symbol: {t['slug']} ({t['doc_no']})")
        if t["slug"] in seen:
            sys.exit(f"slug collision: {t['slug']} for {seen[t['slug']]} and {t['doc_no']}")
        seen[t["slug"]] = t["doc_no"]


def render(docs: dict, source: str, section: dict, parent: dict | None, terms: list[dict]) -> str:
    section_slug = slugify(((parent["title"] + " ") if parent else "") + section["title"])
    pats = build_matchers(terms)
    out: list[str] = []
    w = out.append
    w(";; GENERATED by apps/synlang/gen_definitions.py — do not edit by hand; rerun the script.")
    w(f";; Source: {source}")
    w(f";; atlasCommit: {docs.get('atlasCommit', 'unknown')}")
    w(f";; Section: {section['doc_no']} {section['title']} ({section['id']})")
    w(f";; {len(terms)} terms. Flat facts only; prose is string data, structure is queryable.")
    w("")
    w("(: Term Type)")
    w(f'(definitions-section {section_slug} "{section["id"]}")')
    w(f'(section-title {section_slug} "{escape(section["title"])}")')
    if parent:
        w(f'(section-parent {section_slug} "{parent["id"]}")')
    edges = 0
    for t in terms:
        w("")
        w(f";; {t['doc_no']} — {t['name']}" + (f" ({t['alias']})" if t["alias"] else ""))
        w(f"(: {t['slug']} Term)")
        w(f'(term {t["slug"]} "{escape(t["name"])}")')
        if t["alias"]:
            w(f'(alias {t["slug"]} "{escape(t["alias"])}")')
        w(f'(defined-at {t["slug"]} "{t["uuid"]}")')
        w(f"(defined-in {t['slug']} {section_slug})")
        if t["hash"]:
            w(f'(content-hash {t["slug"]} "{t["hash"]}")')
        w(f'(definition {t["slug"]} "{escape(t["content"])}")')
        for other in mentions_of(t, pats):
            w(f"(mentions {t['slug']} {other})")
            edges += 1
    w("")
    stats(terms, edges, pats)
    return "\n".join(out)


def stats(terms: list[dict], edges: int, pats) -> None:
    aliased = sum(1 for t in terms if t["alias"])
    indeg: dict[str, int] = {}
    for t in terms:
        for o in mentions_of(t, pats):
            indeg[o] = indeg.get(o, 0) + 1
    top = sorted(indeg.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
    print(f"terms: {len(terms)}  aliased: {aliased}  mentions edges: {edges}", file=sys.stderr)
    print("most mentioned: " + ", ".join(f"{s} ({n})" for s, n in top), file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default=None, help="docs.json path or URL (default: public/docs.json, else the public endpoint)")
    ap.add_argument("--section", default=DEFAULT_SECTION, help="Definitions section UUID (default: A.0.1.1's)")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()

    source = args.source or (str(DEFAULT_LOCAL) if DEFAULT_LOCAL.exists() else DEFAULT_URL)
    docs = load_docs(source)
    section, parent, terms = collect(docs, args.section)
    check(terms)
    text = render(docs, source if source.startswith("http") else str(Path(source).relative_to(ROOT)), section, parent, terms)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out} ({len(text.encode()) / 1024:.1f} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
