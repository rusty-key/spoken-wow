/** Starts moving a team's objects between buckets. `from` and `to` are bucket ids; null is Spoken's archive. */
import { requireCapability } from "@/lib/generation/authz";
import { langParam } from "@/lib/lang-server";
import { StorageError } from "@/lib/storage/backends";
import { startMove } from "@/lib/storage/moves";
import { refusal } from "@/lib/storage/view";
import { teamOf } from "@/lib/teams/store";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const end = (value: unknown, name: string): string | null => {
  if (value === null) return null;
  if (typeof value === "string" && UUID.test(value)) return value;
  throw new StorageError(`${name} is a bucket's id, or null for Spoken's archive.`);
};

export async function POST(request: Request) {
  const { lang, denied: unknown } = await langParam(request);
  if (unknown) return unknown;
  const { session, denied } = await requireCapability("admin", lang);
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
    if (!body || !("from" in body) || !("to" in body)) throw new StorageError("from and to are required.");
    const move = await startMove(await teamOf(lang), end(body.from, "from"), end(body.to, "to"), session.user.id);
    return Response.json({ move }, { status: 202 });
  } catch (error) {
    return refusal(error);
  }
}
