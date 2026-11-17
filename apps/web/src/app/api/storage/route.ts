/**
 * A team's own buckets, for its admins (docs/platform/STORAGE.md). The language names the team,
 * as on every admin page: whoever administers it administers the team's buckets.
 */
import { requireCapability } from "@/lib/generation/authz";
import { langParam } from "@/lib/lang-server";
import { backendInput, createBackend } from "@/lib/storage/backends";
import { refusal, storageView } from "@/lib/storage/view";
import { teamOf } from "@/lib/teams/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { lang, denied: unknown } = await langParam(request);
  if (unknown) return unknown;
  const { denied } = await requireCapability("admin", lang);
  if (denied) return denied;
  try {
    return Response.json(await storageView(lang));
  } catch (error) {
    return refusal(error);
  }
}

/** Saves a bucket unchecked; the page tests it straight after. */
export async function POST(request: Request) {
  const { lang, denied: unknown } = await langParam(request);
  if (unknown) return unknown;
  const { session, denied } = await requireCapability("admin", lang);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "a JSON body is required" }, { status: 400 });
  try {
    const backend = await createBackend(await teamOf(lang), backendInput(body), session.user.id);
    return Response.json({ backend }, { status: 201 });
  } catch (error) {
    return refusal(error);
  }
}
