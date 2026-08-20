import { useEffect } from "react";
import { initAnalytics, register, pageview, analyticsEnabled } from "@/lib/analytics";
import { productForPath } from "@/lib/productArea";
import { useDataSource } from "@/lib/dataSource";

// Initialises analytics once and, on every route change, registers the `product`
// super property then fires a manual SPA $pageview. Call once from App (which is
// always inside both a wouter Router and the DataSourceContext, for live + preview).
//
// In preview mode wouter's base-relative location is "/atlas" etc., so we override
// product to "preview" from the data source rather than the path. Preview is tracked
// fully (doc_view + reader_* interactions), all tagged product:preview.
export function usePageAnalytics(location: string): void {
  const { preview } = useDataSource();

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    if (!analyticsEnabled) return;
    const product = preview ? "preview" : productForPath(location);
    register({ product });
    // wouter's `location` excludes the querystring; include it so ?id/?q differ.
    pageview(location + window.location.search);
  }, [location, preview]);
}
