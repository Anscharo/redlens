// /preview index page helpers: parse pasted input → preview id, and the
// localStorage record of previews this browser has opened (survives DB wipes
// and lets the index list "your" previews without any account).

const CANONICAL_OWNER = "sky-ecosystem";
const ATLAS_REPO_NAME = "next-gen-atlas";
const SHA_RE = /^[0-9a-f]{40}$/i;

// `/` in branch names is encoded as `~` in preview ids (see server resolve.ts).
const enc = (ref: string) => ref.replaceAll("/", "~");

/** Pasted URL or bare id → preview id (pull-N / owner:branch / owner:repo:branch
 *  / branch / sha), or null if unparseable. URLs work for ANY repo — renamed
 *  forks included; the server screens by fork lineage, not by repo name.
 *  Accepted URL forms: /pull/N (canonical only — PR numbers are repo-local),
 *  /tree/<branch>, /commit/<sha>; plus bare pull-N, 40-hex, N, ids. */
export function parsePreviewInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const url = s.match(/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\/(.*))?$/i);
  if (url) {
    const [, owner, repo, rest = ""] = url;
    const canonical = owner === CANONICAL_OWNER && repo === ATLAS_REPO_NAME;
    const pull = rest.match(/^pull\/(\d+)/);
    // PR numbers are repo-local: a fork's /pull/N is a PR against the FORK,
    // not the atlas — only the canonical repo's PRs are previewable.
    if (pull) return canonical ? `pull-${pull[1]}` : null;
    const tree = rest.match(/^tree\/(.+?)\/?$/);
    if (tree) {
      const ref = enc(decodeURIComponent(tree[1]));
      if (canonical) return ref;
      return repo === ATLAS_REPO_NAME ? `${owner}:${ref}` : `${owner}:${repo}:${ref}`;
    }
    const commit = rest.match(/^commit\/([0-9a-f]{40})/i);
    if (commit) return commit[1].toLowerCase();
    return null; // bare repo URL — no ref to preview
  }
  // URL-shaped input that didn't match the atlas patterns is unparseable —
  // don't let it fall through to the bare-id forms below.
  if (/^https?:\/\/|github\.com/i.test(s)) return null;

  if (SHA_RE.test(s)) return s.toLowerCase();
  if (/^pull-\d+$/.test(s)) return s;
  if (/^#?\d+$/.test(s)) return `pull-${s.replace("#", "")}`; // "256" / "#256"
  if (/^[\w.-]+:[\w.-]+:[^\s:]+$/.test(s)) {
    const [owner, repo, ref] = s.split(":");
    return `${owner}:${repo}:${enc(ref)}`; // renamed fork
  }
  if (/^[\w.-]+:[^\s:]+$/.test(s)) {
    const [owner, ref] = s.split(":");
    return `${owner}:${enc(ref)}`;
  }
  if (/^[^\s:]+$/.test(s)) return enc(s); // bare canonical branch name
  return null;
}

/** Human label for the "Preparing preview…" line: the PR number when the id is
 *  a PR, otherwise the owner/repo it points at (short sha as a last resort). */
export function previewLabel(id: string): string {
  const s = id.trim();
  const pull = s.match(/^pull-(\d+)$/);
  if (pull) return `PR #${pull[1]}`;
  if (SHA_RE.test(s)) return s.slice(0, 7);
  const parts = s.split(":"); // owner:repo:ref | owner:ref | bare ref (canonical branch)
  if (parts.length >= 3) return `${parts[0]}/${parts[1]}`;
  if (parts.length === 2) return `${parts[0]}/${ATLAS_REPO_NAME}`;
  return `${CANONICAL_OWNER}/${ATLAS_REPO_NAME}`;
}

export interface LocalPreview {
  id: string;
  sha: string;
  at: number; // epoch ms of last open
}

const LS_KEY = "preview-history";
const MAX_LOCAL = 30;

export function localPreviews(): LocalPreview[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Record a successfully-opened preview (dedup by id, newest first). */
export function recordLocalPreview(id: string, sha: string): void {
  try {
    const rest = localPreviews().filter((p) => p.id !== id);
    const next = [{ id, sha, at: Date.now() }, ...rest].slice(0, MAX_LOCAL);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode) — index just won't remember */
  }
}
