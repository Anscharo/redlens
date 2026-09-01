import { startTransition, type ReactNode } from "react";
import { useLocation, useRouter } from "wouter";

/**
 * SVG-safe route link. The app's <Link> renders an HTML anchor — invalid
 * inside <svg> — so this replicates its behavior on an SVG <a>: modifier or
 * non-left clicks fall through to the browser (the href is base-prefixed so
 * open-in-new-tab works in preview deployments), plain clicks navigate inside
 * startTransition so the lazy route doesn't flash a Suspense fallback.
 * `navigate` prefixes the router base itself, so it gets the unprefixed path.
 */
export function SvgRouteLink({
  to,
  label,
  className,
  children,
}: {
  to: string;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const { base } = useRouter();
  const [, navigate] = useLocation();
  const onClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    startTransition(() => navigate(to));
  };
  return (
    <a href={`${base}${to}`} onClick={onClick} aria-label={label} className={className}>
      {children}
    </a>
  );
}
