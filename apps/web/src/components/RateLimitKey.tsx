import { useMemo, type ComponentPropsWithoutRef } from "react";
import type { Element } from "hast";
import { keyHolders } from "@/lib/pauKeyHolders";
import { loadPau } from "../lib/pau";
import { useLoaded } from "../hooks/useAtlasData";
import { Tooltip } from "./Tooltip";
import { RateLimitKeyCard } from "./RateLimitKeyCard";

/**
 * A 64-hex code span in atlas prose. When a PAU contract holds it as a
 * rate-limit key (GET /api/pau, read once and shared), hovering or focusing it
 * shows the on-chain maxAmount and slope; any other hash, or one shown before
 * the snapshots load, stays a plain code span.
 */
export function RateLimitKey({ hash, className, children, ...props }: ComponentPropsWithoutRef<"code"> & { hash: string }) {
  const res = useLoaded(loadPau, { soft: true });
  const holders = useMemo(() => (res ? keyHolders(res, hash) : []), [res, hash]);
  if (holders.length === 0) return <code className={className} {...props}>{children}</code>;
  return (
    <Tooltip content={<RateLimitKeyCard holders={holders} />}>
      <code className={`rl-key ${className ?? ""}`} tabIndex={0} data-rate-limit-key={hash} {...props}>
        {children}
      </code>
    </Tooltip>
  );
}

/** react-markdown's `code` renderer: a span rehypeHashCodes stamped with `data-hash` goes through RateLimitKey. */
export function MarkdownCode({ node, ...props }: ComponentPropsWithoutRef<"code"> & { node?: Element }) {
  const hash = node?.properties?.["data-hash"];
  return typeof hash === "string" ? <RateLimitKey hash={hash} {...props} /> : <code {...props} />;
}
