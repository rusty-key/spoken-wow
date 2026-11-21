/**
 * A boss's story in one language, read, rewritten and restored.
 *
 * /api/places/lore's contract with one text in place of full and short, and the same
 * reasons behind it: guarded by `text` in `?lang=`, and editing never regenerates -- the new
 * text hashes differently from the live take, so the row reads stale until somebody pays to
 * voice it.
 *
 * A save in a language with no story yet writes that language's first version. Nothing is
 * copied from English.
 */
import { requireIn } from "@/lib/generation/authz";
import { isKnownLine } from "@/lib/bosses/catalogue";
import { restoreStory, saveStory, StoryConflict, StoryMissing, storyHistory } from "@/lib/bosses/story";

export const dynamic = "force-dynamic";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failed(error: unknown): Response {
  if (error instanceof StoryConflict) return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof StoryMissing) return Response.json({ error: error.message }, { status: 404 });
  return Response.json({ error: message(error) }, { status: 400 });
}

export async function GET(request: Request) {
  const { lang, denied } = await requireIn(request, "text");
  if (denied) return denied;

  const lineId = new URL(request.url).searchParams.get("lineId");
  if (!lineId) return Response.json({ error: "lineId is required" }, { status: 400 });

  return Response.json({ lineId, versions: await storyHistory(lineId, lang) });
}

export async function PUT(request: Request) {
  const { session, lang, denied } = await requireIn(request, "text");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    lineId?: unknown;
    text?: unknown;
    note?: unknown;
    expectedVersion?: unknown;
  };

  if (typeof body.lineId !== "string" || body.lineId === "") {
    return Response.json({ error: "lineId is required" }, { status: 400 });
  }
  if (typeof body.text !== "string" || body.text.trim() === "") {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
    return Response.json({ error: "note must be a string or null" }, { status: 400 });
  }
  if (
    body.expectedVersion !== undefined &&
    body.expectedVersion !== null &&
    !Number.isInteger(body.expectedVersion)
  ) {
    return Response.json({ error: "expectedVersion must be an integer" }, { status: 400 });
  }
  // A retired boss is no line on the site, so it cannot be written to either.
  if (!(await isKnownLine(body.lineId))) {
    return Response.json({ error: `unknown lineId ${body.lineId}` }, { status: 404 });
  }

  try {
    const version = await saveStory({
      lang,
      lineId: body.lineId,
      text: body.text,
      note: (body.note as string | null | undefined) ?? null,
      editedBy: session.user.id,
      expectedVersion: (body.expectedVersion as number | null | undefined) ?? null,
    });
    return Response.json({ lineId: body.lineId, version });
  } catch (error) {
    return failed(error);
  }
}

/** Puts an earlier version of the story back. */
export async function POST(request: Request) {
  const { session, lang, denied } = await requireIn(request, "text");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    lineId?: unknown;
    version?: unknown;
  };

  if (typeof body.lineId !== "string" || body.lineId === "") {
    return Response.json({ error: "lineId is required" }, { status: 400 });
  }
  if (!Number.isInteger(body.version)) {
    return Response.json({ error: "version must be an integer" }, { status: 400 });
  }

  try {
    const version = await restoreStory(body.lineId, body.version as number, lang, session.user.id);
    return Response.json({ lineId: body.lineId, version });
  } catch (error) {
    return failed(error);
  }
}
