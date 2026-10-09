import { useLocation, useSearchParams } from "wouter";
import { ROUTES } from "@/lib/routes";

/** The document open in the reader (`/atlas?id=<uuid>`), or null on any other route. */
export function useAtlasNodeId(): string | null {
  const [location] = useLocation();
  const [searchParams] = useSearchParams();
  return location === ROUTES.ATLAS ? searchParams.get("id") : null;
}
