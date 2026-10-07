// The coverage report `pnpm votes:sync` prints. Pure: builds lines, prints nothing.

import type { JoinStats } from "./assemble.ts";
import type { Executive, Poll, VoteLink, VotesArtifact } from "./types.ts";

export function summarize(a: VotesArtifact, join: JoinStats | null): string[] {
  return [...executiveLines(a.executives), ...pollLines(a.polls), ...linkLines(a), ...joinLines(join)];
}

/** One line for unattended callers. */
export function summaryLine(a: VotesArtifact, dest: string): string {
  const e = a.executives.filter((x) => x.portal).length;
  const p = a.polls.filter((x) => x.portal).length;
  const portal = a.sources.portal ? `portal ${e}/${a.executives.length} executives, ${p}/${a.polls.length} polls` : "no portal";
  return `votes: ${a.executives.length} executives, ${a.polls.length} polls (${portal}) → ${dest}`;
}

function executiveLines(execs: Executive[]): string[] {
  const oos = execs.filter((e) => e.outOfSchedule).length;
  const drafted = execs.filter((e) => !e.address).map((e) => e.file);
  const lines = [`executives  ${execs.length}  ${range(execs)}  (out-of-schedule ${oos}, drafted ${drafted.length})`];
  for (const f of drafted) lines.push(`  drafted     ${f}: spell not yet deployed`);
  const withPortal = execs.filter((e) => e.portal);
  if (withPortal.length) {
    const cast = withPortal.filter((e) => e.portal?.hasBeenCast).length;
    lines.push(`  cast        ${cast} of ${withPortal.length} the portal knows`);
  }
  for (const e of execs.filter((x) => x.frontmatterDate && x.frontmatterDate !== x.date)) {
    lines.push(`  date drift  ${e.file}: filename ${e.date}, frontmatter ${e.frontmatterDate}, portal ${e.portal?.date.slice(0, 10) ?? "-"}`);
  }
  const sections = execs.flatMap((e) => e.sections);
  const auth = count(sections.flatMap((s) => s.authorization.map((l) => l.family)));
  lines.push(`  sections    ${sections.length}; authorization links by family: ${auth}`);
  return lines;
}

function pollLines(polls: Poll[]): string[] {
  const lines = [`polls       ${polls.length}  ${range(polls)}`];
  const decided = polls.filter((p) => p.portal?.winner);
  if (decided.length) lines.push(`  outcomes    ${count(decided.map((p) => p.portal?.winner ?? ""))}`);
  return lines;
}

function linkLines(a: VotesArtifact): string[] {
  const refs: VoteLink[] = [
    ...a.executives.flatMap((e) => e.sections.flatMap((s) => s.atlasRefs)),
    ...a.polls.flatMap((p) => p.atlasRefs),
  ];
  const uuids = new Set(refs.flatMap((l) => (l.uuid ? [l.uuid] : [])));
  return [`atlas refs  ${count(refs.map((l) => l.family))}; ${uuids.size} distinct uuids`];
}

function joinLines(join: JoinStats | null): string[] {
  if (!join) return ["portal      not read"];
  const lines: string[] = [];
  for (const f of join.executivesWithoutPortal) lines.push(`  no portal row for executive ${f}`);
  for (const f of join.pollsWithoutPortal) lines.push(`  no portal row for poll ${f}`);
  if (join.portalExecutivesWithoutFile) lines.push(`  ${join.portalExecutivesWithoutFile} portal executives have no file`);
  if (join.portalPollsWithoutFile) lines.push(`  ${join.portalPollsWithoutFile} portal polls have no file`);
  return lines.length ? lines : ["portal      every document joined"];
}

function range(rows: { date: string }[]): string {
  return rows.length ? `${rows[0].date} → ${rows[rows.length - 1].date}` : "(none)";
}

function count(values: string[]): string {
  const c = new Map<string, number>();
  for (const v of values) c.set(v, (c.get(v) ?? 0) + 1);
  return [...c].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
}
