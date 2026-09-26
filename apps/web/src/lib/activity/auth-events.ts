/**
 * Account events for the activity log: role changes, bans, removals and impersonation.
 *
 * These go through better-auth's admin plugin, not this app's routes -- /admin's user table
 * calls set-role, and every other admin endpoint is one request away for any global admin --
 * so no store in lib/ sees them. update-user can set a role or a ban as well, so it is read
 * for those two fields and logged as the same events. Not covered: create-user, which can
 * make an account with a role already set. An after hook on the whole auth instance does, whether the
 * call came from the page, from a script, or from auth.api.
 *
 * AFTER, AND ONLY ON SUCCESS. The plugin checks the caller's permission, the body and the
 * target inside the endpoint; a refused call reaches this hook as an APIError in `returned`
 * and is not recorded. No before hook: one would run ahead of that authorization, and there
 * is nothing it needs to carry across.
 *
 * THE ACTOR IS WHOEVER CALLED, never the target. For impersonation that is read from the new
 * session's "impersonatedBy", which the plugin sets to the admin: after the switch the
 * request carries two sessions, and that field is the one that cannot be the wrong one.
 *
 * Every language's (lang null), and shown only to global admins: see `global` in store.ts.
 * Out of any transaction, so a failed write is logged and swallowed, as store.ts documents.
 *
 * NEVER THROWS. An after hook that throws turns the endpoint's answer into an error, and the
 * change it describes has already been saved: the admin would be told a role change failed
 * that did not.
 */
import "server-only";

import { createAuthMiddleware, isAPIError } from "better-auth/api";

import { recordActivities, type ActivityEvent } from "./store";

/** The body fields each audited endpoint reads, by the plugin's own names. */
type Body = {
  userId?: unknown;
  role?: unknown;
  banReason?: unknown;
  banExpiresIn?: unknown;
  /** update-user's fields to change. */
  data?: { role?: unknown; banned?: unknown; banReason?: unknown };
};

type Event = Pick<ActivityEvent, "kind" | "detail">;

function banned(fields: { banReason?: unknown; banExpiresIn?: unknown }): Event {
  return {
    kind: "user.banned",
    detail: {
      ...(typeof fields.banReason === "string" ? { banReason: fields.banReason } : {}),
      ...(typeof fields.banExpiresIn === "number" ? { banExpiresIn: fields.banExpiresIn } : {}),
    },
  };
}

const EVENTS: Record<string, (body: Body) => Event[]> = {
  "/admin/set-role": (body) => [{ kind: "user.role_changed", detail: { role: roleOf(body.role) } }],
  "/admin/ban-user": (body) => [banned(body)],
  "/admin/unban-user": () => [{ kind: "user.unbanned", detail: {} }],
  "/admin/remove-user": () => [{ kind: "user.removed", detail: {} }],
  "/admin/impersonate-user": () => [{ kind: "user.impersonated", detail: {} }],
  "/admin/update-user": ({ data = {} }) => [
    ...(data.role !== undefined ? [{ kind: "user.role_changed", detail: { role: roleOf(data.role) } } as Event] : []),
    ...(data.banned === true ? [banned(data)] : []),
    ...(data.banned === false ? [{ kind: "user.unbanned", detail: {} } as Event] : []),
  ],
};

/** set-role takes one role or several; one readable value either way. */
function roleOf(role: unknown): string {
  return Array.isArray(role) ? role.map(String).sort().join(", ") : String(role);
}

/** The auth instance's after hook: see the top of this file. */
export const recordAuthEvent = createAuthMiddleware(async (ctx) => {
  const event = EVENTS[ctx.path];
  if (!event) return;
  const returned = ctx.context.returned;
  if (!returned || isAPIError(returned) || returned instanceof Error) return;

  try {
    const body = (ctx.body ?? {}) as Body;
    const impersonatedBy = (returned as { session?: { impersonatedBy?: unknown } }).session?.impersonatedBy;
    const actorId =
      ctx.path === "/admin/impersonate-user"
        ? typeof impersonatedBy === "string" ? impersonatedBy : null
        : (ctx.context.session?.user.id ?? null);
    if (typeof body.userId !== "string" || !body.userId || !actorId) return;

    const subject = body.userId;
    await recordActivities(
      event(body).map((one) => ({ ...one, lang: null, actorId, subject }) as ActivityEvent),
    );
  } catch (error) {
    console.error(`activity: could not record ${ctx.path}`, error);
  }
});
