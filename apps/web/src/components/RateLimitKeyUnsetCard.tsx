import type { KeyAbsence } from "@/lib/pauKeyHolders";
import { placesText, readAt } from "../lib/pauPlaces";

const dim = { color: "var(--tan-3)" };

/**
 * The hover card on a RateLimitID no PAU contract holds: the RateLimits a live
 * read found never set it on, and those of the same primes not read for it, so
 * "any chain" is claimed only when every one was read.
 */
export function RateLimitKeyUnsetCard({ absence: { unset, unread } }: { absence: KeyAbsence }) {
  const read = readAt(unset);
  return (
    <div className="min-w-[10rem] max-w-[18rem]" data-state="unset">
      <div className="font-medium text-tan">{unread.length ? "Not set where read" : "Not set on any chain"}</div>
      <div className="mt-1 text-tan-2 break-words">No PAU contract holds this rate limit. Read live, it has never been set on {placesText(unset)}.</div>
      {unread.length > 0 && <div className="mt-1 break-words" style={dim}>Not read yet on {placesText(unread)}.</div>}
      {read && <div className="mono text-[10px] mt-1.5" style={dim}>read {read} UTC</div>}
    </div>
  );
}
