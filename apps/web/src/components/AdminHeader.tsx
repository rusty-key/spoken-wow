import "server-only";

import type { ComponentProps } from "react";

import AdminHeaderView from "@/components/AdminHeaderView";
import { actingTeamNames } from "@/lib/teams/store";

export type { AdminTab } from "@/components/AdminHeaderView";

/** The view is a client component, so the teams it names are read here, on the server. */
export default async function AdminHeader(props: Omit<ComponentProps<typeof AdminHeaderView>, "teams">) {
  return <AdminHeaderView {...props} teams={await actingTeamNames(props.administered)} />;
}
