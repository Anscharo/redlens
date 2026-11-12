import type { ComponentProps } from "react";

export type EntryTitleProps = Omit<ComponentProps<"p">, "children"> & {
  /** The change's title: the matched PR-body bullet, else the PR title. */
  text: string;
};

/** Line 2 of a history entry: what the change was called. */
export function EntryTitle({ text, ...props }: EntryTitleProps) {
  return (
    <p className="italic text-[12px] leading-snug mt-1" style={{ color: "var(--tan)" }} {...props}>
      {text}
    </p>
  );
}
