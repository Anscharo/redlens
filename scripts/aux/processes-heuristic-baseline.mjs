// One-off: compute the runtime heuristic step count for each processes.json
// entry and print a JSON report so we can audit + backfill stepCount.
//
// Run: node scripts/aux/processes-heuristic-baseline.mjs > .cache/processes-heuristic.json
import fs from "node:fs";

const docs = JSON.parse(fs.readFileSync("public/docs.json", "utf8")).nodes;
const processes = JSON.parse(fs.readFileSync("public/processes.json", "utf8"));

const NON_STEP_TYPES = new Set([
  "Annotation",
  "Action Tenet",
  "Scenario",
  "Scenario Variation",
  "Active Data",
  "Needed Research",
]);

function isStepChild(child) {
  if (NON_STEP_TYPES.has(child.type)) return false;
  const last = child.doc_no.split(".").pop();
  if (last === "0") return false;
  return true;
}

const childrenByParentDocNo = new Map();
for (const node of Object.values(docs)) {
  const lastDot = node.doc_no.lastIndexOf(".");
  if (lastDot < 0) continue;
  const parent = node.doc_no.slice(0, lastDot);
  const list = childrenByParentDocNo.get(parent) ?? [];
  list.push(node);
  childrenByParentDocNo.set(parent, list);
}

function countSteps(node) {
  const children = (childrenByParentDocNo.get(node.doc_no) ?? []).filter(isStepChild);
  if (children.length > 0) return { count: children.length, source: "children" };
  const content = node.content ?? "";
  const stepHeadings = [...content.matchAll(/^#+\s*(?:Step|Stage|Phase)\s+(\d+)/gim)];
  if (stepHeadings.length > 0) {
    return { count: new Set(stepHeadings.map((m) => m[1])).size, source: "step-headings" };
  }
  const numList = [...content.matchAll(/^(\d+)\.\s+/gm)];
  if (numList.length >= 2) return { count: numList.length, source: "numbered-list" };
  const parens = [...content.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1]));
  if (parens.length >= 2 && parens[0] === 1) {
    let n = 1;
    for (let i = 1; i < parens.length && parens[i] === n + 1; i++) n++;
    if (n >= 2) return { count: n, source: "parenthesized" };
  }
  const bullets = [...content.matchAll(/^[-*]\s+/gm)];
  if (bullets.length >= 3) return { count: bullets.length, source: "bullets" };
  return { count: null, source: "none" };
}

const report = processes.map((p) => {
  const node = docs[p.uuid];
  if (!node) return { uuid: p.uuid, missing: true };
  const h = countSteps(node);
  const contentLen = (node.content ?? "").length;
  return {
    uuid: p.uuid,
    doc_no: node.doc_no,
    title: node.title,
    shape: p.shape,
    status: p.status,
    heuristic: h.count,
    source: h.source,
    contentLen,
    hasStepCount: p.stepCount !== undefined,
  };
});

process.stdout.write(JSON.stringify(report, null, 2));
