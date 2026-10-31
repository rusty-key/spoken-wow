/**
 * The name of a quest, an NPC, a book's owner, a place or a boss, in a language other than
 * English: its history, or a new version. Needs `edit` in the language (`?lang=`).
 */
import { requireIn } from "@/lib/generation/authz";
import { BASE_LANG } from "@/lib/lang";
import { isNameKind, NameConflict, NameMissing, nameHistory, saveName } from "@/lib/names/store";

export const dynamic = "force-dynamic";

const MAX_NAME = 200;

export async function GET(request: Request) {
  const { lang, denied } = await requireIn(request, "edit");
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const entityId = params.get("entityId");
  if (!isNameKind(kind) || !entityId) {
    return Response.json({ error: "kind and entityId are required" }, { status: 400 });
  }
  return Response.json({ kind, entityId, versions: await nameHistory(kind, entityId, lang) });
}

export async function PUT(request: Request) {
  const { session, lang, denied } = await requireIn(request, "edit");
  if (denied) return denied;
  if (lang === BASE_LANG) {
    return Response.json({ error: "English names come from the corpus" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    kind?: unknown;
    entityId?: unknown;
    name?: unknown;
    note?: unknown;
    expectedVersion?: unknown;
  };
  if (!isNameKind(body.kind) || typeof body.entityId !== "string" || !body.entityId) {
    return Response.json({ error: "kind and entityId are required" }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > MAX_NAME) {
    return Response.json({ error: `name is required, at most ${MAX_NAME} characters` }, { status: 400 });
  }

  try {
    const version = await saveName({
      kind: body.kind,
      entityId: body.entityId,
      lang,
      name: body.name,
      note: typeof body.note === "string" ? body.note : null,
      editedBy: session.user.id,
      expectedVersion: Number.isInteger(body.expectedVersion) ? (body.expectedVersion as number) : null,
    });
    return Response.json({ version });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof NameConflict) return Response.json({ error: message }, { status: 409 });
    if (error instanceof NameMissing) return Response.json({ error: message }, { status: 404 });
    return Response.json({ error: message }, { status: 400 });
  }
}
