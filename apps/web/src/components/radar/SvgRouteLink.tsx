import { startTransition, type ComponentPropsWithoutRef, type MouseEvent } from "react";
import { useLocation, useRouter } from "wouter";

/**
 * SVG-safe route link. The app's <Link> renders an HTML anchor — invalid
 * inside <svg> — so this replicates its behavior on an SVG <a>: modifier or
 * non-left clicks fall through to the browser (the href is base-prefixed so
 * open-in-new-tab works in preview deployments), plain clicks navigate inside
 * startTransition so the lazy route doesn't flash a Suspense fallback.
 * `navigate` prefixes the router base itself, so it gets the unprefixed path.
 */
export type SvgRouteLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  /** Router-relative path. The href is base-prefixed so open-in-new-tab works in preview. */
  to: string;
  /** Accessible name. SVG `<a>` wrapping shapes has no text fallback. */
  label?: string;
};

export function SvgRouteLink({
  to,
  label,
  onClick: userOnClick,
  children,
  ...rest
}: SvgRouteLinkProps) {
  const { base } = useRouter();
  const [, navigate] = useLocation();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    userOnClick?.(e);
    if (e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    startTransition(() => navigate(to));
  };
  return (
    <a href={`${base}${to}`} aria-label={label} {...rest} onClick={onClick}>
      {children}
    </a>
  );
}
