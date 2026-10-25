/**
 * The signed-in collaborator's generators: which one they spend with in a language, and
 * their settings for each.
 *
 * PUT saves the settings, which are one set for every language. POST activates a provider
 * for `?lang=` only (0046), since a language can be ready on one provider and not the other.
 *
 * Activating fish.audio needs a fish.audio key already stored, and ElevenLabs an ElevenLabs
 * one: a choice that could only fail would move the next batch onto a provider with nothing
 * to pay for it, and the failure would arrive in the queue rather than here.
 */
import { apiKeyStatus } from "@/lib/api-key";
import { currentSpender, requireIn } from "@/lib/generation/authz";
import {
  PreferenceError,
  validateElevenLabs,
  validateFish,
  writeGenerationSettings,
  writeProvider,
} from "@/lib/generation/preference";
import { isProvider, PROVIDER_NAME, PROVIDERS } from "@/lib/generation/providers";

export const dynamic = "force-dynamic";

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

export async function PUT(request: Request) {
  const session = await currentSpender();
  if (!session) return FORBIDDEN();

  const body = (await request.json().catch(() => ({}))) as { elevenlabs?: unknown; fish?: unknown };

  let settings;
  try {
    settings = { elevenlabs: validateElevenLabs(body.elevenlabs), fish: validateFish(body.fish) };
  } catch (error) {
    if (error instanceof PreferenceError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  await writeGenerationSettings(session.user.id, settings);
  return Response.json({ settings });
}

export async function POST(request: Request) {
  // Regenerate rather than configure: the choice only decides what the caller's own
  // regenerations in this language are spent on.
  const { session, lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { provider?: unknown };
  if (!isProvider(body.provider)) {
    return Response.json({ error: `provider must be one of ${PROVIDERS.join(", ")}` }, { status: 400 });
  }

  if (!(await apiKeyStatus(session.user.id, body.provider))) {
    return Response.json(
      { error: `store a ${PROVIDER_NAME[body.provider]} key before activating it` },
      { status: 409 },
    );
  }

  await writeProvider(session.user.id, lang, body.provider);
  return Response.json({ provider: body.provider, lang });
}
