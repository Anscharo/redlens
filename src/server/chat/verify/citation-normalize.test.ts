// Property tests for reference-style citation normalization. The last test is
// the one that verifies the module's actual purpose: the checking layer must
// produce the SAME report for a reference-style answer and its inline twin.
import { test, expect } from "bun:test";
import { loadIndexes } from "../../retrieval/indexes.ts";
import { expandReferenceLinks } from "./citation-normalize.ts";
import { runDeterministicChecks } from "./verify-checks.ts";

const ix = loadIndexes();
const A = "a1b2c3d4-1111-2222-3333-444455556666";
const B = "b9c8d7e6-9999-8888-7777-666655554444";

const expand = (s: string) => expandReferenceLinks(s).content;

test("inline-only answers pass through byte-identical", () => {
  const answer = [
    "# Heading",
    "",
    `The Spark supply rate is 5% per [Spark Rate](/atlas/${A}).`,
    "",
    `See also [Keel Accord](/atlas/${B}) and an [external](https://example.com) link.`,
  ].join("\n");
  expect(expand(answer)).toBe(answer);
  const r = expandReferenceLinks(answer);
  expect(r.definitions.size).toBe(0);
  expect(r.undefinedLabels).toEqual([]);
  expect(r.unusedLabels).toEqual([]);
});

test("definition block at the top expands and is removed", () => {
  const answer = [`[spark-rate]: /atlas/${A}`, `[keel-accord]: /atlas/${B}`, "", "The rate is [5%][spark-rate] under the [Keel Accord][keel-accord]."].join("\n");
  expect(expand(answer)).toBe(`The rate is [5%](/atlas/${A}) under the [Keel Accord](/atlas/${B}).`);
  const r = expandReferenceLinks(answer);
  expect([...r.definitions]).toEqual([["spark-rate", `/atlas/${A}`], ["keel-accord", `/atlas/${B}`]]);
  expect(r.unusedLabels).toEqual([]);
});

test("definitions at the bottom, and interleaved, expand the same way", () => {
  const bottom = ["The rate is [5%][spark-rate].", "", `[spark-rate]: /atlas/${A}`].join("\n");
  const interleaved = ["The rate is [5%][spark-rate].", "", `[spark-rate]: /atlas/${A}`, "", "And more prose follows here."].join("\n");
  expect(expand(bottom)).toBe(`The rate is [5%](/atlas/${A}).`);
  expect(expand(interleaved)).toBe(`The rate is [5%](/atlas/${A}).\n\nAnd more prose follows here.`);
});

test("label matching is case-insensitive and whitespace-normalized", () => {
  const answer = [`[Spark   Rate]: /atlas/${A}`, "", "It is [5%][spark rate] today."].join("\n");
  expect(expand(answer)).toBe(`It is [5%](/atlas/${A}) today.`);
  expect(expandReferenceLinks(answer).unusedLabels).toEqual([]);
});

test("mixed inline + reference links in one answer", () => {
  const answer = [`[keel-accord]: /atlas/${B}`, "", `Inline [Spark Rate](/atlas/${A}) beside a reference [Keel Accord][keel-accord].`].join("\n");
  expect(expand(answer)).toBe(`Inline [Spark Rate](/atlas/${A}) beside a reference [Keel Accord](/atlas/${B}).`);
});

test("expansion is idempotent", () => {
  const inputs = [
    [`[a]: /atlas/${A}`, `[b]: /atlas/${B}`, "", "Both [5%][a] and [range][a, b] and [nope][missing] and [20 percentage points] apply."].join("\n"),
    `Plain inline [X](/atlas/${A}) only.`,
    "No citations at all, just prose with [sic] in it.",
  ];
  for (const input of inputs) {
    const once = expand(input);
    expect(expand(once)).toBe(once);
  }
});

test("undefined label ships as plain text, never as raw brackets", () => {
  const answer = [`[a]: /atlas/${A}`, "", "Per [the rules][missing-label] it is [5%][a]."].join("\n");
  const r = expandReferenceLinks(answer);
  expect(r.content).toBe(`Per the rules it is [5%](/atlas/${A}).`);
  expect(r.content).not.toContain("[the rules]");
  expect(r.undefinedLabels).toEqual(["missing-label"]);
});

test("shortcut reference [label] with a definition becomes a real link, not stripped", () => {
  // CommonMark shortcut reference: remark renders this as a live <a>, so
  // stripping it would hide a clickable citation from every check.
  const answer = [`[spark-rate]: /atlas/${A}`, "", "The rate is defined in [spark-rate] and applies broadly."].join("\n");
  const r = expandReferenceLinks(answer);
  expect(r.content).toBe(`The rate is defined in [spark-rate](/atlas/${A}) and applies broadly.`);
  expect(r.unusedLabels).toEqual([]);
  // Multi-token labels resolve too — the strip heuristic must not preempt them.
  const spaced = [`[Keel Accord]: /atlas/${B}`, "", "Set under the [Keel Accord] today."].join("\n");
  expect(expand(spaced)).toBe(`Set under the [Keel Accord](/atlas/${B}) today.`);
});

test("collapsed reference [text][] resolves, or strips when undefined", () => {
  const defined = [`[keel accord]: /atlas/${B}`, "", "See the [Keel Accord][] today."].join("\n");
  expect(expand(defined)).toBe(`See the [Keel Accord](/atlas/${B}) today.`);
  const undef = [`[a]: /atlas/${A}`, "", "See the [Keel Accord][] today."].join("\n");
  const r = expandReferenceLinks(undef);
  expect(r.content).toBe("See the Keel Accord today.");
  expect(r.undefinedLabels).toEqual(["keel accord"]);
});

test("unused labels are reported without altering the content", () => {
  const answer = [`[a]: /atlas/${A}`, `[b]: /atlas/${B}`, "", "Only [5%][a] is cited."].join("\n");
  const r = expandReferenceLinks(answer);
  expect(r.content).toBe(`Only [5%](/atlas/${A}) is cited.`);
  expect(r.unusedLabels).toEqual(["b"]);
});

test("malformed shape 1: comma-separated label list becomes consecutive links", () => {
  const answer = [`[a]: /atlas/${A}`, `[b]: /atlas/${B}`, "", "The range fell [95% down to 75%][a, b] overall."].join("\n");
  const r = expandReferenceLinks(answer);
  expect(r.content).toBe(`The range fell [95% down to 75%](/atlas/${A}) [95% down to 75%](/atlas/${B}) overall.`);
  expect(r.unusedLabels).toEqual([]);
});

test("malformed shape 1: a partially-resolvable label list is an undefined label", () => {
  const answer = [`[a]: /atlas/${A}`, "", "The range fell [95% down to 75%][a, bogus] overall."].join("\n");
  const r = expandReferenceLinks(answer);
  expect(r.content).toBe("The range fell 95% down to 75% overall.");
  expect(r.undefinedLabels).toEqual(["a, bogus"]);
});

test("malformed shape 2: bare shortcut brackets are stripped", () => {
  const answer = [`[a]: /atlas/${A}`, "", "A range of [20 percentage points] applies to [5%][a]."].join("\n");
  expect(expand(answer)).toBe(`A range of 20 percentage points applies to [5%](/atlas/${A}).`);
});

test("legitimate bracket prose survives normalization", () => {
  const answer = [
    `[a]: /atlas/${A}`,
    "",
    "Evidence [E1] and [sic] and [A.1.6] and a footnote [^1] all stay.",
    "- [ ] a task item",
    "- [x] a done item",
    "> The rate fell [emphasis added] to 75 percent per the source.",
    'The doc says "the rate [of return] is fixed" verbatim.',
    `Cited as [5%][a].`,
  ].join("\n");
  const out = expand(answer);
  for (const keep of ["[E1]", "[sic]", "[A.1.6]", "[^1]", "- [ ]", "- [x]", "[emphasis added]", "[of return]"]) {
    expect(out).toContain(keep);
  }
  expect(out).toContain(`[5%](/atlas/${A})`);
});

test("bare brackets are left alone when the answer uses no reference style", () => {
  const answer = `A range of [20 percentage points] applies per [Doc](/atlas/${A}).`;
  expect(expand(answer)).toBe(answer);
});

test("fenced code blocks are left untouched", () => {
  const answer = [
    `[a]: /atlas/${A}`,
    "",
    "Reference syntax looks like this:",
    "",
    "```markdown",
    `[label]: /atlas/${B}`,
    "The rate is [5%][label].",
    "```",
    "",
    "Which renders as [5%][a].",
  ].join("\n");
  const out = expand(answer);
  expect(out).toContain(`[label]: /atlas/${B}`);
  expect(out).toContain("The rate is [5%][label].");
  expect(out).toContain(`Which renders as [5%](/atlas/${A}).`);
});

test("inline code spans are left untouched even when reference style is in play", () => {
  // A definition puts the pass in reference mode and defines `spark-rate`, but
  // the answer also SHOWS the bracket syntax as a literal inline-code example.
  // The code must survive verbatim; only the real reference use expands.
  const answer = [
    `[spark-rate]: /atlas/${A}`,
    "",
    "Cite a shortcut like `[spark-rate]` and it renders as [spark-rate].",
  ].join("\n");
  const out = expand(answer);
  expect(out).toContain("`[spark-rate]`"); // literal example untouched
  expect(out).toContain(`renders as [spark-rate](/atlas/${A}).`); // real use expanded
});

test("prose lines that look like definitions but have no URL destination survive", () => {
  const answer = ["[Note]: this is a caveat", "", `Cited [X](/atlas/${A}).`].join("\n");
  expect(expand(answer)).toBe(answer);
});

test("undefined-label degradation: a resolver synthesizes an inline link for a label it can place", () => {
  // The normalizer passes the normalized label KEY (dashes intact) to the
  // resolver; the orchestrator's real resolver un-slugifies before matching.
  const resolve = (label: string) => (label === "spark-rate" ? `/atlas/${A}` : null);
  const r = expandReferenceLinks("The rate is [5%][spark-rate] today.", resolve);
  expect(r.content).toBe(`The rate is [5%](/atlas/${A}) today.`);
  expect(r.undefinedLabels).toEqual([]);
});

test("undefined-label degradation: a label the resolver can't place is stripped and still reported", () => {
  const r = expandReferenceLinks("Per [the rules][missing-label] here.", () => null);
  expect(r.content).toBe("Per the rules here.");
  expect(r.content).not.toContain("[the rules]");
  expect(r.undefinedLabels).toEqual(["missing-label"]);
});

test("undefined-label degradation: a collapsed [text][] ref resolves through its text when defined by the resolver", () => {
  const resolve = (label: string) => (label === "keel accord" ? `/atlas/${B}` : null);
  expect(expandReferenceLinks("See the [Keel Accord][] now.", resolve).content).toBe(`See the [Keel Accord](/atlas/${B}) now.`);
});

test("resolver path stays idempotent", () => {
  const resolve = (label: string) => (label === "spark-rate" ? `/atlas/${A}` : null);
  const once = expandReferenceLinks("[5%][spark-rate] and [x][nope].", resolve).content;
  expect(expandReferenceLinks(once, resolve).content).toBe(once);
});

test("the checking layer reports identically for a reference answer and its inline twin", () => {
  const [a, b] = [...ix.docMap.values()].filter((d) => !/[[\]]/.test(d.title) && d.content.length > 200).slice(0, 2);
  const evidence = [JSON.stringify({ id: a.id, title: a.title, content: a.content }), JSON.stringify({ id: b.id, title: b.title, content: b.content })];
  const inline = [
    `The first scope is described in [${a.title}](/atlas/${a.id}) and it applies broadly across the atlas.`,
    "",
    `A second consideration comes from [${b.title}](/atlas/${b.id}) which sets out further requirements.`,
  ].join("\n");
  const ref = [
    `[doc-a]: /atlas/${a.id}`,
    `[doc-b]: /atlas/${b.id}`,
    "",
    `The first scope is described in [${a.title}][doc-a] and it applies broadly across the atlas.`,
    "",
    `A second consideration comes from [${b.title}][doc-b] which sets out further requirements.`,
  ].join("\n");
  expect(expand(ref)).toBe(inline);
  expect(runDeterministicChecks(expand(ref), evidence, ix)).toEqual(runDeterministicChecks(inline, evidence, ix));
});
