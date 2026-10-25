/**
 * The generators a take can come from: the one list every type, check and label derives from.
 *
 * Free of server imports, because the profile form, the take history and the key section are
 * client components and need the names too.
 */
export const PROVIDERS = ["elevenlabs", "fish", "voicestudio"] as const;

export type Provider = (typeof PROVIDERS)[number];

export function isProvider(value: unknown): value is Provider {
  return (PROVIDERS as readonly unknown[]).includes(value);
}

/** How a provider is named to a person. */
export const PROVIDER_NAME: Record<Provider, string> = {
  elevenlabs: "ElevenLabs",
  fish: "fish.audio",
  voicestudio: "VoiceStudio",
};
