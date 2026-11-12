import type { ComponentProps } from "react";
import { ATLAS_REPO } from "@/lib/history";

const TAN = { color: "var(--tan-3)" } as const;

export type EntryCommitLinkProps = Omit<ComponentProps<"span">, "children"> & {
  /** The git commit sha this entry was made in. */
  hash: string;
};

/** A git commit, `commit <sha>`, linked to the atlas repository. */
export function EntryCommitLink({ hash, ...props }: EntryCommitLinkProps) {
  return (
    <span style={TAN} {...props}>
      commit{" "}
      <a
        href={`${ATLAS_REPO}/commit/${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline focus-visible:underline"
        style={TAN}
      >
        {hash}
      </a>
    </span>
  );
}

export type EntryCommitTagProps = Omit<ComponentProps<"span">, "children"> & {
  /** A synthetic commit tag with no repository URL. */
  hash: string;
};

/** The entry's commit tag, when it is neither a sha nor an external source. */
export function EntryCommitTag({ hash, ...props }: EntryCommitTagProps) {
  return (
    <span style={TAN} {...props}>
      {hash}
    </span>
  );
}
