import { readSettings, SettingsError, validateRaceTags, writeRaceTags } from "@/lib/generation/settings";
import { withToken } from "@/lib/text-api/guard";
import { invalid } from "@/lib/text-api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withToken(request, { noQuery: true }, async (context) =>
    Response.json({ lang: context.lang, raceTags: (await readSettings(context.lang)).config.raceTags }),
  );
}

/** The whole map, so a removal can be sent: a race left out loses its tag. */
export async function PATCH(request: Request) {
  return withToken(request, { need: "write", also: "configure", noQuery: true }, async (context) => {
    const body = (await request.json().catch(() => null)) as { raceTags?: unknown } | null;
    let tags;
    try {
      tags = validateRaceTags(body?.raceTags);
    } catch (error) {
      if (error instanceof SettingsError) return invalid(error.message);
      throw error;
    }
    await writeRaceTags(tags, context.userId, context.lang);
    return Response.json({ lang: context.lang, raceTags: (await readSettings(context.lang)).config.raceTags });
  });
}
