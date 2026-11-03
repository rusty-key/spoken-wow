# VoiceStudio generation

VoiceStudio is an optional third generator for Spoken. It does not replace ElevenLabs or
fish.audio: the selected provider is stored per collaborator and language, and every generated
take records `voicestudio` as its provider.

## Connecting a service

Each collaborator runs their own VoiceStudio and connects it on their profile: the service URL,
an optional API key, the model (default `omnivoice`) and how many lines it may generate at once
(default 1, at most 8). Nothing is configured for the deployment.

Serving it over https at an address the Spoken server can reach is the collaborator's job, for
example with a reverse proxy or a tunnel. The URL must be https and must not name localhost or a
private, loopback or link-local IP address, because the server fetches it. Redirects are refused
for the same reason. The check is on the URL as written; a hostname is not resolved first.

Saving lists the service's voices, so a wrong address or key is reported then rather than in
the middle of a batch. The connection is sealed in `voicestudio_key` like the other providers'
keys and is never sent back to a browser; the profile shows only its host.

## Voice profile names

Create or clone profiles in VoiceStudio from the reference clips shown on Spoken’s Voices page.
The profile name must be the Spoken voice slot name for English, for example
`dwarf-male-grim`, and must include the locale suffix for translated voices, for example
`dwarf-male-grim@esMX`. The Voices page lists the matching profiles returned by
`GET /v1/audio/voices` and explains the expected name for each slot.

## Generation flow

1. A collaborator connects their service on Profile, then opens Voices, selects VoiceStudio,
   and activates it for the language.
2. Spoken resolves profile names to VoiceStudio profile IDs.
3. The queue sends each turn to `POST /v1/audio/speech` with the configured model, profile ID,
   text, and `response_format: "mp3"`. Before sending, Spoken applies the active pronunciation
   lexicon for that locale: respelling entries work for every locale, and English IPA entries
   are lowered to OmniVoice CMU phoneme brackets. A version of the applied rules is recorded
   with the take.
4. Lines containing narration or voice markers are generated turn-by-turn and stitched into one
   MP3 before the take is committed.

The existing ElevenLabs and fish.audio paths, credentials, references, and take history remain
unchanged.
