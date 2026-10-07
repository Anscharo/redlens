// Parses one sky-ecosystem/polls markdown file. Pure: no I/O.

import { filenameDate } from "./executive.ts";
import { ATLAS_FAMILIES, extractLinks, readFrontmatter } from "./markdown.ts";
import type { Poll } from "../../../src/lib/votes/types.ts";

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
    portal: null,
  };
}
