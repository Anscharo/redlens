// Frontend entry point for address name/owner resolution. Re-exports the pure,
// server-shared rules from root src/lib/addressName and adds the one wrapper the
// frontend needs: a shortened-address fallback (shortAddr lives here in apps/web,
// not in root src). Import everything address-name-related from here in apps/web.
import { shortAddr } from "./format";
import { resolveName, type NameFields } from "@/lib/addressName";

export { isCleanLabel, resolveName, resolveOwner, hasResolvedName, type NameFields } from "@/lib/addressName";

/**
 * The authoritative display name for an address, falling back to the shortened
 * address when there is no chainlog id / verified name. Never returns
 * `entityLabel`. `address` is required for the fallback (NameFields has no key).
 */
export function resolveAddressName(address: string, info: NameFields | null | undefined): string {
  return resolveName(info) ?? shortAddr(address);
}
