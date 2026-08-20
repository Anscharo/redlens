import { startTransition, forwardRef, type ComponentPropsWithoutRef } from "react";
import { Link as WouterLink, useLocation } from "wouter";

// Wraps wouter's <Link> so client-side navigation runs inside startTransition.
// Without this, clicking a Link to a lazy-loaded route (Constellations, Radar,
// /reports/*) renders the Suspense fallback synchronously and looks like a
// full page reload. Modifier-key clicks (cmd/ctrl/shift) fall through to the
// browser as usual — wouter's own onClick handles that branch before us.
interface LinkProps extends Omit<ComponentPropsWithoutRef<"a">, "href"> {
  to: string;
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, onClick: userOnClick, ...rest },
  ref,
) {
  const [, navigate] = useLocation();
  const handle = (e: React.MouseEvent<HTMLAnchorElement>) => {
    userOnClick?.(e);
    if (e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    startTransition(() => navigate(to));
  };
  return <WouterLink ref={ref} to={to} onClick={handle} {...rest} />;
});
