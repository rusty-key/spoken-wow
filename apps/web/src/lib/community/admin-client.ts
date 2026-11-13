/** The admin's pack routes from the browser. */
import { send } from "@/lib/send";

export const decideSubmission = (id: string, decision: "approve" | "reject", reason?: string) =>
  send(`/api/admin/packs/submissions/${encodeURIComponent(id)}`, "POST", { decision, reason });

export const updatePack = (id: string, change: { ownerId?: string | null; listed?: boolean }) =>
  send(`/api/admin/packs/${encodeURIComponent(id)}`, "PATCH", change);
