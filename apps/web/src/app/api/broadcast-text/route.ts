/**
 * BroadcastText rows read from a player's DBCache.bin, for one client language.
 *
 * The page parses the cache in the browser (lib/broadcast/cache.ts) and posts only the rows.
 * Signed-in only, unlike a contribution: these rows decide which line a text in another
 * language belongs to, so whoever sent them has to be someone we can ask.
 */
import { recordUpload, sameAsEnglish, uniqueById, type BroadcastRow } from "@/lib/broadcast/store";
import { BASE_LANG, isClientLang, isLang } from "@/lib/lang";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// A long-played client caches a few thousand rows; one file is never near this.
const MAX_TEXTS = 20_000;
// BroadcastText rows are a paragraph or two; this only stops a body built to fill the table.
const MAX_TEXT = 4_000;
const MAX_ID = 2_147_483_647;

// Below this many rows English also has, a match rate says nothing.
const MIN_COMPARED = 3;

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "sign in to send a cache" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { lang?: unknown; build?: unknown; texts?: unknown }
    | null;
  const lang = body?.lang;
  // A cache is written by a game client, and no client runs in Italian.
  if (!isLang(lang) || !isClientLang(lang)) return Response.json({ error: "unknown language" }, { status: 400 });
  const raw = body?.build;
  const build = typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : null;
  if (!Array.isArray(body?.texts) || body.texts.length > MAX_TEXTS) {
    return Response.json({ error: "expected { lang, build, texts: [...] }" }, { status: 400 });
  }

  const texts = uniqueById((body.texts as Partial<BroadcastRow>[]).filter(
    (row): row is BroadcastRow =>
      Number.isInteger(row?.id) && row.id! > 0 && row.id! <= MAX_ID &&
      typeof row.text === "string" && typeof row.text1 === "string" &&
      row.text.length <= MAX_TEXT && row.text1.length <= MAX_TEXT &&
      (row.text.length > 0 || row.text1.length > 0),
  ));

  if (lang !== BASE_LANG) {
    const { compared, same } = await sameAsEnglish(texts);
    if (compared >= MIN_COMPARED && same * 2 > compared) {
      return Response.json(
        { error: "these read like English -- pick the cache from the folder named for this language" },
        { status: 400 },
      );
    }
  }

  return Response.json(await recordUpload(session.user.id, lang, build, texts));
}
