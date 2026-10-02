import type { ComponentPropsWithoutRef } from "react";
import { Link } from "../Link";
import { ROUTES } from "@/lib/routes";
import { useDataSource } from "../../lib/dataSource";

type ConversationsLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href">;

// The conversations page is part of the live app only. Inside a preview the
// router base is /preview/<id>, so an in-app link would land on an unmounted
// route; a plain link leaves the preview and loads the live page instead.
export function ConversationsLink(props: ConversationsLinkProps) {
  const { preview } = useDataSource();
  if (preview) return <a href={ROUTES.CONVERSATIONS} {...props} />;
  return <Link to={ROUTES.CONVERSATIONS} {...props} />;
}
