import type { Metadata } from "next";
import { notFound } from "next/navigation";

import BackstagePage from "@/components/backstage/BackstagePage";
import Workbench, { type GroupView, type SlotView } from "@/components/voice-design/Workbench";
import { apiKeyStatus } from "@/lib/api-key";
import type { CorpusLine } from "@/lib/corpus";
import { observedRate } from "@/lib/generation/calibration";
import { readPreference } from "@/lib/generation/preference";
import { viewerOf } from "@/lib/grants/store";
import { langName, withLang } from "@/lib/lang";
import { pageLang, readingLang } from "@/lib/lang-server";
import { can, canViewVoices, isAdmin } from "@/lib/permissions";
import { corpus, lineIndex } from "@/lib/quests/catalogue";
import { currentSession } from "@/lib/session";
import { fill } from "@/lib/site-text/format";
import { uiText } from "@/lib/ui-text";
import { groupOf } from "@/lib/voice-design/groups";
import { defaultSampleLines, previewTextCandidates, slotNpcs } from "@/lib/voice-design/lines";
import { liveTakes, liveTakeUrl } from "@/lib/voice-design/live";
import { latestAnalyses, listDesigns } from "@/lib/voice-design/store";
import type { Design } from "@/lib/voice-design/types";
import { cloneName } from "@/lib/voices/clone-name";
import { listReferences } from "@/lib/voices/references";
import { listSamples } from "@/lib/voices/samples";
import { slots } from "@/lib/voices/slots";

export const metadata: Metadata = { title: "Voice design · Spoken" };

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const t = (await uiText(await readingLang(lang))).voiceDesign;
  const session = await currentSession();
  // 404 rather than a redirect, as /voices: a member has no business learning this page exists.
  const viewer = session ? await viewerOf(session) : null;
  if (!session || !canViewVoices(viewer, lang)) notFound();
  const userId = session.user.id;

  const [all, designs, analyses, references, { lines }, index, eleven, gemini, rate] = await Promise.all([
    slots(lang),
    listDesigns(lang),
    latestAnalyses(lang),
    listReferences(lang),
    corpus(lang),
    lineIndex(lang),
    apiKeyStatus(userId),
    apiKeyStatus(userId, "gemini"),
    readPreference(userId, lang).then(async (preference) => ({
      model: preference.elevenlabs.modelId,
      perCharacter: (await observedRate(preference.elevenlabs.modelId)).rate,
    })),
  ]);
  // One pass over the corpus: each slot's helpers then read only its own lines.
  const byVoice = new Map<string, CorpusLine[]>();
  for (const line of lines) {
    const own = byVoice.get(line.voice);
    if (own) own.push(line);
    else byVoice.set(line.voice, [line]);
  }

  // The game clip a slot is heard by: what fish.audio speaks it from, else its first stored clip.
  const firstClips = new Map(
    await Promise.all(
      all.map(async (slot) => [slot.name, references.has(slot.name) ? null : ((await listSamples(cloneName(slot.name, lang)))[0]?.file ?? null)] as const),
    ),
  );
  const referenceUrl = (slot: string): string | null => {
    if (references.has(slot)) return withLang(lang, `/api/voices/${slot}/reference/audio`);
    const file = firstClips.get(slot);
    return file ? withLang(lang, `/api/voices/${slot}/samples/${encodeURIComponent(file)}`) : null;
  };

  // Players' votes are for the people who design the language's voices, not every viewer of /voices.
  const designer = can(viewer, "configure", lang);
  const bySlot = new Map<string, Design[]>();
  for (const found of designs) {
    const design = designer ? found : { ...found, showings: [] };
    bySlot.set(design.slot, [...(bySlot.get(design.slot) ?? []), design]);
  }

  const live = liveTakes(lang, index, designs.flatMap((design) => design.samples));

  const views: SlotView[] = all
    .filter((slot) => slot.name.split("-").length >= 2)
    .map((slot) => {
      const own = byVoice.get(slot.name) ?? [];
      const designed = bySlot.get(slot.name) ?? [];
      const candidates = previewTextCandidates(own, slot.name);
      // Candidates too: a version made from one after the page loaded still finds its line.
      const texts = new Set([...candidates, ...designed.map((design) => design.previewText)]);
      const previewLines: SlotView["previewLines"] = {};
      for (const line of own) {
        const text = line.text.trim();
        if (texts.has(text) && !previewLines[text]) previewLines[text] = { lineId: line.lineId, npcName: line.npcName, src: liveTakeUrl(lang, line) };
      }
      return {
        name: slot.name,
        group: groupOf(slot.name),
        lineCount: slot.lineCount,
        npcs: slotNpcs(own, slot.name),
        reference: referenceUrl(slot.name),
        candidates,
        sampleChars: defaultSampleLines(own, slot.name).reduce((sum, line) => sum + line.text.length, 0),
        previewLines,
        designs: designed,
      };
    });
  const groups: GroupView[] = [...new Set(views.map((slot) => slot.group))].map((group) => ({
    group,
    analysis: analyses.get(group) ?? null,
    slots: views.filter((slot) => slot.group === group),
  }));

  return (
    <BackstagePage title={fill(t.title, { lang: langName(lang) })} description={t.lede} width="wide">
      <Workbench
        groups={groups}
        live={live}
        viewer={{ id: userId, designs: designer, admin: isAdmin(session.user.role) }}
        keys={{ elevenlabs: eleven !== null, gemini: gemini !== null }}
        rate={rate.perCharacter}
        model={rate.model}
      />
    </BackstagePage>
  );
}
