/**
 * Changing a report's status from the browser.
 *
 * One request per report: each row keeps its own resolvedAt and resolvedBy, and a report that
 * fails to resolve stays open rather than taking the rest of its line down with it.
 */
import type { ContributionStatus } from "@/lib/contributions/contributions";

import type { CorrectionAccept, ReportContribution } from "./contribute";
import type { Queue, Report, Status } from "./reports";

/** The report as it now stands, or null when the change did not go through. */
async function changeReport(path: string, change: Record<string, unknown>): Promise<Report | null> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(change),
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { report?: Report } | null;
  return body?.report ?? null;
}

export const resolveReport = (id: number, status: Status) => changeReport("/api/reports/resolve", { id, status });

export const passReport = (id: number, to: Queue) => changeReport("/api/reports/pass", { id, to });

/** What the corpus makes of a report's text (lib/reports/contribute.ts), or why it has none. */
export async function reportContribution(id: number): Promise<ReportContribution | { error: string }> {
  const response = await fetch(`/api/reports/contribute?id=${id}`).catch(() => null);
  const body = (await response?.json().catch(() => null)) as (ReportContribution & { error?: string }) | null;
  if (response?.ok && body) return body;
  return { error: body?.error ?? "Could not read what the corpus has for this text." };
}

/** The report answered Fixed by its text accepted as a contribution, or why it was not. */
export async function contributeReport(
  id: number,
  accept: CorrectionAccept = {},
): Promise<{ report: Report; contribution: { id: number; status: ContributionStatus } } | { error: string }> {
  const response = await fetch("/api/reports/contribute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ...("as" in accept ? accept : accept.pick) }),
  }).catch(() => null);
  const body = (await response?.json().catch(() => null)) as
    | { report?: Report; contribution?: { id: number; status: ContributionStatus }; error?: string }
    | null;
  if (response?.ok && body?.report && body.contribution) return { report: body.report, contribution: body.contribution };
  return { error: body?.error ?? "That didn't go through -- try again." };
}
