// Parses one sky-ecosystem/polls markdown file. Pure: no I/O.

import { filenameDate } from "./executive.ts";
import { ATLAS_FAMILIES, extractLinks, readFrontmatter } from "./markdown.ts";
import type { Poll } from "../../../src/lib/votes/types.ts";

const ATLAS_PR_RE = /next-gen-atlas\/pull\/(\d+)(?!\d)/g;

/** The next-gen-atlas pull request numbers `text` links, deduplicated and ascending. */
export function atlasPullRequests(text: string): number[] {
  return [...new Set([...text.matchAll(ATLAS_PR_RE)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

export function parsePoll(file: string, md: string): Poll {
  const { fields, body } = readFrontmatter(md);
  return {
    file,
    date: filenameDate(file),
    start: fields.start_date ?? null,
    end: fields.end_date ?? null,
    title: fields.title ?? "",
    summary: fields.summary ?? "",
    discussionLink: fields.discussion_link ?? null,
    atlasRefs: extractLinks(body).filter((l) => ATLAS_FAMILIES.has(l.family)),
    atlasPrs: atlasPullRequests(body),
    portal: null,
  };
}
