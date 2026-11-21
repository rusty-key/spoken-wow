/**
 * The words themselves, read and rewritten.
 *
 * Guarded at the regenerate level -- a grant in the language -- rather than the lexicon's
 * admin level. A pronunciation rule is global: it changes the spoken text of every line
 * containing the word, and therefore what a regeneration pass costs next. A rewrite is one
 * line, fully reversible through the version history, and belongs with the other per-line
 * judgements whoever regenerates it already makes.
 *
 * EDITING DOES NOT REGENERATE. The new text hashes differently from the take that was
 * spoken, so the line simply reads "text changed" and joins the worklist like any other
 * stale line. Coupling a free action to a paid one is how a typo fix ends up costing
 * credits.
 *
 * Nothing here drops the catalogue's memo. It is validated against a stamp the table
 * itself carries, so a save by one worker is seen by the other on its next read -- which
 * is the half the zones site could not have, running one worker with an in-process
 * invalidation. See the note on the memo in lib/places/catalogue.ts.
 */
import { requireIn } from "@/lib/generation/authz";
import { isKnownLine } from "@/lib/places/catalogue";
import { LoreConflict, LoreMissing, loreHistory, restoreLore, saveLore } from "@/lib/places/lore";

export const dynamic = "force-dynamic";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failed(error: unknown): Response {
  if (error instanceof LoreConflict) return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof LoreMissing) return Response.json({ error: error.message }, { status: 404 });
  return Response.json({ error: message(error) }, { status: 400 });
}

export async function GET(request: Request) {
  const { lang, denied } = await requireIn(request, "text");
  if (denied) return denied;

  const lineId = new URL(request.url).searchParams.get("lineId");
  if (!lineId) return Response.json({ error: "lineId is required" }, { status: 400 });

  return Response.json({ lineId, versions: await loreHistory(lineId, lang) });
}

export async function PUT(request: Request) {
  const { session, lang, denied } = await requireIn(request, "text");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    lineId?: unknown;
    full?: unknown;
    short?: unknown;
    note?: unknown;
    expectedVersion?: unknown;
  };

  if (typeof body.lineId !== "string" || body.lineId === "") {
    return Response.json({ error: "lineId is required" }, { status: 400 });
  }
  if (typeof body.full !== "string" || body.full.trim() === "") {
    return Response.json({ error: "full is required" }, { status: 400 });
  }
  if (body.short !== undefined && body.short !== null && typeof body.short !== "string") {
    return Response.json({ error: "short must be a string or null" }, { status: 400 });
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
  // Same reasoning as the flags route: nothing here has a foreign key onto the catalogue,
  // so this is what stops a typo becoming a row nothing will ever show.
  if (!(await isKnownLine(body.lineId))) {
    return Response.json({ error: `unknown lineId ${body.lineId}` }, { status: 400 });
  }

  try {
    const version = await saveLore({
      lang,
      lineId: body.lineId,
      full: body.full,
      short: (body.short as string | null | undefined) ?? null,
      note: (body.note as string | null | undefined) ?? null,
      editedBy: session.user.id,
      expectedVersion: (body.expectedVersion as number | null | undefined) ?? null,
    });
    return Response.json({ lineId: body.lineId, version });
  } catch (error) {
    return failed(error);
  }
}

/** Puts an earlier version of the text back. */
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
    const version = await restoreLore(body.lineId, body.version as number, lang, session.user.id);
    return Response.json({ lineId: body.lineId, version });
  } catch (error) {
    return failed(error);
  }
}
