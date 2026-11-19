"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, SlidersHorizontal, Sparkles } from "lucide-react";

import { useLang } from "@/components/LangProvider";
import Link from "@/components/LocaleLink";
import VoiceSlotList from "@/components/VoiceSlotList";
import type { ReferenceView } from "@/components/FishReference";
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
import { useSettled } from "@/components/useSettled";

/** Where each provider's key is set, on /profile. */
const KEY_ANCHOR: Record<Provider, string> = {
  elevenlabs: "/profile#elevenlabs-key",
  fish: "/profile#fish-key",
};

/** The viewer's ElevenLabs account as the page needs it, once ElevenLabs has answered. */
type AccountView = {
  /** Null when the account could not be read. */
  models: ElevenLabsModelOption[] | null;
  /** Voice names in the account, or null when it could not be read. */
  existing: string[] | null;
  /** Why the account could not be read, or null. */
  error: string | null;
};

type Props = {
  initialTab: Provider;
  /** The generator the viewer spends with in this language. */
  active: Provider;
  keys: Record<Provider, boolean>;
  settings: Settings;
  /**
   * The account, still being read when the page arrives: ElevenLabs is not allowed to hold
   * the page back. Resolves to null when there is no key to read it with.
   */
  account: Promise<AccountView | null>;
  fishModels: FishModelOption[];
  slots: VoiceSlot[];
  initialSamples: Record<string, Sample[]>;
  /** Slots with seed clips to import in this language. */
  seedSlots: string[];
  initialReferences: Record<string, ReferenceView>;
  raceTags: Record<string, string>;
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
/** What the ElevenLabs settings say under the model picker about where its options stand. */
function modelsNote(
  hasKey: boolean,
  reading: boolean,
  account: AccountView | null | undefined,
): string | null {
  if (!hasKey) return "The models your account offers appear once an ElevenLabs key is stored.";
  if (reading) return "Reading the models your account offers…";
  if (account?.models) return null;
  return "Your account's models could not be read, so only the saved one is offered.";
}

export default function VoicesTabs(props: Props) {
  const lang = useLang();
  const [tab, setTab] = useState(props.initialTab);
  const [active, setActive] = useState(props.active);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [settings, setSettings] = useState(props.settings);
  const [editing, setEditing] = useState(false);
  const [populating, setPopulating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [samples, setSamples] = useState(props.initialSamples);
  const [references, setReferences] = useState(props.initialReferences);
  const settled = useSettled(props.account);
  const account: AccountView | null | undefined =
    settled &&
    ("value" in settled ? settled.value : { models: null, existing: null, error: settled.error });
  const reading = props.keys.elevenlabs && settled === undefined;
  // Held as state so a voice flips to "in your account" without a reload; the server value
  // is the account, read fresh on every page view. Null until it is read, and if it cannot be.
  const [present, setPresent] = useState<Set<string> | null>(null);
  // Merged, not replaced: a voice cloned while the read was in flight is in the account
  // whether or not the read saw it.
  const existing = account?.existing;
  useEffect(() => {
    if (existing) setPresent((current) => new Set([...existing, ...(current ?? [])]));
  }, [existing]);
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

  const model =
    tab === "elevenlabs"
      ? (account?.models?.find((each) => each.id === settings.elevenlabs.modelId)?.name ??
        settings.elevenlabs.modelId)
      : (props.fishModels.find((each) => each.id === settings.fish.model)?.label ??
        settings.fish.model);
  const voice = settings.elevenlabs.voiceSettings;

  return (
    <>
      <div className="vo-tabbar">
        <div role="tablist" aria-label="Generator" className="bs-tabs">
          {PROVIDERS.map((provider) => (
            <button
              key={provider}
              type="button"
              role="tab"
              aria-selected={tab === provider}
              aria-current={tab === provider ? "page" : undefined}
              onClick={() => choose(provider)}
              className="bs-tab"
            >
              {PROVIDER_NAME[provider]}
              {active === provider && (
                <Check className="vo-active-mark" aria-label={`active in ${langName(lang)}`} />
              )}
              <span className="bs-count">
                {provider === "elevenlabs"
                  ? created === null
                    ? total
                    : `${created} / ${total}`
                  : `${referenced} / ${total}`}
              </span>
            </button>
          ))}
        </div>

        {props.manager && (
          <button
            type="button"
            className={cn("bs-btn vo-sm", editing ? "bs-btn-primary" : "bs-btn-text")}
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            <Pencil />
            {editing ? "Done editing sources" : "Edit sources"}
          </button>
        )}
      </div>

      <section role="tabpanel" aria-label={PROVIDER_NAME[tab]}>
        <div className="vo-gen">
          {active === tab ? (
            <span className="vo-pill">
              <Check aria-hidden />
              Active in {langName(lang)}
            </span>
          ) : (
            <button
              type="button"
              className="bs-btn bs-btn-primary vo-sm"
              disabled={!hasKey || activating}
              onClick={activate}
            >
              {activating && <Loader2 className="animate-spin" />}
              Activate for {langName(lang)}
            </button>
          )}
          {!hasKey && (
            <span className="vo-note">
              Needs a {PROVIDER_NAME[tab]} key —{" "}
              <Link href={KEY_ANCHOR[tab]} className="vo-link">
                add one on your profile
              </Link>
            </span>
          )}

          <span className="vo-summary">
            <b>{model}</b>
            {tab === "elevenlabs" ? (
              <>
                <i>·</i>Stability {decimal(voice.stability)}
                <i>·</i>Similarity {decimal(voice.similarity_boost)}
                <i>·</i>Style {decimal(voice.style)}
                {voice.use_speaker_boost && (
                  <>
                    <i>·</i>Speaker boost
                  </>
                )}
                <i>·</i>
                {settings.elevenlabs.seedStrategy === "npc" ? "Seed per NPC" : "No seed"}
              </>
            ) : (
              <>
                <i>·</i>Temperature {decimal(settings.fish.temperature)}
                <i>·</i>Top P {decimal(settings.fish.topP)}
                <i>·</i>Speed {decimal(settings.fish.speed)}
              </>
            )}
          </span>

          <span className="vo-gen-actions">
            {tab === "elevenlabs" && reading && (
              <span className="vo-note inline-flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Reading your ElevenLabs account…
              </span>
            )}
            <button
              type="button"
              className="bs-btn bs-btn-text vo-sm"
              aria-expanded={showSettings}
              aria-controls="voice-settings"
              onClick={() => setShowSettings(!showSettings)}
            >
              <SlidersHorizontal />
              Settings
            </button>
            {tab === "elevenlabs" && props.keys.elevenlabs && present !== null && (
              <button type="button" className="bs-btn vo-outline vo-sm" onClick={() => setPopulating(true)}>
                <Sparkles />
                Populate my account…
              </button>
            )}
          </span>
        </div>

        {activateError && (
          <p role="alert" className="vo-alert">
            {activateError}
          </p>
        )}
        {tab === "elevenlabs" && props.keys.elevenlabs && account?.error && (
          <p role="alert" className="vo-alert">
            Could not read your ElevenLabs account: {account.error}
          </p>
        )}

        {showSettings && (
          <div id="voice-settings" className="vo-settings">
            {tab === "elevenlabs" ? (
              <ElevenLabsSettingsForm
                key={JSON.stringify(settings.elevenlabs)}
                saved={settings.elevenlabs}
                models={account?.models ?? null}
                modelsNote={modelsNote(props.keys.elevenlabs, reading, account)}
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
        )}

        {tab === "elevenlabs" && props.keys.elevenlabs && present !== null && (
          <PopulateDialog
            open={populating}
            onClose={() => setPopulating(false)}
            cloneable={cloneable.map((slot) => slot.name)}
            present={present}
            slotsUsed={slotsUsed}
            slotLimit={slotLimit}
            onCloned={cloned}
          />
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

/** A 0-1 setting in the viewer's own decimal style, as the number inputs show it. */
function decimal(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
