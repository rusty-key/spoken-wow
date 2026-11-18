/**
 * The storage routes' one gate (docs/platform/STORAGE.md): whoever administers `?lang=` administers
 * its team's buckets. With an [id], one that is not a uuid is no such thing. A StorageError, a
 * NoTeamError or a SealError answers with its message; anything else rethrows.
 */
import { bodyOf, objectOf } from "@/lib/api-body";
import { SealError } from "@/lib/blobs/seal";
import { requireCapability } from "@/lib/generation/authz";
import type { Lang } from "@/lib/lang";
import { langParam } from "@/lib/lang-server";
import { StorageError } from "@/lib/storage/backends";
import { NoTeamError, teamOf, type TeamId } from "@/lib/teams/store";
import { isUuid } from "@/lib/uuid";

export type StorageContext = { lang: Lang; team: TeamId; userId: string; id: string };

type Handler = (request: Request, at: StorageContext) => Promise<Response>;
type Params = { params: Promise<{ id: string }> };

function refusal(error: unknown): Response {
  if (error instanceof StorageError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof NoTeamError) return Response.json({ error: `${error.lang} has no team.` }, { status: 400 });
  if (error instanceof SealError) return Response.json({ error: error.message }, { status: 400 });
  throw error;
}

export function withTeamAdmin(handle: Handler): (request: Request) => Promise<Response>;
export function withTeamAdmin(handle: Handler, by: "id"): (request: Request, context: Params) => Promise<Response>;
export function withTeamAdmin(handle: Handler, by?: "id") {
  return async (request: Request, context?: Params): Promise<Response> => {
    const { lang, denied: unknown } = await langParam(request);
    if (unknown) return unknown;
    const { session, denied } = await requireCapability("admin", lang);
    if (denied) return denied;
    const id = by === "id" && context ? (await context.params).id : "";
    if (by === "id" && !isUuid(id)) return Response.json({ error: "Not found." }, { status: 404 });
    try {
      return await handle(request, { lang, team: await teamOf(lang), userId: session.user.id, id });
    } catch (error) {
      return refusal(error);
    }
  };
}

/** The request's JSON object; anything else is refused. */
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = objectOf(await bodyOf(request));
  if (!body) throw new StorageError("A JSON object is required.");
  return body;
}
