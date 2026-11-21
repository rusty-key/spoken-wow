import { requireAdminSession } from "@/lib/generation/authz";
import { currentSession } from "@/lib/session";

import { PackError } from "./store";

/** A rule failure carries its per-field messages, so the form can show them beside the inputs. */
function refusal(error: unknown): Response {
  if (!(error instanceof PackError)) throw error;
  return Response.json(
    error.errors ? { error: error.message, errors: error.errors } : { error: error.message },
    { status: error.status },
  );
}

/** Anything but a PackError rethrows, so a real failure is not hidden as a refusal. */
async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    return refusal(error);
  }
}

/** For anybody signed in; the store checks ownership itself. */
export async function asMember(handle: (userId: string) => Promise<Response>): Promise<Response> {
  const session = await currentSession();
  if (!session) {
    return Response.json({ error: "not allowed" }, { status: 403 });
  }
  return guarded(() => handle(session.user.id));
}

export async function asAdmin(handle: (adminId: string) => Promise<Response>): Promise<Response> {
  const { session, denied } = await requireAdminSession();
  if (denied) return denied;
  return guarded(() => handle(session.user.id));
}
