import { useCallback, useEffect, useState } from "react";

/** Open state of the tree drawer (the narrow-screen tree sidebar). Shared by
 *  the reader, which opens it, and the drawer, which closes it. Any navigation
 *  closes it. */
export function useTreeDrawer(location: string) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location]);

  const openTree = useCallback(() => setOpen(true), []);
  const closeTree = useCallback(() => setOpen(false), []);
  return { open, openTree, closeTree };
}
