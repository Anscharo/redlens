import type { ComponentType } from "react";
import type { ActorPageKey } from "@/lib/radarPages";
import type { ActorProfile } from "../../lib/actorIndex";
import { ActorDashboard } from "./ActorDashboard";
import { ActorSettlementsPage } from "./ActorSettlementsPage";
import { ActorHistoryPage } from "./ActorHistoryPage";
import { ActorInstancesPage } from "./ActorInstancesPage";
import { ActorPauPage } from "./ActorPauPage";

/** The component behind each subpage in src/lib/radarPages.ts. */
const PAGE_VIEWS: Record<ActorPageKey, ComponentType<{ profile: ActorProfile }>> = {
  settlements: ActorSettlementsPage,
  history: ActorHistoryPage,
  instances: ActorInstancesPage,
  pau: ActorPauPage,
};

export interface ActorPageViewProps {
  profile: ActorProfile;
  /** The open subpage; absent on the actor's Info page. */
  page?: ActorPageKey;
}

export function ActorPageView({ profile, page }: ActorPageViewProps) {
  const View = page ? PAGE_VIEWS[page] : ActorDashboard;
  return <View profile={profile} />;
}
