/**
 * The generators a take can come from: the one list every type, check and label derives from.
 *
 * Free of server imports, because the profile form, the take history and the key section are
 * client components and need the names too.
 */
export const PROVIDERS = ["elevenlabs", "fish"] as const;

export type Provider = (typeof PROVIDERS)[number];

export function isProvider(value: unknown): value is Provider {
  return (PROVIDERS as readonly unknown[]).includes(value);
}

/** How a provider is named to a person. */
export const PROVIDER_NAME: Record<Provider, string> = {
  elevenlabs: "ElevenLabs",
  fish: "fish.audio",
};

/**
 * The paths each generator posts its speech to, and the only ones a worker sends a key to
 * (worker/protocol.ts). `{voiceId}` stands for the voice.
 */
export const SPEECH_PATH = {
  elevenlabsSpeech: "/v1/text-to-speech/{voiceId}/with-timestamps",
  elevenlabsDialogue: "/v1/text-to-dialogue/with-timestamps",
  fish: "/v1/tts",
} as const;
