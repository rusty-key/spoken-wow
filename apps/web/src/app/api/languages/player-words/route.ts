/**
 * What a language's recordings say for the player's name, class and race (?lang=).
 *
 * Only a language whose words are not code has any here: a team's. They change the text every
 * team of the language voices, so they take `text`, as the original text does.
 */
import { requireIn } from "@/lib/generation/authz";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import { setPlayerWords } from "@/lib/languages/store";
import { hasBuiltinPlayerWords, PLAYER_WORD_LIMIT, validPlayerWords } from "@/lib/player-words";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const { session, lang, denied } = await requireIn(request, "text");
  if (denied) return denied;
  if (hasBuiltinPlayerWords(lang)) {
    return Response.json({ error: "this language's player words are part of Spoken" }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as { words?: unknown } | null;
  if (!body || !("words" in body)) return Response.json({ error: "expected { words }" }, { status: 400 });
  const words = body.words === null ? null : validPlayerWords(body.words);
  if (body.words !== null && !words) {
    return Response.json(
      {
        error: `each reader needs a name and a race, of at most ${PLAYER_WORD_LIMIT} characters, with no $, :, ; or line break`,
      },
      { status: 400 },
    );
  }

  await setPlayerWords(lang, words, session.user.id);
  // Registered here before answering; the row's notify tells the other worker.
  forgetLanguages();
  await loadLanguages();
  return new Response(null, { status: 204 });
}
