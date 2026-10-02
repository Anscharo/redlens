// Flags comments that narrate history instead of stating what holds now.
// Pure: unified-diff text in, findings out. Only ADDED lines are judged, so existing
// comments are untouched until someone edits them.
//
// The contract: comments are present-tense invariants and reasons ("X must stay
// sorted because Y"). Dates, PR numbers and "used to" belong in git and PR bodies. history-ok
// A line that genuinely needs one (a date that is atlas data) carries `history-ok`.

const CODE_FILE_RE = /\.(m?[jt]sx?|css)$/;
const OPT_OUT = "history-ok";
// Atlas-history features: there, dates and upstream atlas PR numbers are the data.
const EXEMPT_PATH_RE = /^(scripts\/(htmlhist|prehist)\/|src\/server\/history\/|apps\/web\/src\/components\/history\/)/;

const PATTERNS = [
  { re: /\bPR ?#\d+/i, why: "PR number" },
  { re: /(?<![\w/&#])#\d{3,4}\b/, why: "PR/issue number" },
  { re: /\b20\d\d-(0[1-9]|1[0-2])(-\d\d)?\b/, why: "date" },
  { re: /(?<!\b(?:is|are|be|been|being|was|were|get|gets|got|getting)\s)\bused to\b/i, why: "\"used to\"" },
  { re: /\b(previously|formerly|no longer|earlier version|until recently)\b/i, why: "history phrasing" },
];

/** The comment part of a source line, or null when the line has none. */
export function commentText(line) {
  const trimmed = line.trim();
  if (/^(\/\/|\/\*|\*|\{\/\*)/.test(trimmed)) return trimmed;
  // Trailing `// …` after code. Skips `://` so URLs in strings don't count.
  const m = line.match(/(?<![:"'`\\])\/\/\s.*$/);
  return m ? m[0] : null;
}

/** Findings for one comment string: [{ why }]. */
export function judgeComment(text) {
  if (text.includes(OPT_OUT)) return [];
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => ({ why: p.why }));
}

/** Walks `git diff -U0` output; returns [{ path, line, text, why }] for added comment lines. */
export function scanDiff(diff) {
  const findings = [];
  let path = null;
  let lineNo = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) path = raw.startsWith("+++ b/") ? raw.slice(6) : null;
    else if (raw.startsWith("@@")) lineNo = Number(raw.match(/\+(\d+)/)?.[1] ?? 0);
    else if (raw.startsWith("+") && path && CODE_FILE_RE.test(path) && !EXEMPT_PATH_RE.test(path)) {
      const text = commentText(raw.slice(1));
      for (const f of text ? judgeComment(text) : []) findings.push({ path, line: lineNo, text: text.trim(), why: f.why });
      lineNo++;
    }
  }
  return findings;
}
