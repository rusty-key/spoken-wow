/**
 * The accent direction for each race.
 *
 * Its own endpoint rather than a field of PUT ../settings, because the two are edited in
 * different places: a tag is set on /voices while looking at that race's voices, and the
 * model and sliders are set once in the settings form. Sharing a write would let a tag edit
 * revert a model change made a minute earlier in another tab.
 *
 * `configure` in the page's language, not `regenerate`: a direction applies to every line of
 * that race anyone generates in the language afterwards. The language's own, so its grant is
 * enough, as for its lexicon.
 */
import { requireIn } from "@/lib/generation/authz";
import { readSettings, SettingsError, validateRaceTags, writeRaceTags } from "@/lib/generation/settings";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const { session, lang, denied } = await requireIn(request, "configure");
  if (denied) return denied;

  let tags;
  try {
    // The whole map, not one race: removing a tag is as much an edit as adding one, and a
    // merge could not express it.
    tags = validateRaceTags((await request.json())?.raceTags);
  } catch (error) {
    // Same split as PUT ../settings: only SettingsError text is safe to hand back verbatim.
    const message = error instanceof SettingsError ? error.message : "invalid raceTags body";
    return Response.json({ error: message }, { status: 400 });
  }

  await writeRaceTags(tags, session.user.id, lang);
  return Response.json(await readSettings(lang));
}
