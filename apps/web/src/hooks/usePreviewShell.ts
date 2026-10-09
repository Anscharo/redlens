import { useEffect, useState } from "react";
import { useSearchParams } from "wouter";
import { ROUTES } from "@/lib/routes";
import { useDataSource } from "../lib/dataSource";
import { useDocumentTitle } from "./useDocumentTitle";

/** The shell's PR-preview behaviour. Returns the setter PreviewBanner reports
 *  the preview's tab title through.
 *
 *  In preview mode the bare root lands on the reader instead of the home/search
 *  splash, so pasting /preview/:id drops straight into the proposed atlas. Only
 *  the BARE root redirects: searching navigates to HOME?q=… (results live
 *  there), and bouncing that back to the reader would drop the query and loop.
 *
 *  Call it from the shell, never from a page: the shell's title effect runs
 *  after the open page's, which is what lets a PR preview keep this tab title. */
export function usePreviewShell(location: string, navigate: (to: string, opts?: { replace?: boolean }) => void) {
  const { preview } = useDataSource();
  const [searchParams] = useSearchParams();
  const [previewTab, setPreviewTab] = useState<string | null>(null);
  useDocumentTitle(previewTab, previewTab != null);

  useEffect(() => {
    if (preview && location === ROUTES.HOME && !searchParams.get("q")) {
      navigate(ROUTES.ATLAS, { replace: true });
    }
  }, [preview, location, searchParams, navigate]);

  return setPreviewTab;
}
