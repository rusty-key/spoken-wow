import "server-only";

import type { ComponentProps } from "react";

import AdminHeaderView from "@/components/AdminHeaderView";
import { actingTeamNames } from "@/lib/teams/store";

export type { AdminTab } from "@/components/AdminHeaderView";

/** AdminHeaderView with the teams it names read here, so no admin page has to pass them. */
export default async function AdminHeader(props: Omit<ComponentProps<typeof AdminHeaderView>, "teams">) {
  return <AdminHeaderView {...props} teams={await actingTeamNames(props.administered)} />;
}
