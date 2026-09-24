import { viewerOf } from "@/lib/grants/store";
import { BASE_LANG } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import LexiconEditor from "@/components/LexiconEditor";
import { readApiKey } from "@/lib/api-key";
import { auth } from "@/lib/auth";
import { readLexicon } from "@/lib/generation/dictionary";
import { previewCache, voicePicker } from "@/lib/generation/preview";
import { generationStatus } from "@/lib/generation/status";
import { can } from "@/lib/permissions";
import { readPreference, speakingConfig } from "@/lib/generation/preference";

export const metadata: Metadata = { title: "Pronunciation · Spoken" };

// The lexicon is a database row and the sync state changes underneath it, so nothing here
// can be cached between views.
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await auth.api.getSession({ headers: await headers() });

  // 404 rather than a redirect, matching /voices and /admin: a member has no business
  // learning that this page exists. Per language: each has its own lexicon, looked after by
  // whoever configures it.
  if (!session || !can(await viewerOf(session), "configure", lang)) notFound();
  const english = lang === BASE_LANG;

  // The admin's own key: which voices the account has decides which one each preview would
  // be spoken in, and with no key there are none - every button then simply says it costs
  // money, which is true and harmless.
  const apiKey = await readApiKey(session.user.id).catch(() => null);

  const [lexicon, preference, status] = await Promise.all([
    readLexicon(lang),
    readPreference(session.user.id, lang),
    generationStatus(apiKey ? { apiKey } : {}, lang),
  ]);
  // This editor's own ElevenLabs settings, which are what a preview is spoken with and what
  // decides whether a phoneme rule is honoured.
  const config = await speakingConfig(preference.elevenlabs, lang);

  // Resolved here rather than in the browser: knowing whether a preview is cached means
  // knowing which corpus sentence it would use, which is a pass over 17,507 lines. Doing it
  // once on the server beats 268 round trips, and it is what lets each button say up front
  // whether pressing it costs money.
  //
  // English only: the preview sentences are English's (see the preview route).
  const cached = english
    ? await previewCache(lexicon.entries, voicePicker(status.voiceIds), config)
    : {};

  return (
    <main className="mx-auto max-w-6xl px-5 pt-6 pb-36">
      <h1 className="text-xl font-semibold">Pronunciation</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        How the names the corpus uses should be said. Each entry becomes a rule in a
        pronunciation dictionary, matched case-insensitively at word boundaries, and every line
        generated afterwards is spoken with it: ElevenLabs takes the IPA when an entry has one
        and the respelling otherwise, and fish.audio takes the IPA in English only. Only names a
        plain reader gets wrong belong here — a rule for a name it already handles can only make
        that name worse.
      </p>

      <LexiconEditor
        initial={lexicon}
        modelId={config.modelId}
        provider={preference.provider}
        initialCache={cached}
      />
    </main>
  );
}
