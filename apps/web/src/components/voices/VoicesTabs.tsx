"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, Sparkles } from "lucide-react";

import { useLang } from "@/components/LangProvider";
import Link from "@/components/LocaleLink";
import VoiceSlotList from "@/components/VoiceSlotList";
import type { ReferenceView } from "@/components/FishReference";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PROVIDER_NAME, PROVIDERS, type Provider } from "@/lib/generation/providers";
import { langName, withLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import type { Sample } from "@/lib/voices/samples";
import type { VoiceSlot } from "@/lib/voices/slots";

import {
  ElevenLabsSettingsForm,
  FishSettingsForm,
  saveSettings,
  type ElevenLabsModelOption,
  type FishModelOption,
  type Settings,
} from "./GeneratorSettings";
import PopulateDialog from "./PopulateDialog";

/** Where each provider's key is set, on /profile. */
const KEY_ANCHOR: Record<Provider, string> = {
  elevenlabs: "/profile#elevenlabs-key",
  fish: "/profile#fish-key",
};

type Props = {
  initialTab: Provider;
  /** The generator the viewer spends with in this language. */
  active: Provider;
  keys: Record<Provider, boolean>;
  settings: Settings;
  elevenLabsModels: ElevenLabsModelOption[] | null;
  fishModels: FishModelOption[];
  slots: VoiceSlot[];
  initialSamples: Record<string, Sample[]>;
  /** Slots with seed clips to import in this language. */
  seedSlots: string[];
  initialReferences: Record<string, ReferenceView>;
  raceTags: Record<string, string>;
  /** Voice names in the viewer's ElevenLabs account, or null when it could not be read. */
  existing: string[] | null;
  /** Why the account could not be read, when there is a key to read it with. */
  accountError: string | null;
  manager: boolean;
  /** May change this language's directions. */
  directs: boolean;
};

/**
 * One language's voices, one provider at a time.
 *
 * The tab is only which provider is being looked at; which one lines are generated with is
 * Activate, per language, so browsing fish.audio's references never moves anybody's next
 * batch. The tab is kept in the URL without a navigation: the page reads the ElevenLabs
 * account on every render, and flipping a tab is no reason to ask it again.
 */
export default function VoicesTabs(props: Props) {
  const lang = useLang();
  const [tab, setTab] = useState(props.initialTab);
  const [active, setActive] = useState(props.active);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [settings, setSettings] = useState(props.settings);
  const [editing, setEditing] = useState(false);
  const [populating, setPopulating] = useState(false);
  const [samples, setSamples] = useState(props.initialSamples);
  const [references, setReferences] = useState(props.initialReferences);
  // Held as state so a voice flips to "in your account" without a reload; the server value
  // is the account, read fresh on every page view.
  const [present, setPresent] = useState(props.existing === null ? null : new Set(props.existing));
  // Counted up as the dialog fills slots, so its "free" never promises room already spent.
  // Null until /api/voices/subscription answers: ElevenLabs takes a second or more to say,
  // and nothing else on the page should wait for it.
  const [slotsUsed, setSlotsUsed] = useState<number | null>(null);
  const [slotLimit, setSlotLimit] = useState<number | null>(null);

  const hasElevenLabsKey = props.keys.elevenlabs;
  useEffect(() => {
    if (!hasElevenLabsKey) return;
    let cancelled = false;
    fetch(withLang(lang, "/api/voices/subscription"))
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { slotsUsed: number | null; slotLimit: number | null } | null) => {
        if (cancelled || !body) return;
        setSlotsUsed(body.slotsUsed);
        setSlotLimit(body.slotLimit);
      })
      // Unknown is drawn as no count at all, which is what a failure should look like too.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lang, hasElevenLabsKey]);

  function cloned(voice: string) {
    if (!present?.has(voice)) setSlotsUsed((used) => (used === null ? null : used + 1));
    setPresent((current) => new Set(current ?? []).add(voice));
  }

  function choose(next: Provider) {
    setTab(next);
    setActivateError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  async function activate() {
    setActivating(true);
    setActivateError(null);
    try {
      const response = await fetch(withLang(lang, "/api/voices/generator"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: tab }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `could not activate (${response.status})`);
      setActive(tab);
    } catch (error) {
      setActivateError(error instanceof Error ? error.message : String(error));
    } finally {
      setActivating(false);
    }
  }

  async function save(change: Partial<Settings>) {
    setSettings(await saveSettings({ ...settings, ...change }));
  }

  const total = props.slots.length;
  const cloneable = props.slots.filter((slot) => (samples[slot.name] ?? []).length > 0);
  const created = present ? props.slots.filter((slot) => present.has(slot.name)).length : null;
  const referenced = props.slots.filter((slot) => slot.name in references).length;
  const hasKey = props.keys[tab];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b">
        <div role="tablist" aria-label="Generator" className="flex gap-1">
          {PROVIDERS.map((provider) => (
            <button
              key={provider}
              role="tab"
              aria-selected={tab === provider}
              onClick={() => choose(provider)}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm",
                tab === provider
                  ? "border-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {PROVIDER_NAME[provider]}
              {active === provider && <Check className="size-3.5 text-emerald-400" aria-label="active" />}
            </button>
          ))}
        </div>

        {props.manager && (
          <Button
            size="xs"
            variant={editing ? "secondary" : "ghost"}
            className="mb-1 ml-auto"
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            <Pencil />
            {editing ? "Done editing sources" : "Edit sources"}
          </Button>
        )}
      </div>

      <section role="tabpanel" aria-label={PROVIDER_NAME[tab]} className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {active === tab ? (
            <Badge variant="outline" className="text-emerald-400">
              Active in {langName(lang)}
            </Badge>
          ) : (
            <Button size="sm" disabled={!hasKey || activating} onClick={activate}>
              {activating && <Loader2 className="animate-spin" />}
              Activate for {langName(lang)}
            </Button>
          )}
          {!hasKey && (
            <span className="text-muted-foreground text-xs">
              Needs a {PROVIDER_NAME[tab]} key —{" "}
              <Link href={KEY_ANCHOR[tab]} className="text-foreground underline underline-offset-2">
                add one on your profile
              </Link>
              .
            </span>
          )}
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            {tab === "elevenlabs"
              ? created === null
                ? `${total} voices`
                : `${created} of ${total} voices in your account`
              : `${referenced} of ${total} voices have a reference`}
          </span>
        </div>

        {activateError && (
          <p role="alert" className="text-destructive text-sm">
            {activateError}
          </p>
        )}
        {tab === "elevenlabs" && props.keys.elevenlabs && props.accountError && (
          <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            Could not read your ElevenLabs account: {props.accountError}
          </div>
        )}

        <details className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">
            {PROVIDER_NAME[tab]} settings
          </summary>
          <div className="pt-3">
            {tab === "elevenlabs" ? (
              <ElevenLabsSettingsForm
                key={JSON.stringify(settings.elevenlabs)}
                saved={settings.elevenlabs}
                models={props.elevenLabsModels}
                onSave={(elevenlabs) => save({ elevenlabs })}
              />
            ) : (
              <FishSettingsForm
                key={JSON.stringify(settings.fish)}
                saved={settings.fish}
                models={props.fishModels}
                onSave={(fish) => save({ fish })}
              />
            )}
          </div>
        </details>

        {tab === "elevenlabs" && props.keys.elevenlabs && present !== null && (
          <div>
            <Button size="sm" variant="outline" onClick={() => setPopulating(true)}>
              <Sparkles />
              Populate my account…
            </Button>
            <PopulateDialog
              open={populating}
              onClose={() => setPopulating(false)}
              cloneable={cloneable.map((slot) => slot.name)}
              present={present}
              slotsUsed={slotsUsed}
              slotLimit={slotLimit}
              onCloned={cloned}
            />
          </div>
        )}

        <VoiceSlotList
          tab={tab}
          slots={props.slots}
          present={present}
          setPresent={setPresent}
          samples={samples}
          setSamples={setSamples}
          seedSlots={props.seedSlots}
          references={references}
          setReferences={setReferences}
          raceTags={props.raceTags}
          directs={props.directs}
          editing={editing}
          canClone={props.keys.elevenlabs}
        />
      </section>
    </>
  );
}
