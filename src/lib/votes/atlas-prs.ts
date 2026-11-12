// The atlas pull requests a vote's text links: the one extractor the poll
// records, the Prime Snapshot polls and the vote-evidence history key share, so
// they agree on which PRs a vote is about. Pure.

const ATLAS_PR_RE = /next-gen-atlas\/pull\/(\d+)(?!\d)/g;

/** The next-gen-atlas pull request numbers `text` links, deduplicated and ascending. */
export function atlasPullRequests(text: string): number[] {
  return [...new Set([...text.matchAll(ATLAS_PR_RE)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}
