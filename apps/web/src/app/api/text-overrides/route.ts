/**
 * What a place, readable or boss line should say instead of its text, in the acting team.
 *
 * `regenerate` in the language (`?lang=`): an override changes what one file says, and the
 * person who listens to the result is the one regenerating it.
 *
 * The line is looked up in the base catalogue, whose original text is what the catalogue judges
 * the override's drift against, so the hash saved here is the one it compares.
 */
import { baseCatalogue as bossCatalogue } from "@/lib/bosses/catalogue";
import { requireIn } from "@/lib/generation/authz";
import type { Lang } from "@/lib/lang";
import { baseCatalogue as placeCatalogue } from "@/lib/places/catalogue";
import { baseCatalogue as readableCatalogue } from "@/lib/readables/catalogue";
import { MAX_TEXT } from "@/lib/text-api/apply";
import { clearTextOverride, viewOf, writeTextOverride } from "@/lib/text-overrides/store";
import type { NarratedSource } from "@/lib/text-overrides/types";

export const dynamic = "force-dynamic";

const SOURCES: readonly NarratedSource[] = ["places", "readables", "bosses"];

/** The line, and its original text in the language: null where the language has none. */
type Line = { original: string | null };

async function lineOf(source: NarratedSource, lang: Lang, lineId: string): Promise<Line | undefined> {
  if (source === "places") {
    const entry = (await placeCatalogue(lang)).find((e) => e.id === lineId);
    return entry && { original: entry.missing?.text ? null : entry.full };
  }
  if (source === "bosses") {
    const entry = (await bossCatalogue(lang)).find((e) => e.id === lineId);
    return entry && { original: entry.text };
  }
  const page = (await readableCatalogue(lang)).find((p) => p.id === lineId);
  return page && { original: page.missing?.text ? null : page.text };
}

function sourceOf(request: Request): NarratedSource | null {
  const raw = new URL(request.url).searchParams.get("source");
  return SOURCES.find((s) => s === raw) ?? null;
}

const BAD_SOURCE = () => Response.json({ error: `source must be one of ${SOURCES.join(", ")}` }, { status: 400 });
const UNKNOWN_LINE = () => Response.json({ error: "unknown line" }, { status: 404 });

export async function PUT(request: Request) {
  const { session, lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;
  const source = sourceOf(request);
  if (!source) return BAD_SOURCE();

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return Response.json({ error: "invalid override body" }, { status: 400 });
  }
  const { lineId, text: raw } = body;
  if (typeof lineId !== "string" || !lineId) return Response.json({ error: "lineId is required" }, { status: 400 });
  if (typeof raw !== "string") return Response.json({ error: "text must be a string" }, { status: 400 });
  const text = raw.trim();
  if (!text) return Response.json({ error: "text cannot be empty - remove the override instead" }, { status: 400 });
  if (text.length > MAX_TEXT) {
    return Response.json({ error: `text is too long (${MAX_TEXT} characters)` }, { status: 400 });
  }

  const line = await lineOf(source, lang, lineId);
  if (!line) return UNKNOWN_LINE();
  // The catalogue ignores an override on a line with no text, so it would never be voiced.
  // Filling the line in is a contribution's.
  if (line.original === null) {
    return Response.json({ error: `this line has no ${lang} text yet` }, { status: 409 });
  }

  const { override } = await writeTextOverride({
    source,
    lang,
    lineId,
    text,
    original: line.original,
    userId: session.user.id,
  });
  return Response.json({ override: viewOf(override, line.original) });
}

export async function DELETE(request: Request) {
  const { session, lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;
  const source = sourceOf(request);
  if (!source) return BAD_SOURCE();

  const lineId = new URL(request.url).searchParams.get("lineId");
  if (!lineId || !(await lineOf(source, lang, lineId))) return UNKNOWN_LINE();

  // 200 for a line with no override: the caller asked for it gone and it is, and a 404 would
  // make "revert" fail on a second click.
  return Response.json({ removed: await clearTextOverride({ source, lang, lineId, by: session.user.id }) });
}
