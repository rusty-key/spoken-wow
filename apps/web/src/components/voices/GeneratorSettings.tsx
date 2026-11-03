"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEED_STRATEGIES, type SeedStrategy, type VoiceSettings } from "@/lib/generation/config";
import type { Preference } from "@/lib/generation/preference";

/** The models a collaborator may pick. Mirrors FISH_MODELS in lib/voices/fish.ts, which is server-side. */
export type FishModelOption = { id: string; label: string; preview: boolean; price: string };

/** An ElevenLabs model the collaborator's account may use, read from the account. */
export type ElevenLabsModelOption = { id: string; name: string };

// Type-only: erased from the bundle, so the form and the server cannot drift apart on shape.
export type Settings = Pick<Preference, "elevenlabs" | "fish">;

const SEED_LABELS: Record<SeedStrategy, string> = {
  npc: "Per NPC — every line an NPC speaks draws the same way",
  none: "None — each line is an independent draw",
};

/** The three 0-1 voice settings, as the admin form described them before they moved here. */
const SLIDERS: { key: "stability" | "similarity_boost" | "style"; label: string; hint: string }[] = [
  {
    key: "stability",
    label: "Stability",
    hint: "Low varies the delivery between takes; high flattens it. 0.5 is the API's own default.",
  },
  {
    key: "similarity_boost",
    label: "Similarity",
    hint: "How hard the model tries to match the clone, including any noise in the source clips.",
  },
  {
    key: "style",
    label: "Style",
    hint: "Exaggerates the source's delivery. Costs latency, and above ~0.5 tends to drift.",
  },
];

/**
 * Save both providers' settings, which is what the route stores: one set per collaborator,
 * for every language. Each tab edits its own half and sends the other half as saved.
 */
export async function saveSettings(settings: Settings): Promise<Settings> {
  const response = await fetch("/api/voices/generator", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  const body = (await response.json().catch(() => ({}))) as { settings?: Settings; error?: string };
  if (!response.ok || !body.settings) throw new Error(body.error ?? "could not save");
  return body.settings;
}

/**
 * A settings form's draft, its save, and whether there is anything to save.
 *
 * Keyed on the saved value by the caller, so a save from the other tab -- which sends this
 * half back unchanged -- never leaves a stale draft here.
 */
function useDraft<T>(saved: T, save: (next: T) => Promise<void>) {
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await save(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return { draft, setDraft, busy, error, changed, submit };
}

function Footer({
  busy,
  changed,
  error,
  onSave,
}: {
  busy: boolean;
  changed: boolean;
  error: string | null;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" disabled={busy || !changed} onClick={onSave}>
        {busy ? "Saving…" : "Save settings"}
      </Button>
      <span className="text-muted-foreground text-xs">Applies to all your languages.</span>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </div>
  );
}

export function ElevenLabsSettingsForm({
  saved,
  models,
  onSave,
}: {
  saved: Settings["elevenlabs"];
  /** From the account; null when there is no key to ask with, or the account would not say. */
  models: ElevenLabsModelOption[] | null;
  onSave: (next: Settings["elevenlabs"]) => Promise<void>;
}) {
  const { draft, setDraft, busy, error, changed, submit } = useDraft(saved, onSave);
  const setVoice = (change: Partial<VoiceSettings>) =>
    setDraft((current) => ({ ...current, voiceSettings: { ...current.voiceSettings, ...change } }));
  // The saved model stays offered even when the account no longer lists it, so opening the
  // page never silently changes it.
  const options = [
    ...(models ?? []),
    ...(models?.some((model) => model.id === draft.modelId)
      ? []
      : [{ id: draft.modelId, name: draft.modelId }]),
  ];

  return (
    <div className="space-y-3">
      <div className="grid max-w-md grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
        <Label htmlFor="eleven-model">Model</Label>
        <select
          id="eleven-model"
          value={draft.modelId}
          onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
        >
          {options.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>

        {SLIDERS.map(({ key, label, hint }) => (
          <div key={key} className="contents">
            <Label htmlFor={`eleven-${key}`} title={hint}>
              {label}
            </Label>
            <Input
              id={`eleven-${key}`}
              type="number"
              min={0}
              max={1}
              step={0.05}
              title={hint}
              value={draft.voiceSettings[key]}
              onChange={(event) => setVoice({ [key]: Number(event.target.value) })}
              className="h-8 w-24"
            />
          </div>
        ))}

        <Label htmlFor="eleven-boost">Speaker boost</Label>
        <input
          id="eleven-boost"
          type="checkbox"
          checked={draft.voiceSettings.use_speaker_boost}
          onChange={(event) => setVoice({ use_speaker_boost: event.target.checked })}
          className="size-4 justify-self-start"
        />

        <Label htmlFor="eleven-seed">Seed</Label>
        <select
          id="eleven-seed"
          value={draft.seedStrategy}
          onChange={(event) => setDraft({ ...draft, seedStrategy: event.target.value as SeedStrategy })}
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
        >
          {SEED_STRATEGIES.map((strategy) => (
            <option key={strategy} value={strategy}>
              {SEED_LABELS[strategy]}
            </option>
          ))}
        </select>
      </div>
      {models === null && (
        <p className="text-muted-foreground text-xs">
          The models your account offers appear once an ElevenLabs key is stored.
        </p>
      )}
      <Footer busy={busy} changed={changed} error={error} onSave={submit} />
    </div>
  );
}

export function FishSettingsForm({
  saved,
  models,
  onSave,
}: {
  saved: Settings["fish"];
  models: FishModelOption[];
  onSave: (next: Settings["fish"]) => Promise<void>;
}) {
  const { draft, setDraft, busy, error, changed, submit } = useDraft(saved, onSave);
  const number = (key: "temperature" | "topP" | "speed", min: number, max: number, label: string) => (
    <div className="contents">
      <Label htmlFor={`fish-${key}`}>{label}</Label>
      <Input
        id={`fish-${key}`}
        type="number"
        min={min}
        max={max}
        step={0.05}
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })}
        className="h-8 w-24"
      />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid max-w-md grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
        <Label htmlFor="fish-model">Model</Label>
        <select
          id="fish-model"
          value={draft.model}
          onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} — {model.price}
            </option>
          ))}
        </select>
        {number("temperature", 0, 1, "Temperature")}
        {number("topP", 0, 1, "Top P")}
        {number("speed", 0.5, 2, "Speed")}
      </div>
      <p className="text-muted-foreground text-xs">
        Temperature and Top P trade consistency for expressiveness; fish.audio&apos;s defaults are
        0.7 for both.{" "}
        {models.find((model) => model.id === draft.model)?.preview &&
          "Preview models may change or disappear without notice, and have no published price."}
      </p>
      <Footer busy={busy} changed={changed} error={error} onSave={submit} />
    </div>
  );
}

/** VoiceStudio's model and concurrency are part of the connection, set on /profile. */
export function VoiceStudioSettings({ model }: { model: string | null }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        {model ? (
          <>
            Uses your VoiceStudio service with model <code>{model}</code>.
          </>
        ) : (
          "Uses your own VoiceStudio service."
        )}{" "}
        Voice profiles must use Spoken&apos;s names: <code>race-gender-flavor</code> in English
        and <code>race-gender-flavor@locale</code> for translated voices.
      </p>
      <p className="text-muted-foreground text-xs">
        Its address, key, model and concurrency are set on your profile.
      </p>
    </div>
  );
}
