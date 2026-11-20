/**
 * Email about a team's release under review: the site owners when one waits, whoever pressed it
 * once it is decided. Sent after the act commits, and never failing it.
 */
import "server-only";

import { query } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { langName } from "@/lib/lang";
import { SOURCE_LABELS } from "@/lib/reports/reports";
import { adminEmails, SITE } from "@/lib/site";

import type { ReleaseRun } from "./store";

async function teamName(teamId: string): Promise<string> {
  const rows = await query<{ name: string }>(`select "name" from "team" where "id" = $1`, [teamId]);
  return rows[0]?.name ?? "A team";
}

const what = (run: ReleaseRun) =>
  `${SOURCE_LABELS[run.section]} in ${langName(run.lang)}${run.version ? ` ${run.version}` : ""}`;

/** A team's version waits for review. */
export async function tellOwnersOfReview(run: ReleaseRun): Promise<void> {
  try {
    const [team, addresses] = await Promise.all([teamName(run.teamId), adminEmails()]);
    const text = [
      `${team} released ${what(run)}. It is staged, and players get it once a site owner approves it.`,
      "",
      `Review it here: ${SITE}/admin/team-releases`,
    ].join("\n");
    for (const address of addresses) void sendEmail(address, `Team release to review: ${team}, ${what(run)}`, text);
  } catch (error) {
    console.error(`release ${run.id}: could not email the site owners`, error);
  }
}

/** A site owner approved or rejected the version `run` staged; `note` is the reason for a rejection. */
export async function tellPresser(run: ReleaseRun, decision: "approved" | "rejected", note?: string): Promise<void> {
  if (!run.requestedBy) return;
  try {
    const rows = await query<{ email: string }>(`select "email" from "user" where "id" = $1`, [run.requestedBy]);
    const to = rows[0]?.email;
    if (!to) return;
    const page = `${SITE}/admin/release?lang=${run.lang}`;
    const text =
      decision === "approved"
        ? [`A site owner approved ${what(run)}. Players get it on their next Manager refresh.`, "", page]
        : [`A site owner did not approve ${what(run)}.`, "", `Their reason: ${note ?? ""}`, "", `Release again once it is fixed: ${page}`];
    void sendEmail(to, `${decision === "approved" ? "Approved" : "Not approved"}: ${what(run)}`, text.join("\n"));
  } catch (error) {
    console.error(`release ${run.id}: could not email whoever pressed it`, error);
  }
}
