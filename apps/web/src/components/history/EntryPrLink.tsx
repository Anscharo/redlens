import type { ComponentProps } from "react";
import { prHref } from "@/lib/history";

export type EntryPrLinkProps = Omit<ComponentProps<"a">, "href" | "children"> & {
  /** The atlas pull request number. */
  pr: number;
  /** Stored PR URL. Absent, the link is derived from the number. */
  prUrl?: string;
};

/** The entry's atlas pull request. */
export function EntryPrLink({ pr, prUrl, ...props }: EntryPrLinkProps) {
  return (
    <a
      href={prHref({ pr, prUrl })}
      target="_blank"
      rel="noopener noreferrer"
      title={`Atlas Pull Request #${pr}`}
      className="hover:underline focus-visible:underline"
      style={{ color: "var(--accent)" }}
      {...props}
    >
      PR {pr}
    </a>
  );
}
