/**
 * A page's words, read and rewritten.
 *
 * The readables twin of /api/places/lore, and the thing readables has been missing: book_line has
 * been versioned since 0026 and nothing ever wrote an `edited` row, so a mistake somebody
 * reported in a book could be read and triaged but not fixed. Feedback about a book was a
 * queue of things nobody could act on.
 *
 * Guarded at the regenerate level -- a grant in the language -- rather than the lexicon's admin
 * level, for the reason the places route gives: a pronunciation rule is global and changes
 * what every later line costs, while a rewrite is one page, fully reversible through the
 * version history, and belongs with the other per-page judgements a regenerator makes.
 *
 * EDITING DOES NOT REGENERATE. The new text hashes differently from the take that was
 * spoken, so the page reads "audio outdated" and joins the worklist. Coupling a free action
 * to a paid one is how a typo fix ends up costing credits.
 */
import { requireIn } from "@/lib/generation/authz";
import { isKnownLine } from "@/lib/readables/catalogue";
import {
  BookConflict,
  BookMissing,
  bookHistory,
  restoreBookText,
  saveBookText,
} from "@/lib/readables/text";

export const dynamic = "force-dynamic";

function failed(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof BookConflict) return Response.json({ error: message }, { status: 409 });
  if (error instanceof BookMissing) return Response.json({ error: message }, { status: 404 });
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const { lang, denied } = await requireIn(request, "text");
  if (denied) return denied;

  const lineId = new URL(request.url).searchParams.get("lineId");
  if (!lineId) return Response.json({ error: "lineId is required" }, { status: 400 });

  return Response.json({ lineId, versions: await bookHistory(lineId, lang) });
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
  // Nothing here has a foreign key onto the catalogue, so this is what stops a typo
  // becoming a row nothing will ever show or clean up.
  if (!(await isKnownLine(body.lineId))) {
    return Response.json({ error: `unknown lineId ${body.lineId}` }, { status: 400 });
  }

  try {
    const version = await saveBookText({
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
    const version = await restoreBookText(body.lineId, body.version as number, lang, session.user.id);
    return Response.json({ lineId: body.lineId, version });
  } catch (error) {
    return failed(error);
  }
}
