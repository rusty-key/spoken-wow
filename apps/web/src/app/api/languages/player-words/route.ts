/**
 * What a language's recordings say for the player's name, class and race, and a writ's count (?lang=).
 *
 * A row's words replace a built-in language's own; clearing them returns to Spoken's. They
 * change the text every team of the language voices, so they take `text`, as the original text does.
 */
import { requireIn } from "@/lib/generation/authz";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import { setPlayerWords } from "@/lib/languages/store";
import { PLAYER_WORD_LIMIT, validPlayerWords } from "@/lib/player-words";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const { session, lang, denied } = await requireIn(request, "text");
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { words?: unknown } | null;
  if (!body || !("words" in body)) return Response.json({ error: "expected { words }" }, { status: 400 });
  const words = body.words === null ? null : validPlayerWords(body.words);
  if (body.words !== null && !words) {
    return Response.json(
      {
        error: `each reader needs a name and a race; every word, the writ's count and declined forms too, at most ${PLAYER_WORD_LIMIT} characters, with no $, :, ; or line break; a case is a digit 1 to 9`,
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
