"use client";

import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { REMIX_SEED_MAX, REMIX_SETTINGS, type RemixSettings } from "@/lib/voice-design/limits";

import { useWorkbench } from "./context";

const RANGES = [
  ["promptStrength", "promptStrength", "promptStrengthHint"],
  ["guidanceScale", "guidanceScale", "guidanceHint"],
  ["loudness", "loudness", "loudnessHint"],
] as const;

/**
 * Voice Remix's settings for the page; every value is sent, a blank seed left to ElevenLabs. A drag
 * changes only this panel and is kept when let go, so the page does not re-render on every step.
 */
export default function RemixSettingsFields() {
  const t = useUiText().voiceDesign;
  const { remixSettings, setRemixSettings } = useWorkbench();
  const [settings, setSettings] = useState(remixSettings);
  const keep = (next: RemixSettings) => {
    setSettings(next);
    setRemixSettings(next);
  };

  return (
    <div className="vd-remix-settings">
      {RANGES.map(([key, label, hint]) => {
        const { min, max, step, initial } = REMIX_SETTINGS[key];
        const value = settings[key] ?? initial;
        return (
          <label key={key} className="vd-remix-setting" title={t[hint]}>
            <span className="bs-label">{t[label]}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })}
              onPointerUp={() => setRemixSettings(settings)}
              onKeyUp={() => setRemixSettings(settings)}
            />
            <span className="vd-remix-value">{value}</span>
          </label>
        );
      })}
      <label className="vd-remix-setting" title={t.seedHint}>
        <span className="bs-label">{t.seed}</span>
        <input
          type="number"
          min={0}
          max={REMIX_SEED_MAX}
          step={1}
          className="vd-remix-seed"
          value={settings.seed ?? ""}
          placeholder={t.seedRandom}
          onChange={(event) =>
            keep({ ...settings, seed: event.target.value === "" ? null : Math.min(REMIX_SEED_MAX, Math.max(0, Math.floor(Number(event.target.value)))) })
          }
        />
      </label>
      <p className="vd-muted vd-remix-note">{t.remixSettingsNote}</p>
    </div>
  );
}
