import { cloneName } from "@/lib/voices/clone-name";
import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import VoicesTabs from "@/components/voices/VoicesTabs";
import { apiKeyStatus, readApiKey } from "@/lib/api-key";
import { readPreference } from "@/lib/generation/preference";
import { isProvider } from "@/lib/generation/providers";
import { readSettings } from "@/lib/generation/settings";
import { generationRoster } from "@/lib/generation/status";
import { voiceStudioSpeaker } from "@/lib/generation/speakers/voicestudio";
import { viewerOf } from "@/lib/grants/store";
import { can, canManageVoices, canViewVoices } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { FISH_MODELS } from "@/lib/voices/fish";
import { seedClips } from "@/lib/voices/seedClips";
import { listReferences } from "@/lib/voices/references";
import { listSamples, type Sample } from "@/lib/voices/samples";
import { slots } from "@/lib/voices/slots";
import { Contained } from "@/components/Width";

export const metadata: Metadata = { title: "Voices · Spoken" };

// The account state is read live on every view: a voice created in the ElevenLabs dashboard
// rather than here should still show up, since the generator would find it either way.
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const lang = await pageLang(params);
  const session = await currentSession();

  // 404 rather than a redirect, matching /admin: a member has no business learning that
  // this page exists. Open to whoever spends in the language, because this is where they
  // choose what they spend with; what the voices are made from stays an admin's, inside.
  const viewer = session ? await viewerOf(session) : null;
  if (!session || !canViewVoices(viewer, lang)) notFound();
  const userId = session.user.id;

  // The statuses, never the keys: sent to a client component as props.
  const [all, elevenStatus, fishStatus, voiceStudioStatus, preference, elevenKey, voiceStudioKey, settings, references] =
    await Promise.all([
      slots(),
      apiKeyStatus(userId),
      apiKeyStatus(userId, "fish"),
      apiKeyStatus(userId, "voicestudio"),
      readPreference(userId, lang),
      // A row that will not open reads as none; /profile says which of the two it was.
      readApiKey(userId).catch(() => null),
      readApiKey(userId, "voicestudio").catch(() => null),
      // The accent tags: the voices are everyone's, but how each language speaks them is its own.
      readSettings(lang),
      // Not the account's: a fish.audio reference is a row here, the same for every key.
      listReferences(lang),
    ]);

  // The viewer's own account, since the generator resolves voices by name against the key
  // generating: this is the roster their lines would be spoken from. The page's language's
  // clones only -- a slot filled in English is empty in German until German clips are cloned.
  // Without the subscription, which is the slow one of ElevenLabs' answers: VoicesTabs asks
  // for the slot count once the page is up.
  const account = elevenKey ? await generationRoster({ apiKey: elevenKey }, lang) : null;
  const readable = account !== null && !(account.error && account.voiceIds.size === 0);
  const voiceStudioAccount = voiceStudioStatus
    ? await voiceStudioSpeaker({ apiKey: voiceStudioKey ?? "" }).voices(lang)
    : null;

  // One readdir per slot, so the roster arrives with its clip counts already filled in
  // rather than each row fetching its own once expanded.
  const samples: Record<string, Sample[]> = Object.fromEntries(
    await Promise.all(
      all.map(async (slot) => [slot.name, await listSamples(cloneName(slot.name, lang))] as const),
    ),
  );

  // The slots voice/seed-clips can seed, read off the directory rather than guessed from the
  // name: a bare slot like bloodelf-female has clips and bloodelf-male has none, and another
  // language's set is only there once it has been fetched and pushed.
  const seedSlots = (
    await Promise.all(
      all.map(async (slot) =>
        (await seedClips(cloneName(slot.name, lang))).length > 0 ? slot.name : null,
      ),
    )
  ).filter((name) => name !== null);

  const { tab } = await searchParams;

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="mb-4 text-xl font-semibold">Voices</h1>
        <VoicesTabs
          initialTab={isProvider(tab) ? tab : preference.provider}
          active={preference.provider}
          keys={{
            elevenlabs: elevenStatus !== null,
            fish: fishStatus !== null,
            voicestudio: voiceStudioStatus !== null,
          }}
          settings={{ elevenlabs: preference.elevenlabs, fish: preference.fish }}
          elevenLabsModels={
            readable ? account.models.map((model) => ({ id: model.id, name: model.name })) : null
          }
          fishModels={FISH_MODELS.map((model) => ({
            id: model.id,
            label: model.label,
            preview: model.preview,
            price:
              model.usdPerMillionBytes === null
                ? "price not published"
                : model.usdPerMillionBytes === 0
                  ? "free"
                  : `$${model.usdPerMillionBytes} per million bytes`,
          }))}
          slots={all}
          initialSamples={samples}
          seedSlots={seedSlots}
          initialReferences={Object.fromEntries(references)}
          raceTags={settings.config.raceTags}
          existing={readable ? [...account.voiceIds.keys()] : null}
          accountError={account?.error ?? null}
          voiceStudioExisting={voiceStudioAccount ? [...voiceStudioAccount.ids.keys()] : null}
          voiceStudioError={voiceStudioAccount?.error ?? null}
          voiceStudioModel={process.env.VOICESTUDIO_MODEL ?? "omnivoice"}
          manager={canManageVoices(session.user.role)}
          directs={can(viewer, "configure", lang)}
        />
      </Contained>
    </main>
  );
}
