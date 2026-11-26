"use client";

import { useUiText } from "@/components/UiTextProvider";
import { REMIX_SETTINGS, type RemixSettings } from "@/lib/voice-design/limits";

import { useWorkbench } from "./context";

const RANGES = [
  ["promptStrength", "promptStrength", "promptStrengthHint"],
  ["guidanceScale", "guidanceScale", "guidanceHint"],
  ["loudness", "loudness", "loudnessHint"],
] as const;

/** Voice Remix's settings for the page. A range left at ElevenLabs' default is not sent. */
export default function RemixSettingsFields() {
  const t = useUiText().voiceDesign;
  const { remixSettings: settings, setRemixSettings } = useWorkbench();
  const set = (patch: Partial<RemixSettings>) => setRemixSettings({ ...settings, ...patch });

  return (
    <div className="vd-remix-settings">
      {RANGES.map(([key, label, hint]) => {
        const { min, max, step, initial } = REMIX_SETTINGS[key];
        const value = settings[key] ?? initial;
        return (
          <label key={key} className="vd-remix-setting" title={t[hint]}>
            <span className="bs-label">{t[label]}</span>
            <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => set({ [key]: Number(event.target.value) })} />
            <span className="vd-remix-value">{value}</span>
          </label>
        );
      })}
      <label className="vd-remix-setting" title={t.seedHint}>
        <span className="bs-label">{t.seed}</span>
        <input
          type="number"
          min={0}
          step={1}
          className="vd-remix-seed"
          value={settings.seed ?? ""}
          placeholder={t.seedRandom}
          onChange={(event) => set({ seed: event.target.value === "" ? null : Math.max(0, Math.floor(Number(event.target.value))) })}
        />
      </label>
      <p className="vd-muted vd-remix-note">{t.remixSettingsNote}</p>
    </div>
  );
}
