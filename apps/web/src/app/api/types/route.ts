/**
 * An admin's edits to the types an NPC can be (the Types tab of /npcs): add a type with or
 * without genders, give it a gender or a flavor, relabel or delete it, and choose the voice
 * each combination is read with.
 *
 * One route, an `action` per edit, because every edit answers with the whole roster: the tab
 * redraws from what is stored, not from what it hoped to store.
 */
import { recordActivity } from "@/lib/activity/store";
import { requireAdmin } from "@/lib/admin-guard";
import { rosterData } from "@/lib/voices/roster-store";
import {
  addFlavor,
  addGender,
  addType,
  assignVoice,
  deleteFlavor,
  deleteType,
  labelType,
  TypesError,
} from "@/lib/voices/types-store";

export const dynamic = "force-dynamic";

const ACTIONS: Record<string, (body: Record<string, unknown>) => Promise<void>> = {
  "add-type": (b) => addType(b.key, b.label, b.genders),
  "label-type": (b) => labelType(b.key, b.label),
  "delete-type": (b) => deleteType(b.key),
  "add-gender": (b) => addGender(b.race, b.gender),
  "add-flavor": (b) => addFlavor(b.race, b.gender, b.flavor, b.label),
  "delete-flavor": (b) => deleteFlavor(b.race, b.gender, b.flavor),
  "assign-voice": (b) => assignVoice(b.race, b.gender, b.flavor, b.voice),
};

export async function POST(request: Request) {
  const { lang, session, denied } = await requireAdmin(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? ACTIONS[body.action] : undefined;
  if (!action) return Response.json({ error: "unknown action" }, { status: 400 });

  try {
    await action(body);
  } catch (error) {
    if (error instanceof TypesError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }

  await recordActivity({
    kind: "type.changed",
    lang,
    actorId: session.user.id,
    subject: String(body.key ?? body.race ?? ""),
    detail: { action: String(body.action), gender: str(body.gender), flavor: str(body.flavor), voice: str(body.voice) },
  });
  return Response.json({ roster: await rosterData() });
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
