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
import { generationRoster } from "@/lib/generation/status";
import { can } from "@/lib/permissions";
import { readGenerationSettings, speakingConfig } from "@/lib/generation/preference";
import { Contained, Wide } from "@/components/Width";

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
  // Started before anything else is awaited, and not awaited here: the editor draws at once
  // and the cache markers stream in after it. English only: the preview sentences are
  // English's (see the preview route). No key, no account, and every marker stays off.
  const roster = english && apiKey ? generationRoster({ apiKey }, lang) : null;

  const [lexicon, preference] = await Promise.all([
    readLexicon(lang),
    readGenerationSettings(session.user.id),
  ]);
  // This editor's own ElevenLabs settings, which are what a preview is spoken with and what
  // decides whether a phoneme rule is honoured.
  const config = await speakingConfig(preference.elevenlabs, lang);

  // Resolved here rather than in the browser: knowing whether a preview is cached means
  // knowing which corpus sentence it would use, which is a pass over 17,507 lines. Doing it
  // once on the server beats 268 round trips, and it is what lets each button say up front
  // whether pressing it costs money.
  //
  // The corpus loads while ElevenLabs answers: only the voice picked for each line needs it.
  const cached =
    roster &&
    previewCache(
      lexicon.entries,
      roster.then((read) => voicePicker(read.voiceIds)),
      config,
    ).then(async (cache) => ({ cache, error: (await roster).error }));

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Pronunciation</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          How ElevenLabs should say the names the corpus uses. Each entry becomes a phoneme rule
          in a pronunciation dictionary, matched case-insensitively at word boundaries, and every
          line generated afterwards is spoken with it. Only names a plain reader gets wrong belong
          here — a rule for a name it already handles can only make that name worse.
        </p>
      </Contained>
      <Wide>
        <LexiconEditor initial={lexicon} modelId={config.modelId} initialCache={cached} />
      </Wide>
    </main>
  );
}
