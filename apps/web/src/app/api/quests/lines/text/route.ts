/**
 * A quest line's text in a language other than English: its history, a new version, or an
 * earlier one put back. Nothing in the site calls this: the explorer's pencil writes overrides.
 *
 * All three need `text` in the language (`?lang=`), which is what a translator holds.
 */
import { requireIn } from "@/lib/generation/authz";
import { BASE_LANG } from "@/lib/lang";
import {
  QuestTextConflict,
  QuestTextMissing,
  questTextHistory,
  restoreQuestText,
  saveQuestText,
} from "@/lib/quests/text";

export const dynamic = "force-dynamic";

const MAX_TEXT = 5_000;

function failed(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof QuestTextConflict) return Response.json({ error: message }, { status: 409 });
  if (error instanceof QuestTextMissing) return Response.json({ error: message }, { status: 404 });
  return Response.json({ error: message }, { status: 400 });
}

function englishRefused(): Response {
  return Response.json(
    { error: "English lines have no versions to edit here" },
    { status: 400 },
  );
}

function variantOf(value: unknown): number | null {
  const variant = typeof value === "string" ? Number(value) : value;
  return typeof variant === "number" && Number.isInteger(variant) && variant >= 0 ? variant : null;
}

export async function GET(request: Request) {
  const { lang, denied } = await requireIn(request, "text");
  if (denied) return denied;
  if (lang === BASE_LANG) return englishRefused();

  const params = new URL(request.url).searchParams;
  const lineId = params.get("lineId");
  const variant = variantOf(params.get("variant") ?? "0");
  if (!lineId || variant === null) {
    return Response.json({ error: "lineId and variant are required" }, { status: 400 });
  }
  return Response.json({ lineId, variant, versions: await questTextHistory(lineId, variant, lang) });
}

export async function PUT(request: Request) {
  const { session, lang, denied } = await requireIn(request, "text");
  if (denied) return denied;
  if (lang === BASE_LANG) return englishRefused();

  const body = (await request.json().catch(() => ({}))) as {
    lineId?: unknown;
    variant?: unknown;
    text?: unknown;
    note?: unknown;
    expectedVersion?: unknown;
  };
  const variant = variantOf(body.variant ?? 0);
  if (typeof body.lineId !== "string" || !body.lineId || variant === null) {
    return Response.json({ error: "lineId and variant are required" }, { status: 400 });
  }
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > MAX_TEXT) {
    return Response.json({ error: `text is required, at most ${MAX_TEXT} characters` }, { status: 400 });
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
    return Response.json({ error: "note must be a string or null" }, { status: 400 });
  }

  try {
    const version = await saveQuestText({
      lineId: body.lineId,
      variant,
      lang,
      text: body.text,
      note: (body.note as string | null | undefined) ?? null,
      editedBy: session.user.id,
      expectedVersion: Number.isInteger(body.expectedVersion) ? (body.expectedVersion as number) : null,
    });
    return Response.json({ lineId: body.lineId, version });
  } catch (error) {
    return failed(error);
  }
}

export async function POST(request: Request) {
  const { session, lang, denied } = await requireIn(request, "text");
  if (denied) return denied;
  if (lang === BASE_LANG) return englishRefused();

  const body = (await request.json().catch(() => ({}))) as {
    lineId?: unknown;
    variant?: unknown;
    version?: unknown;
  };
  const variant = variantOf(body.variant ?? 0);
  if (typeof body.lineId !== "string" || variant === null || !Number.isInteger(body.version)) {
    return Response.json({ error: "lineId, variant and version are required" }, { status: 400 });
  }
  try {
    const version = await restoreQuestText(
      body.lineId,
      variant,
      lang,
      body.version as number,
      session.user.id,
    );
    return Response.json({ lineId: body.lineId, version });
  } catch (error) {
    return failed(error);
  }
}
