// /preview index page helpers: parse pasted input → preview id, and the
// localStorage record of previews this browser has opened (survives DB wipes
// and lets the index list "your" previews without any account).

const CANONICAL_OWNER = "sky-ecosystem";
const SHA_RE = /^[0-9a-f]{40}$/i;

// `/` in branch names is encoded as `~` in preview ids (see server resolve.ts).
const enc = (ref: string) => ref.replaceAll("/", "~");

/** Pasted URL or bare id → preview id (pull-N / owner:branch / branch / sha),
 *  or null if unparseable. Accepted URL forms on any fork of next-gen-atlas:
 *  /pull/N, /tree/<branch>, /commit/<sha>; plus bare pull-N, 40-hex, N, ids. */
export function parsePreviewInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const url = s.match(/github\.com\/([^/\s]+)\/next-gen-atlas\/?(.*)$/i);
  if (url) {
    const [, owner, rest] = url;
    const pull = rest.match(/^pull\/(\d+)/);
    if (pull) return `pull-${pull[1]}`;
    const tree = rest.match(/^tree\/(.+?)\/?$/);
    if (tree) {
      const ref = enc(decodeURIComponent(tree[1]));
      return owner === CANONICAL_OWNER ? ref : `${owner}:${ref}`;
    }
    const commit = rest.match(/^commit\/([0-9a-f]{40})/i);
    if (commit) return commit[1].toLowerCase();
    if (!rest) return null; // bare repo URL — no ref to preview
    return null;
  }
  // URL-shaped input that didn't match the atlas patterns is unparseable —
  // don't let it fall through to the bare-id forms below.
  if (/^https?:\/\/|github\.com/i.test(s)) return null;

  if (SHA_RE.test(s)) return s.toLowerCase();
  if (/^pull-\d+$/.test(s)) return s;
  if (/^#?\d+$/.test(s)) return `pull-${s.replace("#", "")}`; // "256" / "#256"
  if (/^[\w.-]+:[^\s:]+$/.test(s)) {
    const [owner, ref] = s.split(":");
    return `${owner}:${enc(ref)}`;
  }
  if (/^[^\s:]+$/.test(s)) return enc(s); // bare canonical branch name
  return null;
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
