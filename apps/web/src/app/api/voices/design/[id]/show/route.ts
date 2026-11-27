/** Show to players: /listen plays this version from now on, with a fresh round of votes. */
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { readDesign } from "@/lib/voice-design/store";
import { showVersion } from "@/lib/voice-feedback/showings";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  try {
    await showVersion(lang, id, session.user.id);
    return Response.json({ design: await readDesign(lang, id) });
  } catch (error) {
    return failed(error);
  }
}
