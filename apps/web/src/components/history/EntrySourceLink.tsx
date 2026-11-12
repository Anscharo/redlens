import type { ComponentProps } from "react";

export type EntrySourceLinkProps = Omit<ComponentProps<"a">, "href" | "children"> & {
  /** External page this reconstructed origin was read from. */
  href: string;
};

/** A reconstructed pre-git origin's external source. The tag is not a commit. */
export function EntrySourceLink({ href, ...props }: EntrySourceLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline focus-visible:underline"
      style={{ color: "var(--tan-3)" }}
      {...props}
    >
      source <span className="enlargen">→</span>
    </a>
  );
}
